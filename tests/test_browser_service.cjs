/* Run with: node --test tests/test_browser_service.cjs */
'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {createMissionService} = require('../mission-control/browser-service.js');
const root = path.resolve(__dirname, '..');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'mission-control/seed.js'), 'utf8'), context);
const seed = JSON.parse(JSON.stringify(context.window.MISSION_SEED));
const make = () => createMissionService(seed);
const overview = (s, query = {}) => s.handle('GET', '/overview', query);

test('840 team/sprint/status/search combinations match Python overview and dependencies', () => {
  const script = `import importlib.util,json,sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('mission', 'mission-control/service.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ndata=m.seeded()\nqueries=[{'team':team,'sprint':sprint,'status':status,'q':search} for team in ['All']+m.TEAMS for sprint in ['All','S-01','S-02','S-03'] for status in ['All','Remaining']+m.STATUSES for search in ['', 'CATALOG', 'Contributor 01', 'WK-001', 'Platform', 'EP-03', 'no-such-story']]\nprint(json.dumps([{'query':q,'overview':m.overview(data,{k:[v] for k,v in q.items()}),'dependencies':m.dependencies(data,{k:[v] for k,v in q.items()})} for q in queries]))`;
  const expected = JSON.parse(execFileSync('python3', ['-c', script], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
  const service = make();
  assert.equal(expected.length, 840);
  for (const row of expected) {
    assert.deepEqual(overview(service, row.query), row.overview, JSON.stringify(row.query));
    assert.deepEqual(service.handle('GET', '/dependencies', row.query), row.dependencies, JSON.stringify(row.query));
  }
});

test('story, epic, team, and contributor totals reconcile exactly once', () => {
  const o = overview(make(), {sprint: 'All'});
  for (const group of ['epics', 'capacity', 'contributors']) for (const key of ['tickets', 'points', 'done', 'blocked', 'gaps']) {
    assert.equal(o[group].reduce((sum, row) => sum + row[key], 0), o.metrics[key]);
  }
});

test('status, readiness, capacity, scope, and baseline mutations update the model', () => {
  const s = make(), before = overview(s);
  const ticket = before.tickets.find(t => t.status !== 'Done');
  s.handle('POST', '/ticket', {}, {id: ticket.id, status: 'Done'});
  assert.equal(overview(s).metrics.done, before.metrics.done + ticket.points);
  const gap = overview(s).tickets.find(t => !t.description || !t.acceptance || !t.estimated);
  const gaps = overview(s).metrics.gaps;
  s.handle('POST', '/hygiene', {}, {id: gap.id});
  assert.equal(overview(s).metrics.gaps, gaps - 1);
  s.handle('POST', '/capacity', {}, {team: 'Platform', capacity: 100});
  assert.equal(overview(s, {team: 'Platform'}).capacity[0].capacity, 100);
  s.handle('POST', '/scope', {}, {epic: 'EP-01', points: 5});
  assert.equal(overview(s).metrics.points, before.metrics.points + 5);
  assert.deepEqual(overview(s).baseline, before.baseline);
  s.handle('POST', '/baseline', {}, {});
  assert.equal(overview(s).baseline['EP-01'], before.baseline['EP-01'] + 5);
});

test('local storage persists changes across adapters and reset restores seed', () => {
  const records = new Map();
  const storage = {getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value)};
  const first = createMissionService(seed, storage);
  first.handle('POST', '/capacity', {}, {team: 'Platform', capacity: 110});
  const next = createMissionService(seed, storage);
  assert.equal(overview(next, {team: 'Platform'}).capacity[0].capacity, 110);
  next.handle('POST', '/reset', {}, {});
  assert.deepEqual(next.getState(), seed);
  assert.deepEqual(createMissionService(seed, storage).getState(), seed);
});

test('storage failures retain memory changes and notify once', () => {
  const warnings = [];
  const storage = {getItem: () => null, setItem: () => {throw new Error('Denied');}};
  const s = createMissionService(seed, storage, message => warnings.push(message));
  s.handle('POST', '/capacity', {}, {team: 'Platform', capacity: 110});
  s.handle('POST', '/capacity', {}, {team: 'Platform', capacity: 120});
  assert.equal(overview(s, {team: 'Platform'}).capacity[0].capacity, 120);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /until this page closes/);
});

test('invalid input cannot alter state', () => {
  const s = make(), original = s.getState();
  for (const [route, body] of [
    ['/capacity', {team: 'Platform', capacity: 0}], ['/capacity', {team: 'Platform', capacity: 1.5}],
    ['/scope', {epic: 'EP-01', points: 22}], ['/ticket', {id: 'WK-001', status: 'Unknown'}],
    ['/hygiene', {id: 'WK-999'}], ['/forecast', {staffing: NaN}], ['/forecast', {scope: Infinity}],
    ['/forecast', {trials: 10}], ['/forecast', {trials: 100.5}], ['/review', {date: '2026-02-30', topic: 'Bad', team: 'Platform'}],
  ]) assert.throws(() => s.handle('POST', route, {}, body));
  assert.throws(() => overview(s, {team: 'Unknown'}));
  assert.throws(() => overview(s, {status: 'Unknown'}));
  assert.deepEqual(s.getState(), original);
});

test('forecast is stable, ordered, and monotonic in scope and throughput', () => {
  const s = make(), forecast = body => s.handle('POST', '/forecast', {}, {trials: 500, ...body});
  const base = forecast({}), bigger = forecast({scope: 50}), faster = forecast({staffing: 1.5});
  assert.deepEqual(base, forecast({}));
  assert.ok(base.p50 <= base.p80 && base.p80 <= base.p95);
  assert.equal(base.histogram.reduce((sum, bucket) => sum + bucket.count, 0), 500);
  for (const key of ['p50', 'p80', 'p95']) {assert.ok(bigger[key] >= base[key]); assert.ok(faster[key] <= base[key]);}
});

test('zero remaining work retains every trial in the zero-day histogram', () => {
  const doneSeed = JSON.parse(JSON.stringify(seed));
  doneSeed.tickets.forEach(t => {t.status = 'Done';});
  const result = createMissionService(doneSeed).handle('POST', '/forecast', {}, {trials: 100});
  assert.equal(result.p95, 0); assert.equal(result.within_10_days, 100);
  assert.equal(result.histogram.reduce((sum, row) => sum + row.count, 0), 100);
});

test('dependency filters preserve cross-team prerequisite duration and reject cycles', () => {
  const s = make(), all = s.handle('GET', '/dependencies', {});
  const filtered = s.handle('GET', '/dependencies', {team: 'Experience'});
  for (const row of filtered.nodes) assert.equal(row.duration, all.nodes.find(n => n.id === row.id).duration);
  const cyclic = JSON.parse(JSON.stringify(seed));
  cyclic.epics[0].depends_on = ['EP-02']; cyclic.epics[1].depends_on = ['EP-01'];
  assert.throws(() => createMissionService(cyclic).handle('GET', '/dependencies'), /cycle/);
});

test('report totals and CSV rows match the selected overview', () => {
  const s = make(), query = {team: 'Experience', sprint: 'S-02', status: 'Done', q: 'onboarding'};
  const o = overview(s, query), report = s.handle('GET', '/report', query);
  const lines = report.csv.trim().split('\r\n');
  assert.equal(lines.length - 1, o.metrics.tickets);
  assert.equal(lines.slice(1).reduce((sum, line) => sum + Number(line.split(',')[5]), 0), o.metrics.points);
  assert.ok(report.markdown.includes(`${o.metrics.tickets} stories; ${o.metrics.done}/${o.metrics.points} points complete`));
  assert.ok(o.tickets.every(t => t.status === 'Done' && t.title.toLowerCase().includes('onboarding')));
  assert.deepEqual(o.history, overview(s, {team: 'Experience', sprint: 'S-02'}).history);
});

test('review create, edit, and delete persist and preserve safe literal input', () => {
  const s = make(), count = s.getState().reviews.length;
  const body = {date: '2026-10-23', team: 'Platform', topic: '<b>Literal demo text</b>', facilitator: 'Demo D'};
  s.handle('POST', '/review', {}, body);
  const row = s.getState().reviews.at(-1);
  assert.equal(s.getState().reviews.length, count + 1); assert.equal(row.topic, body.topic);
  s.handle('POST', '/review', {}, {...row, topic: 'Updated'});
  assert.equal(s.getState().reviews.at(-1).topic, 'Updated');
  s.handle('POST', '/review/delete', {}, {id: row.id});
  assert.equal(s.getState().reviews.length, count);
});

test('empty scopes are finite and async API rejects unrelated routes', async () => {
  const empty = JSON.parse(JSON.stringify(seed)); empty.tickets = [];
  const s = createMissionService(empty), o = overview(s);
  assert.equal(o.metrics.points, 0); assert.equal(o.metrics.hygiene, 100);
  assert.equal(s.handle('GET', '/dependencies').total_days, 0);
  assert.deepEqual(await make().api('/api/mission/overview?team=Platform&status=Done&q=catalog'), overview(make(), {team: 'Platform', status: 'Done', q: 'catalog'}));
  await assert.rejects(make().api('/api/other/reset', {}), /Unknown/);
});

test('browser script installs an API adapter without a network backend', async () => {
  let networkCalls = 0;
  const browser = {MISSION_SEED: seed, UI: {toast() {}, api() {networkCalls++; throw new Error('Network unavailable');}}, localStorage: {getItem: () => null, setItem() {}}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'mission-control/browser-service.js'), 'utf8'), {window: browser, URL, URLSearchParams});
  const before = await browser.UI.api('/api/mission/overview?team=Platform');
  await browser.UI.api('/api/mission/capacity', {team: 'Platform', capacity: 105});
  const after = await browser.UI.api('/api/mission/overview?team=Platform');
  assert.equal(before.capacity[0].capacity, seed.capacity.Platform);
  assert.equal(after.capacity[0].capacity, 105);
  assert.equal(networkCalls, 0);
});

 test('remaining drill excludes completed stories and filters do not change capacity window', () => {
 const service=make(), all=overview(service), remaining=overview(service,{status:'Remaining'});
 assert.equal(remaining.metrics.done,0);
 assert.equal(remaining.metrics.points,all.metrics.points-all.metrics.done);
 assert.ok(remaining.tickets.every(t=>t.status!=='Done'));
 const narrow=overview(service,{team:'Platform',sprint:'All',q:'WK-001'});
 assert.equal(narrow.capacity[0].capacity,seed.capacity.Platform*3);
 });
