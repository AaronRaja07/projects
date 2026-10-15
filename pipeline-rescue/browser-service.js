/* Relay's browser-local logical pipeline. SQLite belongs to the Python edition. */
(function (root) {
  'use strict';
  const AS_OF = '2026-10-14T12:00:00.000000Z', CLOCK = Date.parse(AS_OF), KEY = 'relay-operations-v1';
  const TYPES = ['created','packed','dispatched','exception','delivered'];
  const STAGE = {created:0,packed:1,dispatched:2,delivered:3};
  const clone = value => JSON.parse(JSON.stringify(value));
  const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  const stamp = value => new Date(value).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
  const now = () => stamp(Date.now());
  // Round the exact IEEE-754 value with Python's decimal ties-to-even rule.
  // Scaling a float first would erase which side of a decimal tie it was on.
  const round = (value, digits=0) => {
    if(!Number.isFinite(value))throw new Error('Expected a finite number');
    const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,Math.abs(value));
    const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n);
    const mantissa=(bits&((1n<<52n)-1n))+(exponent?1n<<52n:0n),power=exponent?exponent-1075:-1074;
    let numerator=mantissa*10n**BigInt(Math.max(0,digits)),denominator=10n**BigInt(Math.max(0,-digits));
    if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
    let quotient=numerator/denominator;const remainder=numerator%denominator;
    if(remainder*2n>denominator||(remainder*2n===denominator&&quotient%2n))quotient++;
    return (value<0?-1:1)*Number(quotient)/10**digits;
  };
  function canonical(value) {
    function encode(item) {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite values are not valid JSON');
      if (Array.isArray(item)) return '['+item.map(encode).join(',')+']';
      if (item && typeof item === 'object') return '{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+encode(item[key])).join(',')+'}';
      const text=JSON.stringify(item);if(text===undefined)throw new Error('Expected a JSON value');return text;
    }
    return encode(value).replace(/[\u0080-\uffff]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
  }
  const crypt = typeof module !== 'undefined' && module.exports ? require('node:crypto').webcrypto : root.crypto;
  async function sha(text) {
    if (!crypt || !crypt.subtle) throw new Error('This demo needs Web Crypto in HTTPS or localhost');
    const bytes = await crypt.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function parseTime(value) {
    if(typeof value!=='string')throw new Error('Timestamp must be an ISO 8601 string with a timezone');
    if(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?$/.test(value))throw new Error('Timestamp must include a timezone');
    const match=value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})$/);
    if(!match)throw new Error('Timestamp must be valid ISO 8601');
    const [,ys,ms,ds,hs,mins,ss='0',fraction='',zone]=match;
    const [year,month,day,hour,minute,second]=[ys,ms,ds,hs,mins,ss].map(Number);
    const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
    if(month<1||month>12||day<1||hour>23||minute>59||second>59||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error('Timestamp must be valid ISO 8601');
    let offset=0;
    if(zone!=='Z'){
      const plain=zone.replace(':',''), zh=Number(plain.slice(1,3)), zm=Number(plain.slice(3,5));
      if(zh>23||zm>59)throw new Error('Timestamp must be valid ISO 8601');
      offset=(zh*60+zm)*(zone[0]==='-'?-1:1);
    }
    const micros=date.valueOf()*1000+Number(fraction.padEnd(6,'0'))-offset*60*1000000;
    const normalized=new Date(Math.floor(micros/1000)).toISOString().slice(0,19)+'.'+String(((micros%1000000)+1000000)%1000000).padStart(6,'0')+'Z';
    return {ms:micros/1000,iso:normalized};
  }
  function createRelayService(seed, storage, onWarning=()=>{}) {
    if(!seed||!Array.isArray(seed.orders)||!Array.isArray(seed.events)||!seed.orders.length||new Set(seed.orders.map(o=>o.order_id)).size!==seed.orders.length)throw new Error('Invalid synthetic Relay seed');
    const initial=clone(seed);let state, warned=false, pending=Promise.resolve();
    function warn(){storage=null;if(!warned){warned=true;onWarning('Browser storage is unavailable. Changes will last until this page closes.');}}
    function validState(value){return value&&value.version===1&&Array.isArray(value.orders)&&Array.isArray(value.raw_events)&&Array.isArray(value.valid_events)&&Array.isArray(value.quarantine)&&Array.isArray(value.serving_orders)&&Array.isArray(value.audit_log)&&value.meta&&value.orders.length===initial.orders.length&&value.raw_events.every((r,i)=>r.raw_id===i+1&&typeof r.batch_id==='string'&&['validated','duplicate','quarantined'].includes(r.outcome))&&new Set(value.valid_events.map(e=>e.event_id)).size===value.valid_events.length;}
    function persist(next){state=next;if(storage){try{storage.setItem(KEY,JSON.stringify(state));}catch(_){warn();}}}
    function audit(data,action,details){data.audit_log.push({audit_id:data.audit_log.length+1,action,details:clone(details),recorded_at:now()});}
    async function projectionDigest(data){return sha(canonical(data.serving_orders.slice().sort((a,b)=>compare(a.order_id,b.order_id))));}
    function validate(data,payload){
      if(!payload||typeof payload!=='object'||Array.isArray(payload))return [null,'NON_OBJECT','Event must be a JSON object'];
      const id=payload.event_id;
      if(typeof id!=='string'||!/^([A-Za-z0-9_-]{1,100})$/.test(id))return [null,'BAD_EVENT_ID','Use a nonempty event identifier of letters, digits, underscores, or hyphens'];
      if(typeof payload.order_id!=='string'||!data.orders.some(o=>o.order_id===payload.order_id))return [null,'UNKNOWN_ORDER','Order does not exist in the generated order catalog'];
      if(typeof payload.type!=='string'||!TYPES.includes(payload.type))return [null,'BAD_EVENT_TYPE','Unsupported lifecycle event type'];
      let time;try{time=parseTime(payload.occurred_at);if(time.ms>CLOCK+3600000)return [null,'FUTURE_EVENT','Event is more than one hour ahead of the fixture clock'];}catch(error){return [null,'BAD_TIMESTAMP',error.message];}
      const delay=payload.delay_minutes===undefined?0:payload.delay_minutes;
      if(typeof delay!=='number'||!Number.isInteger(delay)||delay<0||delay>2880)return [null,'BAD_DELAY','Delay must be an integer between zero and 2880 minutes'];
      const hub=payload.hub===undefined?'':payload.hub;
      if(typeof hub!=='string'||[...hub].length>80)return [null,'BAD_HUB','Hub must be a short text value'];
      return [{event_id:id,order_id:payload.order_id,type:payload.type,occurred_at:time.iso,delay_minutes:delay,hub},null,null];
    }
    async function processRaw(data,raw){
      const checked=validate(data,raw.payload),event=checked[0];let reason=checked[1],detail=checked[2];
      if(event){
        const fingerprint=await sha(canonical(event)),existing=data.valid_events.find(e=>e.event_id===event.event_id);
        if(existing){
          if(existing.fingerprint===fingerprint){raw.outcome='duplicate';return raw.outcome;}
          reason='EVENT_ID_CONFLICT';detail='An existing event identifier has different content';
        }else{
          const last=data.valid_events.filter(e=>e.order_id===event.order_id).reduce((last,e)=>e.occurred_at>last?e.occurred_at:last,'');
          data.valid_events.push({event_id:event.event_id,raw_id:raw.raw_id,order_id:event.order_id,event_type:event.type,occurred_at:event.occurred_at,delay_minutes:event.delay_minutes,fingerprint,payload:event,is_late:Number(Boolean(last&&event.occurred_at<last))});
          raw.outcome='validated';return raw.outcome;
        }
      }
      raw.outcome='quarantined';const existing=data.quarantine.find(q=>q.raw_id===raw.raw_id);
      if(existing){existing.reason_code=reason;existing.detail=detail;}else data.quarantine.push({raw_id:raw.raw_id,reason_code:reason,detail,status:'open',repair_event_id:null});
      return raw.outcome;
    }
    function materialize(data){
      data.serving_orders=data.orders.slice().sort((a,b)=>compare(a.order_id,b.order_id)).map(order=>{
        const events=data.valid_events.filter(e=>e.order_id===order.order_id).sort((a,b)=>compare(a.occurred_at,b.occurred_at)||compare(a.event_id,b.event_id));
        let stage=-1,stageTime='',exceptionTime='',delay=0;
        for(const event of events){if(Object.hasOwn(STAGE,event.event_type)&&STAGE[event.event_type]>=stage){stage=STAGE[event.event_type];stageTime=event.occurred_at;}if(event.event_type==='exception'){exceptionTime=event.occurred_at;delay=event.delay_minutes;}}
        let status=['awaiting','packed','in_transit','delivered'][Math.max(0,stage)];
        if(stage<3&&exceptionTime>stageTime)status='exception';else delay=0;
        return {order_id:order.order_id,status,last_event_at:events.length?events[events.length-1].occurred_at:stamp(CLOCK-3*86400000),event_count:events.length,delay_minutes:delay};
      });
    }
    async function ingest(data,events,batch){
      if(!Array.isArray(events)||events.length<1||events.length>500)throw new Error('Provide between 1 and 500 event objects');
      const before=await projectionDigest(data),counts={validated:0,duplicate:0,quarantined:0};
      for(const payload of events){canonical(payload);const raw={raw_id:data.raw_events.length+1,batch_id:batch,payload:clone(payload),received_at:now(),outcome:null};data.raw_events.push(raw);counts[await processRaw(data,raw)]++;}
      materialize(data);if(await projectionDigest(data)!==before)data.meta.latest_allocation=null;
      return counts;
    }
    async function fresh(){
      const data={version:1,orders:clone(initial.orders),raw_events:[],valid_events:[],quarantine:[],serving_orders:[],audit_log:[],meta:{disruption_count:0,latest_allocation:null}};
      await ingest(data,clone(initial.events),'seed-41');audit(data,'fixture_generated',{seed:41,orders:data.orders.length,events:initial.events.length});return data;
    }
    const ready=(async()=>{
      if(storage){try{const saved=storage.getItem(KEY);if(saved){const parsed=JSON.parse(saved);if(!validState(parsed))throw new Error('Invalid saved Relay state');state=parsed;return;}}catch(_){warn();}}
      state=await fresh();
    })();
    function orderView(order,serving){
      const row={...order,...serving};const remaining={awaiting:18,packed:10,in_transit:3,exception:6,delivered:0}[row.status];
      const delayHours=row.delay_minutes/60,hoursToPromise=(Date.parse(row.promised_at)-CLOCK)/3600000,slack=hoursToPromise-remaining-delayHours;
      const stale=Math.max(0,(CLOCK-Date.parse(row.last_event_at))/3600000),reasons=[];let score=0;
      if(row.status!=='delivered'){
        score=12+row.priority*3;if(slack<0){score+=Math.min(50,Math.ceil(-slack*8));reasons.push(`Estimated arrival exceeds promise by ${round(-slack,1).toFixed(1)}h`);}
        if(row.status==='exception'){score+=24;reasons.push(`Active exception adds ${row.delay_minutes} minutes`);}
        if(stale>=12){score+=12;reasons.push(`No accepted event for ${round(stale,1).toFixed(1)}h`);}
        if(row.priority===3)reasons.push('Priority service commitment');if(!reasons.length)reasons.push('Within modeled transit allowance');score=Math.min(99,score);
      }
      const exposure=round(row.value*score/100,2),avoidable=score>=35?round(exposure*row.recoverability,2):0;
      return {...row,risk_score:score,risk_band:score>=70?'high':score>=35?'watch':'low',risk_reasons:reasons.length?reasons:['Delivery complete'],slack_hours:round(slack,1),modeled_exposure:exposure,avoidable_exposure:avoidable,estimated_remaining_hours:remaining+delayHours,stale_hours:round(stale,1),intervention:avoidable?'Priority carrier transfer':'Monitor'};
    }
    function orders(data){return data.orders.slice().sort((a,b)=>compare(a.order_id,b.order_id)).map(order=>orderView(order,data.serving_orders.find(s=>s.order_id===order.order_id)));}
    function counts(data){const raw=data.raw_events.length,validated=data.valid_events.length,duplicates=data.raw_events.filter(r=>r.outcome==='duplicate').length,quarantined=data.quarantine.length,open=data.quarantine.filter(q=>q.status==='open').length;return {raw,validated,duplicates,quarantined,quarantine_open:open,quarantine_resolved:quarantined-open,late:data.valid_events.filter(e=>e.is_late).length,reconciled:raw===validated+duplicates+quarantined};}
    function quarantines(data){return data.quarantine.slice().sort((a,b)=>compare(a.status,b.status)||b.raw_id-a.raw_id).map(q=>{const raw=data.raw_events.find(r=>r.raw_id===q.raw_id);return {...q,batch_id:raw.batch_id,payload:clone(raw.payload),received_at:raw.received_at};});}
    async function summary(data){
      const rows=orders(data),cs=counts(data),statuses=Object.fromEntries(['awaiting','packed','in_transit','exception','delivered'].map(status=>[status,rows.filter(o=>o.status===status).length]));
      const reasons=[...new Set(data.quarantine.map(q=>q.reason_code))].sort().map(reason=>({reason,count:data.quarantine.filter(q=>q.reason_code===reason).length}));
      const batches=[...new Set(data.raw_events.map(r=>r.batch_id))].map(batch_id=>{const batch=data.raw_events.filter(r=>r.batch_id===batch_id);return {batch_id,raw:batch.length,validated:batch.filter(r=>r.outcome==='validated').length,duplicates:batch.filter(r=>r.outcome==='duplicate').length,quarantined:batch.filter(r=>r.outcome==='quarantined').length};});
      return {synthetic:true,seed:41,as_of:AS_OF,schema_version:1,counts:cs,orders_total:rows.length,statuses,high_risk:rows.filter(o=>o.risk_band==='high').length,modeled_exposure:round(rows.reduce((s,o)=>s+o.modeled_exposure,0),2),
        lanes:[...new Set(rows.map(o=>o.lane))].sort().map(lane=>{const items=rows.filter(o=>o.lane===lane);return {lane,orders:items.length,high_risk:items.filter(o=>o.risk_band==='high').length,exposure:round(items.reduce((s,o)=>s+o.modeled_exposure,0),2)};}),reasons,batches,projection_digest:await projectionDigest(data),latest_allocation:data.meta.latest_allocation,
        model:{risk:'12 + priority × 3 + min(50, ceil(overrun hours × 8)) + exception 24 + stale 12; cap 99',exposure:'Order value × risk score / 100. This is an illustrative planning index, not a loss forecast.',intervention:'Avoidable exposure = modeled exposure × synthetic recoverability. Independent one-time choices; no carrier capacity constraints.'}};
    }
    function allocate(data,budget){
      if(typeof budget!=='number'||!Number.isInteger(budget)||budget<0||budget>5000)throw new Error('Budget must be a whole dollar amount between 0 and 5000');
      const candidates=orders(data).filter(o=>o.avoidable_exposure>0).sort((a,b)=>compare(a.order_id,b.order_id)),value=Array(budget+1).fill(0),picks=Array.from({length:budget+1},()=>[]);
      candidates.forEach((order,index)=>{const cost=order.expedite_cost,benefit=round(order.avoidable_exposure*100);for(let allowance=budget;allowance>=cost;allowance--){if(value[allowance-cost]+benefit>value[allowance]){value[allowance]=value[allowance-cost]+benefit;picks[allowance]=picks[allowance-cost].concat(index);}}});
      const selected=picks[budget].map(index=>candidates[index]),baseline=[];let remaining=budget;
      candidates.slice().sort((a,b)=>compare(a.promised_at,b.promised_at)||compare(a.order_id,b.order_id)).forEach(order=>{if(order.expedite_cost<=remaining){baseline.push(order);remaining-=order.expedite_cost;}});
      const pack=rows=>({order_ids:rows.map(o=>o.order_id),count:rows.length,spent:rows.reduce((s,o)=>s+o.expedite_cost,0),avoidable_exposure:round(rows.reduce((s,o)=>s+o.avoidable_exposure,0),2)}),chosen=pack(selected),firstDue=pack(baseline);
      return {budget,candidate_count:candidates.length,optimized:chosen,baseline:firstDue,baseline_rule:'Earliest promise first; skip unaffordable orders',unspent:budget-chosen.spent,improvement:round(chosen.avoidable_exposure-firstDue.avoidable_exposure,2),objective:'Maximize illustrative avoidable exposure within a one-time budget',assumptions:['Benefits are independent and additive','Each order can receive one intervention','Scores and recovery assumptions are synthetic; no causal effectiveness is claimed']};
    }
    const first=(query,key,fallback='')=>{if(query instanceof URLSearchParams)return query.get(key)??fallback;const value=query[key];return Array.isArray(value)&&value.length?value[0]:fallback;};
    async function execute(method,path,query={},body={}){
      await ready;if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Expected a JSON object');
      const data=clone(state);
      if(method==='GET'){
        if(path==='/'||path==='/summary')return summary(data);
        if(path==='/orders'){
          let rows=orders(data);for(const key of ['status','lane','risk_band']){const selected=first(query,key);if(selected)rows=rows.filter(row=>row[key]===selected);}
          const search=String(first(query,'q')).trim().toLowerCase();if(search)rows=rows.filter(row=>[row.order_id,row.customer,row.lane].join(' ').toLowerCase().includes(search));
          rows.sort((a,b)=>b.risk_score-a.risk_score||compare(a.promised_at,b.promised_at)||compare(a.order_id,b.order_id));return {orders:rows,count:rows.length,as_of:AS_OF};
        }
        if(path==='/lineage'){
          const id=first(query,'order_id'),order=orders(data).find(o=>o.order_id===id);if(!order)throw new Error('Unknown order identifier');
          return {order,raw:data.raw_events.filter(r=>r.payload&&typeof r.payload==='object'&&!Array.isArray(r.payload)&&r.payload.order_id===id),validated:data.valid_events.filter(e=>e.order_id===id).sort((a,b)=>compare(a.occurred_at,b.occurred_at)||compare(a.event_id,b.event_id)),rule:'Lifecycle progress is monotonic. Delivery is terminal. Exceptions apply only after the latest progress event; arrival order never determines state.'};
        }
        if(path==='/quarantine')return {rows:quarantines(data),counts:counts(data)};
        if(path==='/audit')return {synthetic:true,as_of:AS_OF,seed:41,schema_version:1,raw_digest:await sha(data.raw_events.map(r=>canonical(r.payload)).join('')),projection_digest:await projectionDigest(data),counts:counts(data),audit:data.audit_log,quarantine:quarantines(data),latest_allocation:data.meta.latest_allocation};
        throw new Error('Unknown Relay Operations endpoint');
      }
      if(method!=='POST')throw new Error('Unknown Relay Operations endpoint');
      let result;
      if(path==='/ingest'){const batch=await ingest(data,body.events,`api-${data.raw_events.length+1}`);audit(data,'ingest',batch);result={batch,counts:counts(data)};}
      else if(path==='/disrupt'){
        const scenario=body.scenario===undefined?'weather':body.scenario;if(!['weather','scanner','late'].includes(scenario))throw new Error('Scenario must be weather, scanner, or late');
        const number=data.meta.disruption_count+1,active=orders(data).filter(o=>o.status!=='delivered').sort((a,b)=>compare(a.order_id,b.order_id));let events;
        if(!active.length&&scenario!=='scanner')events=[];
        if(scenario==='weather')events=active.slice(0,8).map((o,index)=>({event_id:`DISRUPT-${number}-${index}`,order_id:o.order_id,type:'exception',occurred_at:stamp(CLOCK-180000+number),delay_minutes:120+index*25+Math.min(number,10)*10,hub:o.origin}));
        else if(scenario==='scanner'){
          if(active.length<2)throw new Error('Scanner scenario needs at least two active generated orders');
          const original=clone(data.valid_events.slice().sort((a,b)=>a.raw_id-b.raw_id)[0].payload);
          events=[original,{event_id:`SCANNER-${number}-TIME`,order_id:active[0].order_id,type:'packed',occurred_at:'14/35/2026'},{event_id:`SCANNER-${number}-DELAY`,order_id:active[1].order_id,type:'exception',occurred_at:stamp(CLOCK-120000),delay_minutes:-90}];
        }else if(scenario==='late'&&active.length)events=[{event_id:`LATE-${number}`,order_id:active[0].order_id,type:'created',occurred_at:stamp(CLOCK-4*86400000),delay_minutes:0}];
        if(!events||!events.length)throw new Error('No active generated orders remain for this scenario');
        const batch=await ingest(data,events,`${scenario}-${number}`);data.meta.disruption_count=number;audit(data,'disruption',{scenario,batch});result={scenario,batch,counts:counts(data)};
      }else if(path==='/replay'){
        const before=await projectionDigest(data);data.valid_events=[];for(const raw of data.raw_events)await processRaw(data,raw);materialize(data);const after=await projectionDigest(data);if(before!==after)data.meta.latest_allocation=null;
        result={raw_rows_replayed:data.raw_events.length,before_digest:before,after_digest:after,idempotent:before===after,counts:counts(data)};audit(data,'replay',result);
      }else if(path==='/repair'){
        const id=body.raw_id,patch=body.patch;if(typeof id!=='number'||!Number.isInteger(id))throw new Error('raw_id must be an integer');
        const q=data.quarantine.find(q=>q.raw_id===id);if(!q)throw new Error('Unknown quarantined raw event');
        if(q.status==='resolved')return {already_resolved:true,repair_event_id:q.repair_event_id,counts:counts(data)};
        if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!['order_id','type','occurred_at','delay_minutes','hub'].includes(k)))throw new Error('Provide a patch containing supported event fields');
        const original=data.raw_events.find(r=>r.raw_id===id).payload;if(!original||typeof original!=='object'||Array.isArray(original))throw new Error('Non-object payloads must be resubmitted as a new event');
        const payload={...clone(original),...clone(patch),event_id:`REPAIR-${id}`},[normalized,reason,detail]=validate(data,payload);if(reason)throw new Error(`${reason}: ${detail}`);
        if(data.valid_events.some(e=>e.event_id===payload.event_id))throw new Error('Reserved repair event identifier already exists');
        const batch=await ingest(data,[normalized],`repair-${id}`);q.status='resolved';q.repair_event_id=payload.event_id;audit(data,'repair',{raw_id:id,repair_event_id:payload.event_id,patch});result={batch,repair_event_id:payload.event_id,counts:counts(data)};
      }else if(path==='/allocate'){result=allocate(data,body.budget===undefined?1200:body.budget);data.meta.latest_allocation=result;audit(data,'allocation_proposed',result);}
      else if(path==='/reset'){const reset=await fresh();persist(reset);return summary(reset);}
      else throw new Error('Unknown Relay Operations endpoint');
      persist(data);return clone(result);
    }
    function handle(method,path,query={},body={}){const task=pending.then(()=>execute(method,path,query,body));pending=task.catch(()=>{});return task.then(clone);}
    async function api(path,body){const url=new URL(path,'https://synthetic.example');if(!/^\/api\/pipeline(?:\/|$)/.test(url.pathname))throw new Error('Unknown Relay Operations endpoint');return handle(body===undefined?'GET':'POST',url.pathname.slice('/api/pipeline'.length)||'/',url.searchParams,body===undefined?{}:body);}
    return {api,handle,getState:async()=>{await pending;await ready;return clone(state);}};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createRelayService};
  else if(root.RELAY_SEED&&root.UI){
    let storage;try{storage=root.localStorage;}catch(_){storage={getItem(){throw new Error('Unavailable');}};}
    const service=createRelayService(root.RELAY_SEED,storage,text=>root.UI.toast(text)),previous=root.UI.api;
    root.UI.api=(path,body)=>/^\/api\/pipeline(?:\/|\?|$)/.test(path)?service.api(path,body):previous(path,body);root.RelayDemo=service;
  }
})(typeof window!=='undefined'?window:globalThis);
