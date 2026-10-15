/* Browser-local adapter for the independently generated Mission Control demo. */
(function (root) {
  'use strict';
  const TEAMS = ['Platform', 'Experience', 'Intelligence', 'Reliability'];
  const STATUSES = ['Ready', 'In progress', 'Blocked', 'Done'];
  const KEY = 'mission-demo-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  // Match Python's half-to-even ties for the shared planning ratios.
  function roundEven(value, digits = 0) {
    const scale = 10 ** digits, scaled = value * scale, lower = Math.floor(scaled);
    const remainder = scaled - lower;
    return (remainder < .5 ? lower : remainder > .5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1) / scale;
  }
  const round = value => roundEven(value, 1);

  function createMissionService(seed, storage, onWarning = () => {}) {
    const initial = clone(seed);
    let state = clone(initial), warned = false;
    function warn() {
      storage = null;
      if (!warned) { warned = true; onWarning('Browser storage is unavailable. Changes will last until this page closes.'); }
    }
    function validState(value) {
      return value && Array.isArray(value.tickets) && Array.isArray(value.epics) &&
        Array.isArray(value.reviews) && Array.isArray(value.audit) && value.baseline &&
        value.capacity && TEAMS.every(t => Number.isFinite(value.capacity[t]) && value.capacity[t] > 0) &&
        value.tickets.every(t => typeof t.id === 'string' && TEAMS.includes(t.team) && STATUSES.includes(t.status) && Number.isFinite(t.points) && t.points >= 0);
    }
    if (!validState(initial)) throw new Error('Invalid synthetic seed');
    if (storage) {
      try {
        const saved = storage.getItem(KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!validState(parsed)) throw new Error('Invalid saved demo');
          state = parsed;
        }
      } catch (_) { warn(); }
    }
    function persist(next) {
      state = next;
      if (storage) { try { storage.setItem(KEY, JSON.stringify(state)); } catch (_) { warn(); } }
    }
    const read = (query, key, fallback) => {
      const value = query instanceof URLSearchParams ? query.get(key) : query[key];
      return value == null ? fallback : Array.isArray(value) ? value[0] : value;
    };
    function scoped(data, query = {}) {
      const team = read(query, 'team', 'All'), sprint = read(query, 'sprint', 'S-03');
      const status = read(query, 'status', 'All'), search = String(read(query, 'q', '')).trim().toLowerCase();
      if (![...TEAMS, 'All'].includes(team) || !['All', 'S-01', 'S-02', 'S-03'].includes(sprint) || ![...STATUSES, 'All', 'Remaining'].includes(status)) throw new Error('Unknown filter');
      return data.tickets.filter(t => (team === 'All' || t.team === team) && (sprint === 'All' || t.sprint === sprint) &&
        (status === 'All' || (status === 'Remaining' && t.status !== 'Done') || t.status === status) && (!search || [t.id, t.title, t.team, t.owner, t.epic].join(' ').toLowerCase().includes(search)));
    }
    function metrics(tickets) {
      const points = tickets.reduce((n, t) => n + t.points, 0);
      const done = tickets.filter(t => t.status === 'Done').reduce((n, t) => n + t.points, 0);
      const gaps = tickets.filter(t => !t.description || !t.acceptance || !t.estimated).length;
      return {tickets: tickets.length, points, done, completion: points ? round(100 * done / points) : 0,
        blocked: tickets.filter(t => t.status === 'Blocked').length,
        hygiene: tickets.length ? round(100 * (tickets.length - gaps) / tickets.length) : 100, gaps};
    }
    function overview(data, query = {}) {
      const tickets = scoped(data, query), team = read(query, 'team', 'All');
      const teams = team === 'All' ? TEAMS : [team], m = metrics(tickets);
      const capacity = teams.map(team => {
        const current = tickets.filter(t => t.team === team), mt = metrics(current);
        const cap = data.capacity[team] * (read(query, 'sprint', 'S-03') === 'All' ? 3 : 1);
        return {team, ...mt, capacity: cap, utilization: round(mt.points / cap * 100)};
      });
      const epics = data.epics.flatMap(epic => {
        const ts = tickets.filter(t => t.epic === epic.id);
        return ts.length ? [{...epic, ...metrics(ts), current_total: data.tickets.filter(t => t.epic === epic.id).reduce((n, t) => n + t.points, 0), baseline: data.baseline[epic.id] || 0}] : [];
      });
      const history = ['S-01', 'S-02', 'S-03'].map(sprint => ({sprint, ...metrics(data.tickets.filter(t => t.sprint === sprint && teams.includes(t.team)))}));
      const risks = [];
      if (m.blocked) risks.push({kind: 'Blockers', title: `${m.blocked} work items need an unblock decision`, detail: 'Inspect blocked age, the owning team, and upstream epic dependencies.'});
      for (const c of capacity) if (c.utilization > 100) risks.push({kind: 'Capacity', title: c.team + ' is over the planning envelope', detail: `${c.points} points committed against ${c.capacity} of modeled capacity. Re-scope before adding work.`});
      if (m.gaps) risks.push({kind: 'Readiness', title: `${m.gaps} items have quality gaps`, detail: 'Missing acceptance criteria, descriptions, or estimates make commitment less reliable.'});
      const contributors = [...new Set(tickets.map(t => t.owner))].sort().map(owner => ({owner, ...metrics(tickets.filter(t => t.owner === owner))}));
      return {synthetic: true, as_of: '2026-10-14', metrics: m, capacity, tickets, epics, history,
        burndown: {ideal: Array.from({length: 11}, (_, day) => roundEven(m.points * (1 - day / 10))), actual: Array.from({length: 8}, (_, day) => roundEven(m.points - m.done * day / 7))},
        risks, contributors, reviews: data.reviews, audit: data.audit.slice(-15), baseline: data.baseline};
    }
    function number(value, fallback, min, max, integer = false) {
      const n = value === undefined ? fallback : Number(value);
      if (value === null || value === '' || typeof value === 'boolean' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error('Scenario values out of range');
      return n;
    }
    function forecast(data, body) {
      const team = body.team === undefined ? 'All' : body.team;
      const tickets = scoped(data, {team, sprint: 'S-03'});
      const staffing = number(body.staffing, 1, .25, 2), added = number(body.scope, 0, 0, 200);
      const trials = number(body.trials, 2000, 100, 10000, true);
      const velocity = ['S-01', 'S-02'].map(s => metrics(data.tickets.filter(t => t.sprint === s && (team === 'All' || t.team === team))).done);
      const m = metrics(tickets), remaining = m.points - m.done + added;
      // Mulberry32: reproducible in every browser; distribution differs from Python's RNG.
      let rngState = 33;
      const random = () => { let t = rngState += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const samples = Array.from({length: trials}, () => Math.ceil(remaining / Math.max(.1, velocity[Math.floor(random() * velocity.length)] / 10 * staffing * (.7 + .6 * random())))).sort((a, b) => a - b);
      const percentile = p => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
      const histogram = [{days: 0, count: samples.filter(x => x === 0).length}];
      for (let day = 2; day < samples[samples.length - 1] + 2; day += 2) histogram.push({days: day, count: samples.filter(x => day - 2 < x && x <= day).length});
      return {synthetic: true, remaining, velocity, p50: percentile(.5), p80: percentile(.8), p95: percentile(.95), within_10_days: round(100 * samples.filter(x => x <= 10).length / trials), histogram, trials,
        assumptions: ['Completed points from two synthetic sprints, resampled with uniform 0.7–1.3 variation.', '10 working days per sprint; staffing scales throughput linearly.', 'Illustrative model only: short history and dependencies limit predictive validity.', 'The browser uses a seeded JavaScript generator; exact quantiles may differ from the Python demo.']};
    }
    function dependencies(data, query) {
      const selected = [...new Set(scoped(data, query).map(t => t.epic))].sort();
      const allWork = scoped(data, {team: 'All', sprint: read(query, 'sprint', 'S-03')});
      const byId = new Map(data.epics.map(e => [e.id, e])), nodes = new Map(), visiting = new Set();
      function visit(id) {
        if (nodes.has(id)) return nodes.get(id);
        if (visiting.has(id)) throw new Error('Dependency cycle detected');
        if (!byId.has(id)) throw new Error('Missing dependency');
        visiting.add(id);
        const epic = byId.get(id), m = metrics(allWork.filter(t => t.epic === id));
        const duration = Math.ceil((m.points - m.done) / Math.max(1, data.capacity[epic.team] / 10));
        const upstream = epic.depends_on.map(visit);
        const latest = upstream.reduce((best, node) => !best || node.finish > best.finish ? node : best, null);
        const start = latest ? latest.finish : 0;
        const node = {id, title: epic.title, duration, start, finish: start + duration, path: [...(latest ? latest.path : []), id]};
        visiting.delete(id); nodes.set(id, node); return node;
      }
      selected.forEach(visit);
      const last = [...nodes.values()].reduce((best, node) => node.finish > best.finish ? node : best, {finish: 0, path: []});
      return {nodes: [...nodes.values()], critical_path: last.path, total_days: last.finish, synthetic: true};
    }
    function report(data, query) {
      const o = overview(data, query), m = o.metrics;
      const fields = ['id', 'title', 'team', 'epic', 'sprint', 'points', 'status', 'owner'];
      const cell = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
      return {markdown: `# Mission Control · synthetic delivery readout\n\nSnapshot: 2026-10-14 (fixed demo date)\n\n${m.tickets} stories; ${m.done}/${m.points} points complete (${m.completion}%).\n${m.blocked} blockers; readiness ${m.hygiene}%.\n\n## Decisions\n` + o.risks.map(r => '- ' + r.title + ': ' + r.detail).join('\n') + '\n\nAll records are generated. No production outcomes or customer adoption are claimed.\n',
        csv: [fields.join(','), ...o.tickets.map(t => fields.map(k => cell(t[k])).join(','))].join('\r\n') + '\r\n'};
    }
    function handle(method, path, query = {}, body = {}) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
      if (method === 'GET') {
        if (path === '/overview' || path === '/') return clone(overview(state, query));
        if (path === '/dependencies') return dependencies(state, query);
        if (path === '/report') return report(state, query);
        throw new Error('Unknown endpoint');
      }
      if (method !== 'POST') throw new Error('Unknown endpoint');
      if (path === '/forecast') return forecast(state, body);
      const data = clone(state);
      if (path === '/capacity') {
        const capacity = number(body.capacity, 0, 1, 500, true);
        if (!TEAMS.includes(body.team)) throw new Error('Choose a valid team');
        data.capacity[body.team] = capacity;
        data.audit.push({action: 'Capacity updated', detail: `${body.team}: ${capacity} points`});
      } else if (path === '/ticket' || path === '/hygiene') {
        const ticket = data.tickets.find(t => t.id === body.id);
        if (!ticket) throw new Error('Ticket not found');
        if (path === '/ticket') {
          if (!STATUSES.includes(body.status)) throw new Error('Valid status required');
          ticket.status = body.status; data.audit.push({action: 'Status updated', detail: ticket.id + ' → ' + ticket.status});
        } else { Object.assign(ticket, {description: true, acceptance: true, estimated: true}); data.audit.push({action: 'Demo readiness filled', detail: ticket.id}); }
      } else if (path === '/baseline') {
        data.baseline = Object.fromEntries(data.epics.map(e => [e.id, data.tickets.filter(t => t.epic === e.id).reduce((n, t) => n + t.points, 0)]));
        data.audit.push({action: 'Baseline saved', detail: 'All epic story-point totals captured'});
      } else if (path === '/scope') {
        const epic = data.epics.find(e => e.id === body.epic), points = number(body.points, 5, 1, 21, true);
        if (!epic) throw new Error('Valid epic required');
        const next = Math.max(0, ...data.tickets.map(t => Number(t.id.split('-')[1]))) + 1;
        data.tickets.push({id: 'WK-' + String(next).padStart(3, '0'), title: 'Synthetic scope addition', team: epic.team, epic: epic.id, sprint: 'S-03', points, status: 'Ready', owner: 'Contributor 01', description: true, acceptance: true, estimated: true, age_days: 0, cycle_days: 0, priority: 'High'});
        data.audit.push({action: 'Scope added', detail: epic.id + ': +' + points + ' points'});
      } else if (path === '/review') {
        const date = String(body.date || ''), topic = typeof body.topic === 'string' ? body.topic.trim() : '';
        const facilitator = typeof body.facilitator === 'string' ? body.facilitator.trim() : 'Demo facilitator';
        const parsed = new Date(date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date || !TEAMS.includes(body.team) || !topic.length || topic.length > 120 || !facilitator.length || facilitator.length > 80) throw new Error('Valid date, team, topic, and facilitator required');
        const existing = data.reviews.findIndex(r => r.id === body.id);
        if (body.id && existing < 0) throw new Error('Review not found');
        const next = Math.max(0, ...data.reviews.map(r => Number(r.id.split('-')[1]))) + 1;
        const row = {id: body.id || 'RV-' + String(next).padStart(2, '0'), date, team: body.team, topic, facilitator, status: 'Scheduled'};
        if (existing >= 0) data.reviews[existing] = row; else data.reviews.push(row);
        data.audit.push({action: 'Review saved', detail: row.id});
      } else if (path === '/review/delete') data.reviews = data.reviews.filter(r => r.id !== body.id);
      else if (path === '/reset') { persist(clone(initial)); return {ok: true}; }
      else throw new Error('Unknown endpoint');
      persist(data); return {ok: true};
    }
    async function api(path, body) {
      const url = new URL(path, 'https://synthetic.example');
      if (!/^\/api\/mission(?:\/|$)/.test(url.pathname)) throw new Error('Unknown endpoint');
      const endpoint = url.pathname.slice('/api/mission'.length) || '/';
      return handle(body === undefined ? 'GET' : 'POST', endpoint, url.searchParams, body === undefined ? {} : body);
    }
    return {api, handle, getState: () => clone(state)};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createMissionService};
  else if (root.MISSION_SEED && root.UI) {
    let storage;
    try { storage = root.localStorage; } catch (_) { storage = {getItem() { throw new Error('Unavailable'); }}; }
    const service = createMissionService(root.MISSION_SEED, storage, text => root.UI.toast(text));
    const previous = root.UI.api;
    root.UI.api = (path, body) => /^\/api\/mission(?:\/|\?|$)/.test(path) ? service.api(path, body) : previous(path, body);
    root.MissionDemo = service;
  }
})(typeof window !== 'undefined' ? window : globalThis);
