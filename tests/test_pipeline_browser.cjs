/* node --test tests/test_pipeline_browser.cjs; standard libraries only. */
'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');
const {createRelayService}=require('../pipeline-rescue/browser-service.js');
const root=path.resolve(__dirname,'..'),context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'pipeline-rescue/seed.js'),'utf8'),context);
const seed=JSON.parse(JSON.stringify(context.window.RELAY_SEED));
const make=(storage,warning)=>createRelayService(seed,storage,warning);
const get=(service,route,query={})=>service.handle('GET',route,query,{});
const post=(service,route,body={})=>service.handle('POST',route,{},body);
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['received_at','recorded_at'].includes(key)).map(([key,item])=>[key,clean(item)])):value;
const event=(id,changes={})=>({event_id:id,order_id:'REL-001',type:'packed',occurred_at:'2026-10-14T11:45:00Z',delay_minutes:0,...changes});
const memory=()=>{const items=new Map();return {getItem:key=>items.get(key)||null,setItem:(key,value)=>items.set(key,value)};};
async function snapshot(service){return clean({summary:await get(service,'/summary'),orders:await get(service,'/orders'),quarantine:await get(service,'/quarantine'),audit:await get(service,'/audit')});}

test('Python and browser pipeline outputs match across fixture, faults, repair, allocations, weather and replay',async()=>{
  const script=String.raw`import importlib.util,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('relay_parity','pipeline-rescue/service.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tmp=tempfile.TemporaryDirectory();m.DB_PATH=Path(tmp.name)/'test.sqlite3'
def get(p):return m.handle('GET',p,{}, {})
def post(p,b={}):return m.handle('POST',p,{},b)
def snap():return {'summary':get('/summary'),'orders':get('/orders'),'quarantine':get('/quarantine'),'audit':get('/audit')}
out=[snap()]
post('/allocate',{'budget':1200});out.append(snap())
post('/disrupt',{'scenario':'scanner'});out.append(snap())
q=next(q for q in get('/quarantine')['rows'] if q['reason_code']=='BAD_DELAY')
post('/repair',{'raw_id':q['raw_id'],'patch':{'delay_minutes':90}});out.append(snap())
post('/replay');out.append(snap())
post('/allocate',{'budget':300});out.append(snap())
post('/disrupt',{'scenario':'weather'});out.append(snap())
post('/disrupt',{'scenario':'late'});out.append(snap())
post('/replay');out.append(snap())
for budget in [0,79,80,300,1200,5000]:out.append(post('/allocate',{'budget':budget}))
print(json.dumps(out))
tmp.cleanup()`;
  const expected=clean(JSON.parse(execFileSync('python3',['-c',script],{cwd:root,encoding:'utf8',maxBuffer:8_000_000}))),s=make(),actual=[await snapshot(s)];
  await post(s,'/allocate',{budget:1200});actual.push(await snapshot(s));
  await post(s,'/disrupt',{scenario:'scanner'});actual.push(await snapshot(s));
  const q=(await get(s,'/quarantine')).rows.find(q=>q.reason_code==='BAD_DELAY');
  await post(s,'/repair',{raw_id:q.raw_id,patch:{delay_minutes:90}});actual.push(await snapshot(s));
  await post(s,'/replay');actual.push(await snapshot(s));
  await post(s,'/allocate',{budget:300});actual.push(await snapshot(s));
  await post(s,'/disrupt',{scenario:'weather'});actual.push(await snapshot(s));
  await post(s,'/disrupt',{scenario:'late'});actual.push(await snapshot(s));
  await post(s,'/replay');actual.push(await snapshot(s));
  for(const budget of [0,79,80,300,1200,5000])actual.push(await post(s,'/allocate',{budget}));
  for(let i=0;i<expected.length;i++)assert.deepEqual(actual[i],expected[i],`Parity at workflow stage ${i}`);
});

test('raw arrivals reconcile and duplicates or conflicting identifiers never overwrite accepted evidence',async()=>{
  const s=make(),before=await get(s,'/summary');assert.deepEqual(before.counts,{raw:205,validated:201,duplicates:1,quarantined:3,quarantine_open:3,quarantine_resolved:0,late:1,reconciled:true});
  const original=(await get(s,'/lineage',{order_id:['REL-001']})).validated[0].payload;
  const duplicate=await post(s,'/ingest',{events:[original,original]});assert.equal(duplicate.batch.duplicate,2);
  assert.equal((await get(s,'/summary')).projection_digest,before.projection_digest);
  await post(s,'/ingest',{events:[{...original,delay_minutes:10}]});
  assert.equal((await get(s,'/quarantine')).rows[0].reason_code,'EVENT_ID_CONFLICT');
  assert.deepEqual((await get(s,'/lineage',{order_id:['REL-001']})).validated.find(e=>e.event_id===original.event_id).payload,original);
  assert.equal((await get(s,'/summary')).counts.reconciled,true);
});

test('validation quarantines nonobjects, invalid time, impossible date, type, delay and unknown order',async()=>{
  const s=make(),bad=[null,event('BAD-TIME',{occurred_at:'yesterday'}),event('BAD-DATE',{occurred_at:'2026-02-30T00:00:00Z'}),event('NO-ZONE',{occurred_at:'2026-10-14T00:00:00'}),event('BAD-TYPE',{type:'teleport'}),event('BAD-DELAY',{delay_minutes:true}),event('BAD-ORDER',{order_id:'unknown'}),event('FUTURE',{occurred_at:'2026-10-16T00:00:00Z'})];
  const result=await post(s,'/ingest',{events:bad});assert.equal(result.batch.quarantined,bad.length);assert.equal(result.batch.validated,0);
  const reasons=new Set((await get(s,'/quarantine')).rows.map(q=>q.reason_code));for(const reason of ['NON_OBJECT','BAD_TIMESTAMP','BAD_EVENT_TYPE','BAD_DELAY','UNKNOWN_ORDER','FUTURE_EVENT'])assert.ok(reasons.has(reason));
});

test('late event time cannot regress lifecycle progress and delivered remains terminal',async()=>{
  const s=make(),before=await get(s,'/lineage',{order_id:['REL-001']});
  await post(s,'/ingest',{events:[event('LATE-TEST',{type:'created',occurred_at:'2026-10-10T01:00:00Z'})]});
  const after=await get(s,'/lineage',{order_id:['REL-001']});assert.equal(after.order.status,before.order.status);assert.equal(after.order.last_event_at,before.order.last_event_at);assert.equal(after.validated.find(e=>e.event_id==='LATE-TEST').is_late,1);
  const delivered=(await get(s,'/orders')).orders.find(o=>o.status==='delivered');
  await post(s,'/ingest',{events:[event('TERMINAL-TEST',{order_id:delivered.order_id,type:'exception',delay_minutes:180})]});
  const terminal=(await get(s,'/lineage',{order_id:[delivered.order_id]})).order;assert.equal(terminal.status,'delivered');assert.equal(terminal.risk_score,0);
});

test('repairs append immutable evidence; replay and repeated repair are idempotent',async()=>{
  const s=make(),q=(await get(s,'/quarantine')).rows.find(q=>q.reason_code==='BAD_DELAY');
  const result=await post(s,'/repair',{raw_id:q.raw_id,patch:{delay_minutes:90}});assert.equal(result.batch.validated,1);
  const resolved=(await get(s,'/quarantine')).rows.find(row=>row.raw_id===q.raw_id);assert.deepEqual(resolved.payload,q.payload);assert.equal(resolved.status,'resolved');
  const before=await get(s,'/audit');for(let i=0;i<2;i++){const replay=await post(s,'/replay');assert.equal(replay.idempotent,true);assert.equal(replay.after_digest,before.projection_digest);assert.deepEqual(replay.counts,before.counts);assert.equal((await get(s,'/audit')).raw_digest,before.raw_digest);}
  const repeated=await post(s,'/repair',{raw_id:q.raw_id,patch:{delay_minutes:90}});assert.equal(repeated.already_resolved,true);assert.deepEqual(repeated.counts,before.counts);
});

test('budget choices are unique, feasible and at least as good as the shared-model baseline',async()=>{
  const s=make(),orders=Object.fromEntries((await get(s,'/orders')).orders.map(o=>[o.order_id,o]));
  for(const budget of [0,79,80,300,1200,5000]){const p=await post(s,'/allocate',{budget}),selected=p.optimized.order_ids;assert.equal(new Set(selected).size,selected.length);assert.ok(p.optimized.spent<=budget);assert.equal(selected.reduce((sum,id)=>sum+orders[id].expedite_cost,0),p.optimized.spent);assert.ok(p.optimized.avoidable_exposure>=p.baseline.avoidable_exposure);assert.equal(p.optimized.spent+p.unspent,budget);}
});

test('proposal survives invalid-only batches and no-op replay but clears for changed projection',async()=>{
  const s=make(),proposal=await post(s,'/allocate',{budget:1200});await post(s,'/replay');assert.deepEqual((await get(s,'/summary')).latest_allocation,proposal);
  await post(s,'/disrupt',{scenario:'scanner'});assert.deepEqual((await get(s,'/summary')).latest_allocation,proposal);
  await post(s,'/disrupt',{scenario:'weather'});assert.equal((await get(s,'/summary')).latest_allocation,null);
  await post(s,'/allocate',{budget:1200});const q=(await get(s,'/quarantine')).rows.find(q=>q.reason_code==='BAD_DELAY');await post(s,'/repair',{raw_id:q.raw_id,patch:{delay_minutes:60}});assert.equal((await get(s,'/summary')).latest_allocation,null);
});

test('storage restores browser changes and reset restores fixture and fingerprints',async()=>{
  const storage=memory(),a=make(storage),initial=await get(a,'/summary');await post(a,'/disrupt',{scenario:'weather'});await post(a,'/allocate',{budget:1200});
  const b=make(storage);assert.deepEqual(await get(b,'/summary'),await get(a,'/summary'));assert.deepEqual(await post(b,'/reset'),initial);assert.deepEqual(await get(make(storage),'/summary'),initial);
});

test('storage read and write failures preserve memory changes and warn once',async()=>{
  const warnings=[],storage={getItem(){return null;},setItem(){throw new Error('storage quota');}},s=make(storage,text=>warnings.push(text));
  await post(s,'/disrupt',{scenario:'weather'});await post(s,'/allocate',{budget:300});assert.equal(warnings.length,1);assert.equal((await get(s,'/summary')).latest_allocation.budget,300);
  const reads=[],r=make({getItem(){throw new Error('blocked');}},text=>reads.push(text));await get(r,'/summary');assert.equal(reads.length,1);
});

test('invalid mutations are atomic, unrelated routes reject, and concurrent arrivals serialize',async()=>{
  const s=make(),before=await snapshot(s),q=(await get(s,'/quarantine')).rows.find(q=>q.reason_code==='BAD_DELAY');
  for(const [route,body] of [['/allocate',{budget:-1}],['/allocate',{budget:true}],['/allocate',{budget:5001}],['/repair',{raw_id:q.raw_id,patch:{delay_minutes:-1}}],['/ingest',{events:[]}],['/disrupt',{scenario:'unknown'}]])await assert.rejects(post(s,route,body));
  assert.deepEqual(await snapshot(s),before);await assert.rejects(s.api('/api/unrelated/reset',{}));await assert.rejects(get(s,'/unknown'));
  const incoming=event('CONCURRENT');await Promise.all([post(s,'/ingest',{events:[incoming]}),post(s,'/ingest',{events:[incoming]})]);const after=await get(s,'/summary');assert.equal(after.counts.validated,before.summary.counts.validated+1);assert.equal(after.counts.duplicates,before.summary.counts.duplicates+1);
});

test('empty intervention candidates produce a finite empty allocation',async()=>{
  const s=make();await post(s,'/ingest',{events:seed.orders.map(o=>event('COMPLETE-'+o.order_id,{order_id:o.order_id,type:'delivered'}))});
  const result=await post(s,'/allocate',{budget:1200});assert.equal(result.candidate_count,0);assert.deepEqual(result.optimized,{order_ids:[],count:0,spent:0,avoidable_exposure:0});assert.equal(result.unspent,1200);assert.ok(!JSON.stringify(result).includes('null'));
  for(const scenario of ['weather','scanner','late'])await assert.rejects(post(s,'/disrupt',{scenario}));
});

test('browser wrapper serves all UI calls locally without invoking network API',async()=>{
  let network=0;const window={RELAY_SEED:seed,crypto:webcrypto,localStorage:memory(),UI:{api:async()=>{network++;return 'other';},toast(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pipeline-rescue/browser-service.js'),'utf8'),{window,TextEncoder,URL,URLSearchParams});
  assert.ok(window.RelayDemo);const summary=await window.UI.api('/api/pipeline/summary');assert.equal(summary.counts.raw,205);
  await window.UI.api('/api/pipeline/allocate',{budget:300});await window.UI.api('/api/pipeline/replay',{});assert.equal(network,0);
  assert.equal(await window.UI.api('/api/other/summary'),'other');assert.equal(network,1);
});
