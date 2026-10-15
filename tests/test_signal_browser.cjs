/* Run: node --test tests/test_signal_browser.cjs. No npm dependencies. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createSignalService} = require('../signal-lab/browser-service.js');
const service = createSignalService();

function near(actual, expected, label='number', relative=1e-12, absolute=2e-15) {
  assert.ok(Number.isFinite(actual), `${label} must be finite`);
  assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.max(Math.abs(expected),Math.abs(actual)), `${label}: ${actual} != ${expected}`);
}
function parity(actual,expected,where='result') {
  if(typeof expected==='number')return near(actual,expected,where);
  if(expected===null||typeof expected!=='object')return assert.equal(actual,expected,where);
  if(Array.isArray(expected)) {
    assert.ok(Array.isArray(actual),where);assert.equal(actual.length,expected.length,where+'.length');
    expected.forEach((value,i)=>parity(actual[i],value,`${where}[${i}]`));return;
  }
  for(const key of Object.keys(expected)) {
    // Python's .4g and JS's toPrecision render exponents/trailing zeroes differently.
    if(where==='result.checks[0]'&&key==='detail')continue;
    parity(actual[key],expected[key],`${where}.${key}`);
  }
}

test('generation is reproducible, fresh to callers, and respects user/funnel contracts',()=>{
  const first=service.generate(),second=service.generate();assert.deepEqual(first,second);
  assert.equal(first.length,2400);assert.equal(new Set(first.map(r=>r.user_id)).size,2400);
  assert.ok(first.every(r=>r.activated_7d<=r.import_completed&&r.retained_14d<=r.activated_7d&&r.invited_teammate<=r.activated_7d));
  assert.ok(first.every(r=>r.signup_day>=1&&r.signup_day<=28));
  first[0].activated_7d=999;assert.deepEqual(service.generate(),second);
  assert.notDeepEqual(service.generate({seed:43}),second);
  assert.deepEqual(createSignalService().generate(),second);
});

test('real analysis distinguishes healthy lift, harmful friction, corrupted assignment and null',()=>{
  assert.equal(service.analyze().decision,'SHIP');
  assert.equal(service.analyze({friction:.08}).decision,'ROLL BACK');
  assert.equal(service.analyze({allocation:.68}).decision,'INVALID');
  assert.equal(service.analyze({lift:0}).decision,'HOLD');
  assert.notEqual(service.analyze({n:100}).decision,'SHIP');
  const healthy=service.analyze();assert.ok(healthy.checks.every(check=>check.passed));
  assert.equal(healthy.n,healthy.primary.control.n+healthy.primary.treatment.n);
  near(healthy.primary.delta,healthy.primary.treatment.rate-healthy.primary.control.rate);
  assert.deepEqual(healthy.runtime,{engine:'browser',rng:'mulberry32-v1',generator_version:1});
});

test('interval inference handles extremes and is symmetric under arm reversal',()=>{
  for(const outcome of [0,1]) {
    const rows=['control','treatment'].flatMap(arm=>Array.from({length:25},()=>({arm,x:outcome})));
    const result=service.effectMetric(rows,'x');assert.equal(result.delta,0);assert.equal(result.p_value,1);
    assert.ok(result.ci[0]<=0&&result.ci[1]>=0);
  }
  assert.equal(service.effectMetric([{arm:'control',x:1}],'x').delta,null);
  const rows=service.generate(),a=service.effectMetric(rows,'activated_7d');
  const b=service.effectMetric(rows.map(r=>({...r,arm:r.arm==='control'?'treatment':'control'})),'activated_7d');
  near(a.delta,-b.delta);near(a.ci[0],-b.ci[1]);near(a.ci[1],-b.ci[0]);near(a.p_value,b.p_value);
});

test('tail probability calculation is accurate near zero and into the extreme tail',()=>{
  for(const [x,expected] of [[0,1],[.5,.4795001221869535],[1,.15729920705028513],[2,.004677734981047265],[3,.00002209049699858544],[10,2.088487583762545e-45]]) {
    near(service.erfc(x),expected,`erfc(${x})`,2e-12,1e-300);
  }
  near(service.erfc(-1),2-service.erfc(1));
  assert.equal(service.sampleRatio([{arm:'control'},{arm:'treatment'}]).p_value,1);
  assert.ok(service.sampleRatio(Array.from({length:100},(_,i)=>({arm:i<10?'control':'treatment'}))).failed);
});

test('A/A evaluation performs actual seeded trials and protects cached outputs',()=>{
  const result=service.evaluate(200,42);assert.equal(result.false_positives,8);assert.equal(result.false_positive_rate,.04);assert.equal(result.coverage,.96);
  assert.equal(result.trials,200);assert.equal(result.users_per_trial,1200);
  assert.ok(result.false_positive_rate_ci[0]<.05&&result.false_positive_rate_ci[1]>.05);
  assert.notEqual(result.mean_estimated_effect,service.evaluate(200,43).mean_estimated_effect);
  result.false_positive_rate_ci[0]=999;assert.ok(service.evaluate(200,42).false_positive_rate_ci[0]<1);
});

test('roadmap is capacity-feasible, dependency-complete and optimal across all capacities',()=>{
  let last=0;
  for(let capacity=0;capacity<=30;capacity++) {
    const result=service.optimizeRoadmap(capacity),selected=result.features.filter(f=>f.selected),ids=new Set(result.selected_ids);
    assert.ok(selected.every(f=>f.requires.every(id=>ids.has(id))));assert.ok(result.used<=capacity);
    assert.equal(result.value,selected.reduce((sum,f)=>sum+f.value,0));assert.ok(result.value>=last);last=result.value;
    // Independent recursive include/exclude search; do not reuse the engine's bit masks.
    let best=0;function search(i,chosen){if(i<result.features.length){search(i+1,chosen);search(i+1,[...chosen,result.features[i]]);return;}
      const keys=new Set(chosen.map(f=>f.id));if(chosen.reduce((s,f)=>s+f.effort,0)<=capacity&&chosen.every(f=>f.requires.every(id=>keys.has(id))))best=Math.max(best,chosen.reduce((s,f)=>s+f.value,0));}
    search(0,[]);assert.equal(result.value,best);
  }
  assert.deepEqual(service.optimizeRoadmap(0).selected_ids,[]);
  assert.equal(service.optimizeRoadmap(12).value,46);
});

test('every endpoint accepts documented inputs and rejects invalid bounded parameters',()=>{
  assert.equal(service.handle('GET','/overview',{n:['500'],seed:['10']}).n,500);
  assert.equal(service.handle('POST','/analyze',{},{}).decision,'SHIP');
  assert.equal(service.handle('GET','/events',{n:['100']}).rows.length,100);
  assert.equal(service.handle('GET','/roadmap',{capacity:['12']}).value,46);
  assert.equal(service.handle('POST','/roadmap',{}, {capacity:0}).used,0);
  assert.equal(service.handle('GET','/evaluate',{trials:['20']}).trials,20);
  for(const input of [{n:1},{n:500.5},{seed:'oops'},{lift:NaN},{allocation:1},{n:''},{friction:Infinity}])assert.throws(()=>service.analyze(input));
  assert.throws(()=>service.evaluate(501));assert.throws(()=>service.optimizeRoadmap(31));assert.throws(()=>service.handle('GET','/unknown'));
});

test('browser adapter works without fetch, delegates other APIs and installs once',async()=>{
  let fallbacks=0;
  const context={document:{},URL,setTimeout,location:{href:'https://portfolio.example/signal-lab/',origin:'https://portfolio.example'},UI:{api:async()=>{fallbacks++;return {delegated:true};}}};
  vm.createContext(context);const code=fs.readFileSync(path.join(__dirname,'../signal-lab/browser-service.js'),'utf8');vm.runInContext(code,context);
  const installed=context.UI.api;vm.runInContext(code,context);assert.equal(context.UI.api,installed);
  const result=await context.UI.api('/api/signal/analyze',{n:2400});assert.equal(result.decision,'SHIP');assert.equal(fallbacks,0);
  const rows=await context.UI.api('/api/signal/events?n=100&seed=5');assert.equal(rows.rows.length,100);assert.equal(rows.parameters.seed,5);
  assert.equal((await context.UI.api('/api/mission/overview')).delegated,true);
  assert.equal((await context.UI.api('/api/signalish')).delegated,true);
  assert.equal((await context.UI.api('https://other.example/api/signal/overview')).delegated,true);assert.equal(fallbacks,3);
  await assert.rejects(context.UI.api('/api/signal/analyze',{n:-1}));
});

test('a slower earlier UI scenario cannot overwrite the latest decision or exported readout',async()=>{
  const elements=new Map(),pending=[],downloads=[];
  const makeElement=()=>({value:'',disabled:false,textContent:'',innerHTML:'',addEventListener(){},classList:{toggle(){}},querySelector(){return makeElement();}});
  const inputValues={n:'2400',seed:'42',lift:'7',friction:'0',allocation:'50'};
  const form=makeElement();form.elements=Object.fromEntries(Object.entries(inputValues).map(([key,value])=>[key,{...makeElement(),value}]));
  const submit=makeElement();form.querySelector=()=>submit;elements.set('#experiment-form',form);
  const scenarios=['clean','friction','broken','null'].map(scenario=>({...makeElement(),dataset:{scenario}}));
  const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,makeElement());return elements.get(selector);},
    querySelectorAll(selector){return selector==='[data-scenario]'?scenarios:[];}};
  class FakeFormData {constructor(source){this.source=source;}get(key){return this.source.elements[key].value;}}
  const context={document,FormData:FakeFormData,URLSearchParams,UI:{e:v=>String(v??''),n:v=>String(v),api:(route,body)=>new Promise(resolve=>pending.push({resolve,body})),toast(){},download:(...args)=>downloads.push(args)}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../signal-lab/app.js'),'utf8'),context);
  assert.equal(pending.length,1);scenarios[1].onclick();assert.equal(pending.length,2);
  pending[1].resolve(service.analyze(pending[1].body));await new Promise(resolve=>setImmediate(resolve));
  const latestHtml=elements.get('#experiment-result').innerHTML;assert.ok(latestHtml.includes('ROLL BACK'));
  pending[0].resolve(service.analyze(pending[0].body));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('#experiment-result').innerHTML,latestHtml);
  elements.get('#export-readout').onclick();assert.equal(downloads.length,1);assert.ok(downloads[0][1].includes('Decision: ROLL BACK'));
  assert.ok(downloads[0][1].includes('mulberry32-v1'));assert.equal(submit.disabled,false);
});

test('Python/JavaScript analysis agree on shared user rows and all 31 roadmap capacities',()=>{
  const source=path.join(__dirname,'../signal-lab/service.py');
  const code=`import importlib.util, json, sys
spec=importlib.util.spec_from_file_location('signal_reference',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenarios=[]
for values in [{},{'friction':.08},{'allocation':.68},{'lift':0},{'n':100,'lift':-.18,'allocation':.1}]:
    p=m.parameters(values);rows=m.generate(p)
    scenarios.append({'parameters':p,'rows':rows,'analysis':m.analyze_rows(rows,p)})
print(json.dumps({'scenarios':scenarios,'roadmaps':[m.optimize_roadmap(c) for c in range(31)]}))`;
  const fixture=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',code,source],{encoding:'utf8',maxBuffer:16*1024*1024}));
  for(const scenario of fixture.scenarios)parity(service.analyzeRows(scenario.rows,scenario.parameters),scenario.analysis);
  fixture.roadmaps.forEach((expected,capacity)=>parity(service.optimizeRoadmap(capacity),expected));
});
