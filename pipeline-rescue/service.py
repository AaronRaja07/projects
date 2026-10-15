"""Relay Operations: generated logistics events, replayable pipeline and decisions.

Only Python's standard library is required. The HTTP adapter calls ``handle``;
tests can replace DB_PATH with a temporary file. No network calls are made.
"""
import hashlib
import json
import math
import random
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / '.demo-state' / 'relay-operations.sqlite3'
AS_OF = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
SEED = 41
LOCK = threading.RLock()
EVENT_TYPES = {'created', 'packed', 'dispatched', 'exception', 'delivered'}
STAGE = {'created': 0, 'packed': 1, 'dispatched': 2, 'delivered': 3}
SCHEMA_VERSION = 1


def iso(value):
    # Fixed precision makes normalized UTC timestamp ordering chronological in SQLite.
    return value.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError('Timestamp must be an ISO 8601 string with a timezone')
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Timestamp must be valid ISO 8601') from exc
    if stamp.tzinfo is None:
        raise ValueError('Timestamp must include a timezone')
    return stamp.astimezone(timezone.utc)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fixture(seed=SEED):
    """Build every entity from a seeded RNG; no imported or anonymized records."""
    rng = random.Random(seed)
    orders, events = [], []
    lanes = [('Cedar → Haven', 'Cedar', 'Haven'), ('Mesa → Grove', 'Mesa', 'Grove'),
             ('Haven → Vale', 'Haven', 'Vale'), ('Grove → Cedar', 'Grove', 'Cedar')]
    for i in range(1, 65):
        lane, origin, destination = lanes[(i - 1) % len(lanes)]
        order_id = f'REL-{i:03d}'
        state = rng.choices(['packed', 'dispatched', 'exception', 'delivered'], [16, 41, 18, 25])[0]
        created = AS_OF - timedelta(hours=rng.randint(28, 62))
        promised = AS_OF + timedelta(hours=rng.randint(-5, 22), minutes=rng.choice([0, 15, 30, 45]))
        orders.append({'order_id': order_id, 'customer': f'Retailer {(i % 9) + 1:02d}',
                       'lane': lane, 'origin': origin, 'destination': destination,
                       'promised_at': iso(promised), 'value': rng.randint(8, 65) * 100,
                       'priority': rng.choice([1, 1, 2, 3]),
                       'expedite_cost': rng.choice([80, 110, 140, 175, 210, 260]),
                       'recoverability': rng.choice([0.35, 0.5, 0.65, 0.8])})
        sequence = [('created', created), ('packed', created + timedelta(hours=5))]
        if state in {'dispatched', 'exception', 'delivered'}:
            sequence.append(('dispatched', AS_OF - timedelta(hours=rng.randint(4, 18))))
        if state == 'exception':
            sequence.append(('exception', AS_OF - timedelta(hours=rng.randint(1, 3))))
        if state == 'delivered':
            sequence.append(('delivered', AS_OF - timedelta(hours=1, minutes=i)))
        for step, occurred in sequence:
            events.append({'event_id': f'{order_id}-{step}', 'order_id': order_id,
                           'type': step, 'occurred_at': iso(occurred),
                           'delay_minutes': rng.choice([60, 120, 180]) if step == 'exception' else 0,
                           'hub': origin if step in {'created', 'packed'} else destination})
    # Known quality faults and an at-least-once duplicate are deliberate fixtures.
    events += [dict(events[8]),
               {'event_id': 'SCAN-BAD-TIME', 'order_id': 'REL-004', 'type': 'dispatched',
                'occurred_at': 'yesterday afternoon', 'delay_minutes': 0},
               {'event_id': 'SCAN-BAD-DELAY', 'order_id': 'REL-007', 'type': 'exception',
                'occurred_at': iso(AS_OF - timedelta(minutes=15)), 'delay_minutes': -45},
               {'event_id': 'SCAN-UNKNOWN', 'order_id': 'REL-999', 'type': 'packed',
                'occurred_at': iso(AS_OF - timedelta(hours=1)), 'delay_minutes': 0}]
    # An older event arrives after newer state; event time must win over arrival time.
    events.append({'event_id': 'REL-001-LATE', 'order_id': 'REL-001', 'type': 'created',
                   'occurred_at': iso(AS_OF - timedelta(hours=70)), 'delay_minutes': 0})
    return orders, events


def _schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY, customer TEXT, lane TEXT, origin TEXT, destination TEXT,
        promised_at TEXT, value INTEGER, priority INTEGER, expedite_cost INTEGER, recoverability REAL);
      CREATE TABLE IF NOT EXISTS raw_events (
        raw_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL,
        payload TEXT NOT NULL, received_at TEXT NOT NULL, outcome TEXT);
      CREATE TABLE IF NOT EXISTS valid_events (
        event_id TEXT PRIMARY KEY, raw_id INTEGER NOT NULL REFERENCES raw_events(raw_id),
        order_id TEXT NOT NULL REFERENCES orders(order_id), event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL, delay_minutes INTEGER NOT NULL,
        fingerprint TEXT NOT NULL, payload TEXT NOT NULL, is_late INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS event_order_time ON valid_events(order_id, occurred_at);
      CREATE TABLE IF NOT EXISTS quarantine (
        raw_id INTEGER PRIMARY KEY REFERENCES raw_events(raw_id), reason_code TEXT NOT NULL,
        detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', repair_event_id TEXT);
      CREATE TABLE IF NOT EXISTS serving_orders (
        order_id TEXT PRIMARY KEY REFERENCES orders(order_id), status TEXT NOT NULL,
        last_event_at TEXT NOT NULL, event_count INTEGER NOT NULL, delay_minutes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
        details TEXT NOT NULL, recorded_at TEXT NOT NULL);
    ''')


def _audit(db, action, details):
    db.execute('INSERT INTO audit_log(action, details, recorded_at) VALUES(?,?,?)',
               (action, canonical(details), iso(datetime.now(timezone.utc))))


def _meta(db, key, default=None):
    row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return json.loads(row['value']) if row else default


def _set_meta(db, key, value):
    db.execute('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)', (key, canonical(value)))


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        _schema(db)
        if not _meta(db, 'seeded', False):
            _seed(db)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _seed(db):
    orders, events = fixture()
    keys = ['order_id', 'customer', 'lane', 'origin', 'destination', 'promised_at',
            'value', 'priority', 'expedite_cost', 'recoverability']
    db.executemany('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)',
                   [tuple(order[key] for key in keys) for order in orders])
    _ingest(db, events, 'seed-41')
    _set_meta(db, 'seeded', True)
    _set_meta(db, 'disruption_count', 0)
    _audit(db, 'fixture_generated', {'seed': SEED, 'orders': len(orders), 'events': len(events)})


def _validate(db, payload):
    """Return normalized event or a stable machine-readable quarantine reason."""
    if not isinstance(payload, dict):
        return None, 'NON_OBJECT', 'Event must be a JSON object'
    event_id = payload.get('event_id')
    if not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', event_id):
        return None, 'BAD_EVENT_ID', 'Use a nonempty event identifier of letters, digits, underscores, or hyphens'
    order_id = payload.get('order_id')
    if not isinstance(order_id, str) or not db.execute('SELECT 1 FROM orders WHERE order_id=?', (order_id,)).fetchone():
        return None, 'UNKNOWN_ORDER', 'Order does not exist in the generated order catalog'
    event_type = payload.get('type')
    if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
        return None, 'BAD_EVENT_TYPE', 'Unsupported lifecycle event type'
    try:
        occurred = parse_time(payload.get('occurred_at'))
        if occurred > AS_OF + timedelta(hours=1):
            return None, 'FUTURE_EVENT', 'Event is more than one hour ahead of the fixture clock'
    except ValueError as exc:
        return None, 'BAD_TIMESTAMP', str(exc)
    delay = payload.get('delay_minutes', 0)
    if isinstance(delay, bool) or not isinstance(delay, int) or not 0 <= delay <= 2880:
        return None, 'BAD_DELAY', 'Delay must be an integer between zero and 2880 minutes'
    hub = payload.get('hub', '')
    if not isinstance(hub, str) or len(hub) > 80:
        return None, 'BAD_HUB', 'Hub must be a short text value'
    event = {'event_id': event_id, 'order_id': order_id, 'type': event_type,
             'occurred_at': iso(occurred), 'delay_minutes': delay, 'hub': hub}
    return event, None, None


def _process_raw(db, raw_id, payload):
    event, reason, detail = _validate(db, payload)
    if event:
        digest = hashlib.sha256(canonical(event).encode()).hexdigest()
        existing = db.execute('SELECT fingerprint FROM valid_events WHERE event_id=?', (event['event_id'],)).fetchone()
        if existing:
            if digest == existing['fingerprint']:
                db.execute('UPDATE raw_events SET outcome=? WHERE raw_id=?', ('duplicate', raw_id))
                return 'duplicate'
            reason, detail = 'EVENT_ID_CONFLICT', 'An existing event identifier has different content'
        else:
            last = db.execute('SELECT MAX(occurred_at) AS last_at FROM valid_events WHERE order_id=?',
                              (event['order_id'],)).fetchone()['last_at']
            is_late = int(bool(last and event['occurred_at'] < last))
            db.execute('INSERT INTO valid_events VALUES(?,?,?,?,?,?,?,?,?)',
                       (event['event_id'], raw_id, event['order_id'], event['type'], event['occurred_at'],
                        event['delay_minutes'], digest, canonical(event), is_late))
            db.execute('UPDATE raw_events SET outcome=? WHERE raw_id=?', ('validated', raw_id))
            return 'validated'
    db.execute('UPDATE raw_events SET outcome=? WHERE raw_id=?', ('quarantined', raw_id))
    db.execute('''INSERT INTO quarantine(raw_id, reason_code, detail) VALUES(?,?,?)
                  ON CONFLICT(raw_id) DO UPDATE SET reason_code=excluded.reason_code, detail=excluded.detail''',
               (raw_id, reason, detail))
    return 'quarantined'


def _materialize(db):
    db.execute('DELETE FROM serving_orders')
    for row in db.execute('SELECT order_id FROM orders ORDER BY order_id').fetchall():
        events = db.execute('SELECT * FROM valid_events WHERE order_id=? ORDER BY occurred_at,event_id',
                            (row['order_id'],)).fetchall()
        stage, stage_time, exception_time, delay = -1, '', '', 0
        for event in events:
            kind = event['event_type']
            if kind in STAGE and STAGE[kind] >= stage:
                stage, stage_time = STAGE[kind], event['occurred_at']
            if kind == 'exception':
                exception_time, delay = event['occurred_at'], event['delay_minutes']
        status = ['awaiting', 'packed', 'in_transit', 'delivered'][max(0, stage)]
        if stage < 3 and exception_time > stage_time:
            status = 'exception'
        else:
            delay = 0
        last_at = max((event['occurred_at'] for event in events), default=iso(AS_OF - timedelta(days=3)))
        db.execute('INSERT INTO serving_orders VALUES(?,?,?,?,?)',
                   (row['order_id'], status, last_at, len(events), delay))


def _ingest(db, events, batch_id):
    if not isinstance(events, list) or not 1 <= len(events) <= 500:
        raise ValueError('Provide between 1 and 500 event objects')
    before = _projection_digest(db)
    counts = {'validated': 0, 'duplicate': 0, 'quarantined': 0}
    for payload in events:
        raw_text = canonical(payload)
        cur = db.execute('INSERT INTO raw_events(batch_id,payload,received_at) VALUES(?,?,?)',
                         (batch_id, raw_text, iso(datetime.now(timezone.utc))))
        outcome = _process_raw(db, cur.lastrowid, payload)
        counts[outcome] += 1
    _materialize(db)
    if _projection_digest(db) != before:
        _set_meta(db, 'latest_allocation', None)
    return counts


def _order_view(row):
    order = dict(row)
    promised = parse_time(order['promised_at'])
    hours_to_promise = (promised - AS_OF).total_seconds() / 3600
    remaining = {'awaiting': 18, 'packed': 10, 'in_transit': 3, 'exception': 6, 'delivered': 0}[order['status']]
    delay_hours = order['delay_minutes'] / 60
    slack = hours_to_promise - remaining - delay_hours
    stale_hours = max(0, (AS_OF - parse_time(order['last_event_at'])).total_seconds() / 3600)
    reasons = []
    if order['status'] == 'delivered':
        score = 0
    else:
        score = 12 + order['priority'] * 3
        if slack < 0:
            score += min(50, math.ceil(-slack * 8))
            reasons.append(f'Estimated arrival exceeds promise by {-slack:.1f}h')
        if order['status'] == 'exception':
            score += 24
            reasons.append(f'Active exception adds {order["delay_minutes"]} minutes')
        if stale_hours >= 12:
            score += 12
            reasons.append(f'No accepted event for {stale_hours:.1f}h')
        if order['priority'] == 3:
            reasons.append('Priority service commitment')
        if not reasons:
            reasons.append('Within modeled transit allowance')
        score = min(99, score)
    exposure = round(order['value'] * score / 100, 2)
    # Explicit heuristic, not a learned or calibrated probability of loss.
    avoidable = round(exposure * order['recoverability'], 2) if score >= 35 else 0
    order.update({'risk_score': score, 'risk_band': 'high' if score >= 70 else 'watch' if score >= 35 else 'low',
                  'risk_reasons': reasons or ['Delivery complete'], 'slack_hours': round(slack, 1),
                  'modeled_exposure': exposure, 'avoidable_exposure': avoidable,
                  'estimated_remaining_hours': remaining + delay_hours, 'stale_hours': round(stale_hours, 1),
                  'intervention': 'Priority carrier transfer' if avoidable else 'Monitor'})
    return order


def _orders(db):
    return [_order_view(row) for row in db.execute('''SELECT o.*, s.status, s.last_event_at,
               s.event_count, s.delay_minutes FROM orders o JOIN serving_orders s USING(order_id)
               ORDER BY o.order_id''')]


def _counts(db):
    raw = db.execute('SELECT COUNT(*) FROM raw_events').fetchone()[0]
    valid = db.execute('SELECT COUNT(*) FROM valid_events').fetchone()[0]
    duplicate = db.execute("SELECT COUNT(*) FROM raw_events WHERE outcome='duplicate'").fetchone()[0]
    quarantined = db.execute('SELECT COUNT(*) FROM quarantine').fetchone()[0]
    open_count = db.execute("SELECT COUNT(*) FROM quarantine WHERE status='open'").fetchone()[0]
    late = db.execute('SELECT COUNT(*) FROM valid_events WHERE is_late=1').fetchone()[0]
    return {'raw': raw, 'validated': valid, 'duplicates': duplicate, 'quarantined': quarantined,
            'quarantine_open': open_count, 'quarantine_resolved': quarantined - open_count, 'late': late,
            'reconciled': raw == valid + duplicate + quarantined}


def _projection_digest(db):
    rows = [dict(row) for row in db.execute('SELECT * FROM serving_orders ORDER BY order_id')]
    return hashlib.sha256(canonical(rows).encode()).hexdigest()


def _quarantine(db):
    return [dict(row, payload=json.loads(row['payload'])) for row in db.execute('''
       SELECT q.*, r.batch_id, r.payload, r.received_at FROM quarantine q
       JOIN raw_events r USING(raw_id) ORDER BY q.status, q.raw_id DESC''')]


def _summary(db):
    orders, counts = _orders(db), _counts(db)
    status_counts = {status: sum(order['status'] == status for order in orders)
                     for status in ['awaiting', 'packed', 'in_transit', 'exception', 'delivered']}
    return {'synthetic': True, 'seed': SEED, 'as_of': iso(AS_OF), 'schema_version': SCHEMA_VERSION,
            'counts': counts, 'orders_total': len(orders), 'statuses': status_counts,
            'high_risk': sum(order['risk_band'] == 'high' for order in orders),
            'modeled_exposure': round(sum(order['modeled_exposure'] for order in orders), 2),
            'lanes': [{'lane': lane, 'orders': len(items),
                       'high_risk': sum(order['risk_band'] == 'high' for order in items),
                       'exposure': round(sum(order['modeled_exposure'] for order in items), 2)}
                      for lane in sorted({order['lane'] for order in orders})
                      for items in [[order for order in orders if order['lane'] == lane]]],
            'reasons': [{'reason': row['reason_code'], 'count': row['n']}
                        for row in db.execute('SELECT reason_code,COUNT(*) AS n FROM quarantine GROUP BY reason_code')],
            'batches': [dict(row) for row in db.execute('''SELECT batch_id,COUNT(*) AS raw,
               SUM(outcome='validated') AS validated, SUM(outcome='duplicate') AS duplicates,
               SUM(outcome='quarantined') AS quarantined FROM raw_events GROUP BY batch_id ORDER BY MIN(raw_id)''')],
            'projection_digest': _projection_digest(db), 'latest_allocation': _meta(db, 'latest_allocation'),
            'model': {'risk': '12 + priority × 3 + min(50, ceil(overrun hours × 8)) + exception 24 + stale 12; cap 99',
                      'exposure': 'Order value × risk score / 100. This is an illustrative planning index, not a loss forecast.',
                      'intervention': 'Avoidable exposure = modeled exposure × synthetic recoverability. Independent one-time choices; no carrier capacity constraints.'}}


def _allocate(db, budget):
    if isinstance(budget, bool) or not isinstance(budget, int) or not 0 <= budget <= 5000:
        raise ValueError('Budget must be a whole dollar amount between 0 and 5000')
    candidates = [order for order in _orders(db) if order['avoidable_exposure'] > 0]
    candidates.sort(key=lambda order: order['order_id'])
    # 0/1 knapsack; descending capacities prevent selecting an order twice.
    value, picks = [0] * (budget + 1), [()] * (budget + 1)
    for index, order in enumerate(candidates):
        cost, benefit = order['expedite_cost'], round(order['avoidable_exposure'] * 100)
        for allowance in range(budget, cost - 1, -1):
            if value[allowance - cost] + benefit > value[allowance]:
                value[allowance] = value[allowance - cost] + benefit
                picks[allowance] = picks[allowance - cost] + (index,)
    selected = [candidates[index] for index in picks[budget]]
    baseline, remaining = [], budget
    for order in sorted(candidates, key=lambda order: (order['promised_at'], order['order_id'])):
        if order['expedite_cost'] <= remaining:
            baseline.append(order)
            remaining -= order['expedite_cost']

    def pack(rows):
        return {'order_ids': [order['order_id'] for order in rows], 'count': len(rows),
                'spent': sum(order['expedite_cost'] for order in rows),
                'avoidable_exposure': round(sum(order['avoidable_exposure'] for order in rows), 2)}
    chosen, first_due = pack(selected), pack(baseline)
    return {'budget': budget, 'candidate_count': len(candidates), 'optimized': chosen,
            'baseline': first_due, 'baseline_rule': 'Earliest promise first; skip unaffordable orders',
            'unspent': budget - chosen['spent'],
            'improvement': round(chosen['avoidable_exposure'] - first_due['avoidable_exposure'], 2),
            'objective': 'Maximize illustrative avoidable exposure within a one-time budget',
            'assumptions': ['Benefits are independent and additive', 'Each order can receive one intervention',
                            'Scores and recovery assumptions are synthetic; no causal effectiveness is claimed']}


def _lineage(db, order_id):
    order = next((order for order in _orders(db) if order['order_id'] == order_id), None)
    if not order:
        raise ValueError('Unknown order identifier')
    raw = []
    for row in db.execute('SELECT * FROM raw_events ORDER BY raw_id'):
        payload = json.loads(row['payload'])
        if isinstance(payload, dict) and payload.get('order_id') == order_id:
            raw.append(dict(row, payload=payload))
    events = [dict(row, payload=json.loads(row['payload'])) for row in db.execute('''
        SELECT * FROM valid_events WHERE order_id=? ORDER BY occurred_at,event_id''', (order_id,))]
    return {'order': order, 'raw': raw, 'validated': events,
            'rule': 'Lifecycle progress is monotonic. Delivery is terminal. Exceptions apply only after the latest progress event; arrival order never determines state.'}


def _first(query, key, default=''):
    value = query.get(key, [default])
    return value[0] if isinstance(value, list) and value else default


def handle(method, path, query, body):
    """API adapter: paths are relative to /api/pipeline; query uses parse_qs lists."""
    with LOCK, connection() as db:
        if method == 'GET' and path in {'/', '/summary'}:
            return _summary(db)
        if method == 'GET' and path == '/orders':
            rows = _orders(db)
            for key in ['status', 'lane', 'risk_band']:
                selected = _first(query, key)
                if selected:
                    rows = [row for row in rows if row[key] == selected]
            text = _first(query, 'q').strip().lower()
            if text:
                rows = [row for row in rows if text in ' '.join(str(row[key]) for key in ['order_id', 'customer', 'lane']).lower()]
            rows.sort(key=lambda row: (-row['risk_score'], row['promised_at'], row['order_id']))
            return {'orders': rows, 'count': len(rows), 'as_of': iso(AS_OF)}
        if method == 'GET' and path == '/lineage':
            return _lineage(db, _first(query, 'order_id'))
        if method == 'GET' and path == '/quarantine':
            return {'rows': _quarantine(db), 'counts': _counts(db)}
        if method == 'GET' and path == '/audit':
            raw_digest = hashlib.sha256(''.join(row['payload'] for row in db.execute('SELECT payload FROM raw_events ORDER BY raw_id')).encode()).hexdigest()
            return {'synthetic': True, 'as_of': iso(AS_OF), 'seed': SEED, 'schema_version': SCHEMA_VERSION,
                    'raw_digest': raw_digest, 'projection_digest': _projection_digest(db), 'counts': _counts(db),
                    'audit': [dict(row, details=json.loads(row['details'])) for row in db.execute('SELECT * FROM audit_log ORDER BY audit_id')],
                    'quarantine': _quarantine(db), 'latest_allocation': _meta(db, 'latest_allocation')}
        if method == 'POST' and path == '/ingest':
            result = _ingest(db, body.get('events'), f'api-{db.execute("SELECT COUNT(*) FROM raw_events").fetchone()[0] + 1}')
            _audit(db, 'ingest', result)
            return {'batch': result, 'counts': _counts(db)}
        if method == 'POST' and path == '/disrupt':
            scenario = body.get('scenario', 'weather')
            if scenario not in {'weather', 'scanner', 'late'}:
                raise ValueError('Scenario must be weather, scanner, or late')
            number = _meta(db, 'disruption_count', 0) + 1
            active = [order for order in _orders(db) if order['status'] != 'delivered']
            active.sort(key=lambda order: order['order_id'])
            if scenario == 'scanner' and len(active) < 2:
                raise ValueError('Scanner scenario needs at least two active generated orders')
            if scenario in {'weather', 'late'} and not active:
                raise ValueError('No active generated orders remain for this scenario')
            events = []
            if scenario == 'weather':
                for index, order in enumerate(active[:8]):
                    events.append({'event_id': f'DISRUPT-{number}-{index}', 'order_id': order['order_id'],
                                   'type': 'exception', 'occurred_at': iso(AS_OF - timedelta(minutes=3) + timedelta(milliseconds=number)),
                                   'delay_minutes': 120 + index * 25 + min(number, 10) * 10,
                                   'hub': order['origin']})
            elif scenario == 'scanner':
                original = json.loads(db.execute('SELECT payload FROM valid_events ORDER BY raw_id LIMIT 1').fetchone()[0])
                events = [original,
                          {'event_id': f'SCANNER-{number}-TIME', 'order_id': active[0]['order_id'], 'type': 'packed', 'occurred_at': '14/35/2026'},
                          {'event_id': f'SCANNER-{number}-DELAY', 'order_id': active[1]['order_id'], 'type': 'exception',
                           'occurred_at': iso(AS_OF - timedelta(minutes=2)), 'delay_minutes': -90}]
            else:
                events = [{'event_id': f'LATE-{number}', 'order_id': active[0]['order_id'], 'type': 'created',
                           'occurred_at': iso(AS_OF - timedelta(days=4)), 'delay_minutes': 0}]
            result = _ingest(db, events, f'{scenario}-{number}')
            _set_meta(db, 'disruption_count', number)
            _audit(db, 'disruption', {'scenario': scenario, 'batch': result})
            return {'scenario': scenario, 'batch': result, 'counts': _counts(db)}
        if method == 'POST' and path == '/replay':
            before = _projection_digest(db)
            db.execute('DELETE FROM valid_events')
            raw_rows = db.execute('SELECT raw_id,payload FROM raw_events ORDER BY raw_id').fetchall()
            for row in raw_rows:
                _process_raw(db, row['raw_id'], json.loads(row['payload']))
            _materialize(db)
            after = _projection_digest(db)
            if after != before:
                _set_meta(db, 'latest_allocation', None)
            result = {'raw_rows_replayed': len(raw_rows), 'before_digest': before, 'after_digest': after,
                      'idempotent': before == after, 'counts': _counts(db)}
            _audit(db, 'replay', result)
            return result
        if method == 'POST' and path == '/repair':
            raw_id, patch = body.get('raw_id'), body.get('patch')
            if isinstance(raw_id, bool) or not isinstance(raw_id, int):
                raise ValueError('raw_id must be an integer')
            row = db.execute('SELECT q.*,r.payload FROM quarantine q JOIN raw_events r USING(raw_id) WHERE q.raw_id=?', (raw_id,)).fetchone()
            if not row:
                raise ValueError('Unknown quarantined raw event')
            if row['status'] == 'resolved':
                return {'already_resolved': True, 'repair_event_id': row['repair_event_id'], 'counts': _counts(db)}
            if not isinstance(patch, dict) or not patch or set(patch) - {'order_id', 'type', 'occurred_at', 'delay_minutes', 'hub'}:
                raise ValueError('Provide a patch containing supported event fields')
            payload = json.loads(row['payload'])
            if not isinstance(payload, dict):
                raise ValueError('Non-object payloads must be resubmitted as a new event')
            payload.update(patch)
            payload['event_id'] = f'REPAIR-{raw_id}'
            normalized, reason, detail = _validate(db, payload)
            if reason:
                raise ValueError(f'{reason}: {detail}')
            existing = db.execute('SELECT 1 FROM valid_events WHERE event_id=?', (payload['event_id'],)).fetchone()
            if existing:
                raise ValueError('Reserved repair event identifier already exists')
            result = _ingest(db, [normalized], f'repair-{raw_id}')
            db.execute("UPDATE quarantine SET status='resolved',repair_event_id=? WHERE raw_id=?", (payload['event_id'], raw_id))
            _audit(db, 'repair', {'raw_id': raw_id, 'repair_event_id': payload['event_id'], 'patch': patch})
            return {'batch': result, 'repair_event_id': payload['event_id'], 'counts': _counts(db)}
        if method == 'POST' and path == '/allocate':
            allocation = _allocate(db, body.get('budget', 1200))
            _set_meta(db, 'latest_allocation', allocation)
            _audit(db, 'allocation_proposed', allocation)
            return allocation
        if method == 'POST' and path == '/reset':
            for table in ['valid_events', 'quarantine', 'serving_orders', 'raw_events', 'orders', 'audit_log', 'meta']:
                db.execute(f'DELETE FROM {table}')
            db.execute('DELETE FROM sqlite_sequence')
            _seed(db)
            return _summary(db)
        raise ValueError('Unknown Relay Operations endpoint')
