"""Behavioral invariants for Relay's generated data pipeline and decisions."""
import importlib.util
import itertools
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('relay_pipeline_under_test', ROOT / 'pipeline-rescue' / 'service.py')
relay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relay)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_path = relay.DB_PATH
        relay.DB_PATH = Path(self.temp.name) / 'test.sqlite3'
        self.initial = self.get('/summary')

    def tearDown(self):
        relay.DB_PATH = self.previous_path
        self.temp.cleanup()

    def get(self, path, **query):
        return relay.handle('GET', path, {key: [value] for key, value in query.items()}, {})

    def post(self, path, **body):
        return relay.handle('POST', path, {}, body)

    def event(self, event_id='TEST-EVENT', **changes):
        value = {'event_id': event_id, 'order_id': 'REL-001', 'type': 'packed',
                 'occurred_at': '2026-10-14T11:45:00Z', 'delay_minutes': 0}
        value.update(changes)
        return value

    def test_fixture_is_reproducible_and_pipeline_counts_reconcile(self):
        self.assertEqual(relay.fixture(), relay.fixture())
        self.assertNotEqual(relay.fixture(41), relay.fixture(42))
        counts = self.initial['counts']
        self.assertTrue(counts['reconciled'])
        self.assertEqual(counts['raw'], counts['validated'] + counts['duplicates'] + counts['quarantined'])
        self.assertEqual(1, counts['duplicates'])
        self.assertEqual(3, counts['quarantine_open'])
        self.assertGreaterEqual(counts['late'], 1)
        self.assertEqual(self.initial['orders_total'], len(self.get('/orders')['orders']))
        json.dumps(self.initial, allow_nan=False)

    def test_at_least_once_delivery_never_double_counts_canonical_events(self):
        original = self.get('/lineage', order_id='REL-001')['validated'][0]['payload']
        result = self.post('/ingest', events=[original, original])
        self.assertEqual({'validated': 0, 'duplicate': 2, 'quarantined': 0}, result['batch'])
        summary = self.get('/summary')
        self.assertEqual(self.initial['counts']['raw'] + 2, summary['counts']['raw'])
        self.assertEqual(self.initial['counts']['validated'], summary['counts']['validated'])
        self.assertEqual(self.initial['projection_digest'], summary['projection_digest'])

    def test_conflicting_id_is_quarantined_without_overwriting_original(self):
        original = self.get('/lineage', order_id='REL-001')['validated'][0]['payload']
        conflict = dict(original, delay_minutes=original['delay_minutes'] + 1)
        result = self.post('/ingest', events=[conflict])
        self.assertEqual(1, result['batch']['quarantined'])
        self.assertEqual('EVENT_ID_CONFLICT', self.get('/quarantine')['rows'][0]['reason_code'])
        self.assertEqual(self.initial['projection_digest'], self.get('/summary')['projection_digest'])
        event = next(event for event in self.get('/lineage', order_id='REL-001')['validated']
                     if event['event_id'] == original['event_id'])
        self.assertEqual(original, event['payload'])

    def test_malformed_payloads_get_stable_reason_codes(self):
        events = [None, self.event('E-BAD-TIME', occurred_at='2026-10-14'),
                  self.event('E-BAD-DELAY', delay_minutes=True),
                  self.event('E-BAD-TYPE', type='teleport'),
                  self.event('E-BAD-ORDER', order_id='DOES-NOT-EXIST'),
                  self.event('E-FUTURE', occurred_at='2026-10-16T00:00:00Z')]
        result = self.post('/ingest', events=events)
        self.assertEqual(6, result['batch']['quarantined'])
        reasons = {row['reason_code'] for row in self.get('/quarantine')['rows']}
        self.assertTrue({'NON_OBJECT', 'BAD_TIMESTAMP', 'BAD_DELAY', 'BAD_EVENT_TYPE', 'UNKNOWN_ORDER', 'FUTURE_EVENT'} <= reasons)
        self.assertEqual(self.initial['counts']['validated'], self.get('/summary')['counts']['validated'])

    def test_late_arrival_enriches_history_without_regressing_order_state(self):
        before = self.get('/lineage', order_id='REL-001')['order']
        self.post('/ingest', events=[self.event('LATE-TEST', type='created', occurred_at='2026-10-10T01:00:00Z')])
        lineage = self.get('/lineage', order_id='REL-001')
        self.assertEqual(before['status'], lineage['order']['status'])
        self.assertEqual(before['last_event_at'], lineage['order']['last_event_at'])
        self.assertEqual(before['event_count'] + 1, lineage['order']['event_count'])
        self.assertEqual(1, next(event for event in lineage['validated'] if event['event_id'] == 'LATE-TEST')['is_late'])

    def test_delivered_is_terminal_even_if_a_newer_exception_arrives(self):
        delivered = next(order for order in self.get('/orders')['orders'] if order['status'] == 'delivered')
        self.post('/ingest', events=[self.event('AFTER-DELIVERY', order_id=delivered['order_id'], type='exception', delay_minutes=180)])
        order = self.get('/lineage', order_id=delivered['order_id'])['order']
        self.assertEqual('delivered', order['status'])
        self.assertEqual(0, order['risk_score'])
        self.assertEqual(0, order['delay_minutes'])

    def test_replay_is_idempotent_and_does_not_append_raw_arrivals(self):
        before = self.get('/audit')
        for _ in range(2):
            replay = self.post('/replay')
            self.assertTrue(replay['idempotent'])
            self.assertEqual(replay['before_digest'], replay['after_digest'])
            self.assertEqual(before['counts'], replay['counts'])
            after = self.get('/audit')
            self.assertEqual(before['raw_digest'], after['raw_digest'])
            self.assertEqual(before['projection_digest'], after['projection_digest'])

    def test_repair_preserves_original_and_resolution_survives_replay(self):
        row = next(row for row in self.get('/quarantine')['rows'] if row['reason_code'] == 'BAD_DELAY')
        result = self.post('/repair', raw_id=row['raw_id'], patch={'delay_minutes': 90})
        self.assertEqual(1, result['batch']['validated'])
        after = next(item for item in self.get('/quarantine')['rows'] if item['raw_id'] == row['raw_id'])
        self.assertEqual(row['payload'], after['payload'])
        self.assertEqual('resolved', after['status'])
        self.assertEqual(result['repair_event_id'], after['repair_event_id'])
        self.assertEqual(self.initial['counts']['raw'] + 1, result['counts']['raw'])
        self.assertTrue(self.post('/replay')['idempotent'])
        resolved = next(item for item in self.get('/quarantine')['rows'] if item['raw_id'] == row['raw_id'])
        self.assertEqual('resolved', resolved['status'])
        repeated = self.post('/repair', raw_id=row['raw_id'], patch={'delay_minutes': 90})
        self.assertTrue(repeated['already_resolved'])
        self.assertEqual(result['counts'], repeated['counts'])

    def test_invalid_repair_cannot_partially_change_pipeline(self):
        row = next(row for row in self.get('/quarantine')['rows'] if row['reason_code'] == 'BAD_DELAY')
        before = self.get('/audit')
        for change in [{'delay_minutes': -1}, {'unsupported': 'value'}, {}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.post('/repair', raw_id=row['raw_id'], patch=change)
        after = self.get('/audit')
        self.assertEqual(before, after)

    def test_allocation_respects_budget_uniqueness_and_dominates_same_model_baseline(self):
        orders = {order['order_id']: order for order in self.get('/orders')['orders']}
        for budget in [0, 79, 80, 300, 1200, 5000]:
            with self.subTest(budget=budget):
                result = self.post('/allocate', budget=budget)
                selected = result['optimized']['order_ids']
                self.assertEqual(len(selected), len(set(selected)))
                self.assertLessEqual(result['optimized']['spent'], budget)
                self.assertEqual(sum(orders[key]['expedite_cost'] for key in selected), result['optimized']['spent'])
                self.assertTrue(all(orders[key]['status'] != 'delivered' for key in selected))
                self.assertGreaterEqual(result['optimized']['avoidable_exposure'], result['baseline']['avoidable_exposure'])
                self.assertEqual(budget, result['optimized']['spent'] + result['unspent'])

    def test_knapsack_matches_exhaustive_optimum_on_small_decision_set(self):
        candidates = [{'order_id': f'O-{i}', 'avoidable_exposure': benefit,
                       'expedite_cost': cost, 'promised_at': f'2026-10-{i+10:02d}'}
                      for i, (cost, benefit) in enumerate([(80, 300), (110, 500), (140, 540), (175, 780)])]
        with relay.LOCK, relay.connection() as db, patch.object(relay, '_orders', return_value=candidates):
            for budget in [0, 79, 80, 190, 300, 410]:
                optimum = max(sum(row['avoidable_exposure'] for row in subset)
                              for count in range(5) for subset in itertools.combinations(candidates, count)
                              if sum(row['expedite_cost'] for row in subset) <= budget)
                self.assertEqual(optimum, relay._allocate(db, budget)['optimized']['avoidable_exposure'])

    def test_invalid_budgets_are_rejected_without_persisting_decisions(self):
        for budget in [-1, 5001, True, 1.5, '1200', float('inf')]:
            with self.subTest(budget=budget), self.assertRaises(ValueError):
                self.post('/allocate', budget=budget)
        self.assertIsNone(self.get('/summary')['latest_allocation'])

    def test_scenarios_have_observable_pipeline_and_state_effects(self):
        scanner = self.post('/disrupt', scenario='scanner')
        self.assertEqual({'validated': 0, 'duplicate': 1, 'quarantined': 2}, scanner['batch'])
        late_before = self.get('/summary')['counts']['late']
        self.post('/disrupt', scenario='late')
        self.assertEqual(late_before + 1, self.get('/summary')['counts']['late'])
        exposure_before = self.get('/summary')['modeled_exposure']
        weather = self.post('/disrupt', scenario='weather')
        self.assertEqual(8, weather['batch']['validated'])
        self.assertGreater(self.get('/summary')['modeled_exposure'], exposure_before)

    def test_reset_restores_generated_dataset_and_fingerprints(self):
        initial_audit = self.get('/audit')
        self.post('/disrupt', scenario='weather')
        self.post('/allocate', budget=1200)
        reset = self.post('/reset')
        self.assertEqual(self.initial, reset)
        restored = self.get('/audit')
        self.assertEqual(initial_audit['raw_digest'], restored['raw_digest'])
        self.assertEqual(1, len(restored['audit']))


if __name__ == '__main__':
    unittest.main()
