/*
 * Original dependency-free Signal Lab browser engine.
 * RNG: mulberry32-v1, unsigned 32-bit state, one deterministic uniform per draw.
 * This deliberately differs from Python's Mersenne Twister; compare engines on
 * shared user rows to test statistical parity, not by comparing unrelated draws.
 */
(function install(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root && root.document) {
    root.SignalBrowser = exported;
    if (!root.UI || typeof root.UI.api !== 'function') throw new Error('Load /assets/ui.js before Signal Lab browser-service.js.');
    if (root.UI.api.signalRuntime === 'browser-mulberry32-v1') return;
    const service = exported.createSignalService();
    const previousApi = root.UI.api;
    root.UI.api = async function signalApi(path, body) {
      const url = new URL(path, root.location.href);
      if (url.origin !== root.location.origin || !/^\/api\/signal(?:\/|$)/.test(url.pathname)) {
        return previousApi.call(this, path, body);
      }
      // Let the UI paint its pending state before a bounded local simulation.
      await new Promise(resolve => root.setTimeout(resolve, 0));
      const query = {};
      for (const [key, value] of url.searchParams) (query[key] ||= []).push(value);
      return service.handle(body === undefined ? 'GET' : 'POST', url.pathname.slice('/api/signal'.length) || '/', query, body || {});
    };
    root.UI.api.signalRuntime = 'browser-mulberry32-v1';
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildSignalEngine() {
  'use strict';
  const FEATURES = [
    {id:'identity',name:'Reliable identity stitching',effort:3,value:9,requires:[],evidence:'Prerequisite for cross-device activation measurement.'},
    {id:'guided',name:'Guided first workspace',effort:4,value:17,requires:['identity'],evidence:'Synthetic onboarding experiment motivates a focused next iteration.'},
    {id:'imports',name:'Import recovery workflow',effort:3,value:12,requires:[],evidence:'Hypothesis: recover users after a failed first import.'},
    {id:'collaboration',name:'Team activation prompts',effort:4,value:15,requires:['identity'],evidence:'Hypothesis: team invitations improve shared workspace activation.'},
    {id:'observability',name:'Experiment guardrail monitor',effort:2,value:8,requires:['identity'],evidence:'Needed before scaling experiment exposure.'},
    {id:'templates',name:'Role-based workspace templates',effort:5,value:19,requires:['guided'],evidence:"Hypothesis: tailor first value to the user's job."},
    {id:'export',name:'Scheduled stakeholder exports',effort:2,value:6,requires:[],evidence:'Hypothesis: reduce repeated manual reporting.'},
    {id:'enterprise',name:'Enterprise onboarding policy',effort:3,value:11,requires:['observability'],evidence:'Hypothesis: governed setup supports larger workspaces.'},
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const runtime = {engine:'browser',rng:'mulberry32-v1',generator_version:1};
  function numeric(value, fallback, lower, upper, integer=false) {
    if (value == null) return fallback;
    if (Array.isArray(value)) value = value.length ? value[0] : fallback;
    if (typeof value === 'string' && !value.trim()) throw new Error('Parameters must be numeric.');
    if (!['number','string','boolean'].includes(typeof value)) throw new Error('Parameters must be numeric.');
    const result = Number(value);
    if (!Number.isFinite(result) || result < lower || result > upper) throw new Error(`Parameter must be between ${lower} and ${upper}.`);
    if (integer && !Number.isInteger(result)) throw new Error('Expected a whole number.');
    return result;
  }
  function parameters(values={}) {
    return {seed:numeric(values.seed,42,0,1000000,true),n:numeric(values.n,2400,100,20000,true),
      lift:numeric(values.lift,.07,-.18,.25),friction:numeric(values.friction,0,0,.15),allocation:numeric(values.allocation,.5,.1,.9)};
  }
  function randomSource(seed) {
    let state = seed >>> 0;
    return function uniform() {
      state = (state + 0x6D2B79F5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), state | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  // erfc(x) = Q(1/2, x²). A convergent gamma series near zero and continued
  // fraction in the tail preserve small p-values without subtractive cancellation.
  function erfc(x) {
    if (Number.isNaN(x)) return NaN;
    if (x < 0) return 2 - erfc(-x);
    if (x === 0) return 1;
    if (x > 27) return 0;
    const a = .5, y = x*x, exponent = -y + a*Math.log(y) - .5*Math.log(Math.PI);
    if (y < 1.5) {
      let sum = 1/a, term = sum, denominator = a;
      for (let i=1;i<=200;i++) {
        denominator += 1; term *= y/denominator; sum += term;
        if (Math.abs(term) <= Math.abs(sum)*2e-16) break;
      }
      return Math.max(0,Math.min(1,1-sum*Math.exp(exponent)));
    }
    const floor = 1e-300;
    let b=y+1-a,c=1/floor,d=1/b,h=d;
    for (let i=1;i<=300;i++) {
      const numerator = -i*(i-a);
      b += 2; d = numerator*d+b; if (Math.abs(d)<floor) d=floor;
      c = b+numerator/c; if (Math.abs(c)<floor) c=floor;
      d = 1/d; const factor=d*c; h *= factor;
      if (Math.abs(factor-1)<2e-15) break;
    }
    return Math.max(0,Math.min(1,Math.exp(exponent)*h));
  }
  function wilson(successes,total,z=1.959963984540054) {
    if (!total) return [0,1];
    const p=successes/total,divisor=1+z*z/total,center=(p+z*z/(2*total))/divisor;
    const radius=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/divisor;
    return [Math.max(0,center-radius),Math.min(1,center+radius)];
  }
  function effectMetric(rows,field) {
    const arms={};
    for (const arm of ['control','treatment']) {
      const group=rows.filter(row=>row.arm===arm),successes=group.reduce((sum,row)=>sum+Number(row[field]),0);
      arms[arm]={n:group.length,successes,rate:group.length?successes/group.length:null,ci:wilson(successes,group.length)};
    }
    const c=arms.control,t=arms.treatment;
    if (!c.n || !t.n) return {...arms,delta:null,ci:[null,null],p_value:null};
    const delta=t.rate-c.rate;
    const low=delta-Math.sqrt((t.rate-t.ci[0])**2+(c.ci[1]-c.rate)**2);
    const high=delta+Math.sqrt((t.ci[1]-t.rate)**2+(c.rate-c.ci[0])**2);
    const pooled=(c.successes+t.successes)/(c.n+t.n),se=Math.sqrt(pooled*(1-pooled)*(1/c.n+1/t.n));
    return {...arms,delta,ci:[Math.max(-1,low),Math.min(1,high)],p_value:se?erfc(Math.abs(delta/se)/Math.sqrt(2)):1};
  }
  function sampleRatio(rows) {
    const control=rows.filter(row=>row.arm==='control').length,treatment=rows.filter(row=>row.arm==='treatment').length;
    const expected=rows.length/2,chi_square=expected?((control-expected)**2+(treatment-expected)**2)/expected:0;
    const p=erfc(Math.sqrt(chi_square/2));
    return {control,treatment,expected_treatment:.5,chi_square,p_value:p,failed:p<.001};
  }
  function analyzeRows(rows,values={}) {
    const p=parameters(values),primary=effectMetric(rows,'activated_7d'),guardrail=effectMetric(rows,'support_contact_7d'),srm=sampleRatio(rows);
    const checks=[
      {name:'Assignment integrity',passed:!srm.failed,detail:`50:50 sample-ratio test p=${Number(srm.p_value.toPrecision(4))}; must be ≥ 0.001.`},
      {name:'Minimum sample',passed:Math.min(primary.control.n,primary.treatment.n)>=400,detail:'At least 400 complete users per arm; this is a demo threshold, not a power calculation.'},
      {name:'Evidence of activation improvement',passed:primary.ci[0]!==null&&primary.ci[0]>0,detail:"Primary metric's two-sided 95% interval must exclude zero on the positive side."},
      {name:'Practical effect',passed:primary.delta!==null&&primary.delta>=.03,detail:'Observed activation improvement must reach the predeclared +3 percentage-point target.'},
      {name:'Support guardrail',passed:guardrail.ci[1]!==null&&guardrail.ci[1]<.03,detail:'Upper 95% interval for added support contacts must remain below +3 percentage points.'},
    ];
    const harm=guardrail.ci[0]!==null&&guardrail.ci[0]>=.03;
    const decision=srm.failed?'INVALID':harm?'ROLL BACK':checks.every(c=>c.passed)?'SHIP':'HOLD';
    const explanations={INVALID:'Assignment is inconsistent with the planned split. Repair instrumentation and rerun before interpreting outcomes.',
      'ROLL BACK':'Support-contact harm exceeds the predeclared tolerance. Investigate friction before another rollout.',
      SHIP:'This simulated result clears the predeclared checks. A staged rollout with monitoring is the next step.',
      HOLD:'At least one predeclared check is unmet. The evidence does not justify a full rollout.'};
    const segments=['Enterprise','Self-serve'].map(segment=>{const group=rows.filter(row=>row.segment===segment);return {segment,n:group.length,...effectMetric(group,'activated_7d')};});
    const funnel=[[null,'Assigned'],['import_completed','Import completed'],['activated_7d','Activated ≤7 days'],['retained_14d','Retained at 14 days']].map(([key,step])=>{
      const item={step};for(const arm of ['control','treatment']){const group=rows.filter(row=>row.arm===arm);item[arm]=key?group.reduce((sum,row)=>sum+Number(row[key]),0):group.length;item[arm+'_rate']=group.length?item[arm]/group.length:0;}return item;
    });
    return {schema_version:1,synthetic:true,runtime:{...runtime},parameters:p,n:rows.length,decision,explanation:explanations[decision],checks,
      primary,guardrail,srm,segments,retention:effectMetric(rows,'retained_14d'),funnel,sample:rows.slice(0,12).map(row=>({...row})),
      policy:{target_lift_pp:3,support_margin_pp:3,srm_alpha:.001,primary_alpha:.05,complete_observation:'28 signup days; all outcomes observed through day 14 after signup.'}};
  }
  function compareIds(a,b) {
    for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]<b[i])return -1;if(a[i]>b[i])return 1;}
    return Math.sign(a.length-b.length);
  }
  function optimizeRoadmap(capacity=12) {
    capacity=numeric(capacity,12,0,30,true);
    const feasible=[];
    for(let mask=0;mask<(1<<FEATURES.length);mask++) {
      const selected=FEATURES.filter((_,i)=>mask&(1<<i)),ids=new Set(selected.map(f=>f.id)),effort=selected.reduce((sum,f)=>sum+f.effort,0);
      if(effort<=capacity&&selected.every(f=>f.requires.every(id=>ids.has(id)))) feasible.push({value:selected.reduce((sum,f)=>sum+f.value,0),effort,ids:selected.map(f=>f.id)});
    }
    const winner=feasible.reduce((best,item)=>item.value>best.value||(item.value===best.value&&(item.effort<best.effort||(item.effort===best.effort&&compareIds(item.ids,best.ids)>0)))?item:best,feasible[0]);
    const chosen=new Set(winner.ids);
    return {capacity,used:winner.effort,value:winner.value,selected_ids:[...winner.ids],feasible_portfolios:feasible.length,candidate_portfolios:1<<FEATURES.length,
      features:FEATURES.map(f=>({...f,requires:[...f.requires],selected:chosen.has(f.id)})),
      frontier:Array.from({length:capacity+1},(_,c)=>({capacity:c,value:Math.max(...feasible.filter(f=>f.effort<=c).map(f=>f.value))})),
      method:'Exact enumeration of every subset; dependencies are hard constraints. Value points are hypothetical additive preferences, not forecast revenue.'};
  }
  function createSignalService() {
    const generationCache=new Map(),evaluationCache=new Map();
    function generate(values={}) {
      const p=parameters(values),key=JSON.stringify(p);
      if(generationCache.has(key))return generationCache.get(key).map(row=>({...row}));
      const rng=randomSource(p.seed),rows=[];
      for(let i=0;i<p.n;i++) {
        const segment=rng()<.35?'Enterprise':'Self-serve',arm=rng()<p.allocation?'treatment':'control',channel=rng()<.3?'Partner':'Organic';
        const base=segment==='Enterprise'?.36:.26,effect=p.lift*(segment==='Enterprise'?.65:1.2);
        const activated=rng()<Math.max(0,Math.min(1,base+(arm==='treatment'?effect:0)));
        const imported=activated||rng()<.30,invited=activated&&rng()<(segment==='Enterprise'?.75:.35);
        const support=rng()<(.025+(arm==='treatment'?p.friction:0)),retained=activated&&rng()<.63;
        rows.push({user_id:`SYN-${String(p.seed).padStart(6,'0')}-${String(i+1).padStart(5,'0')}`,arm,segment,channel,signup_day:1+i%28,
          import_completed:Number(imported),activated_7d:Number(activated),invited_teammate:Number(invited),support_contact_7d:Number(support),retained_14d:Number(retained)});
      }
      if(generationCache.size>=8)generationCache.delete(generationCache.keys().next().value);
      generationCache.set(key,rows);
      return rows.map(row=>({...row}));
    }
    function analyze(values={}) {const p=parameters(values);return analyzeRows(generate(p),p);}
    function evaluate(trials=200,seed=42) {
      trials=numeric(trials,200,20,500,true);seed=numeric(seed,42,0,1000000,true);
      const key=trials+':'+seed;if(evaluationCache.has(key))return clone(evaluationCache.get(key));
      let positives=0,coverage=0;const deltas=[];
      for(let trial=0;trial<trials;trial++) {
        const rng=randomSource(seed*1009+trial),rows=Array.from({length:1200},(_,i)=>({arm:i<600?'control':'treatment',activated_7d:Number(rng()<.3)}));
        const metric=effectMetric(rows,'activated_7d'),[low,high]=metric.ci;
        if(low>0||high<0)positives++;if(low<=0&&high>=0)coverage++;deltas.push(metric.delta);
      }
      const result={synthetic:true,runtime:{...runtime},trials,seed,users_per_trial:1200,true_effect:0,false_positives:positives,false_positive_rate:positives/trials,
        false_positive_rate_ci:wilson(positives,trials),coverage:coverage/trials,nominal_alpha:.05,mean_estimated_effect:deltas.reduce((a,b)=>a+b,0)/trials,
        min_estimated_effect:Math.min(...deltas),max_estimated_effect:Math.max(...deltas),
        interpretation:'A/A calibration of the primary interval only; this does not validate the whole launch policy, power, production instrumentation, or every data distribution.'};
      if(evaluationCache.size>=8)evaluationCache.delete(evaluationCache.keys().next().value);
      evaluationCache.set(key,result);return clone(result);
    }
    function handle(method,path,query={},body={}) {
      path=(path||'/').replace(/\/+$/,'')||'/';
      if(method==='GET'&&['/','/overview'].includes(path))return analyze(query);
      if(method==='POST'&&path==='/analyze')return analyze(body);
      if(['GET','POST'].includes(method)&&path==='/roadmap')return optimizeRoadmap((method==='POST'?body:query).capacity);
      if(method==='GET'&&path==='/evaluate')return evaluate(numeric(query.trials,200,20,500,true),numeric(query.seed,42,0,1000000,true));
      if(method==='GET'&&path==='/events')return {synthetic:true,runtime:{...runtime},parameters:parameters(query),rows:generate(query)};
      throw new Error('Unknown Signal Lab endpoint.');
    }
    return {handle,generate,analyze,analyzeRows,evaluate,optimizeRoadmap,effectMetric,sampleRatio,wilson,erfc,parameters,runtime:{...runtime}};
  }
  return {createSignalService};
});
