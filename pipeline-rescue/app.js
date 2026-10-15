/* Original UI for the synthetic Relay Operations service. No external libraries. */
const P = '/api/pipeline';
const relay = {view:'overview', summary:null, orders:[], quarantine:[], allocation:null, filters:{q:'',status:'',risk_band:'',lane:''}, audit:null};
const money = value => '$'+UI.n(value,0);
const stamp = value => new Date(value).toLocaleString('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
const label = value => String(value).replaceAll('_',' ');
const riskBadge = order => `<span class="badge ${order.risk_band==='low'?'good':'warn'}">${UI.e(order.risk_band)} ${order.risk_score}</span>`;
const kpi = (name,value,note,kind='') => `<article class="kpi"><small>${UI.e(name)}</small><strong class="${kind}">${UI.e(value)}</strong><p>${UI.e(note)}</p></article>`;

function showError(error){const el=document.getElementById('error');el.textContent=error.message||String(error);el.hidden=false;}
async function guarded(action){try{document.getElementById('error').hidden=true;await action();}catch(error){showError(error);}}
async function refresh(){
  const [summary,orders,quarantine]=await Promise.all([UI.api(P+'/summary'),UI.api(P+'/orders'),UI.api(P+'/quarantine')]);
  relay.summary=summary;relay.orders=orders.orders;relay.quarantine=quarantine.rows;
  relay.allocation=summary.latest_allocation;
  document.getElementById('clock').textContent='FIXTURE · '+stamp(summary.as_of);
  render();
}

function render(){
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===relay.view;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');});
  if(!relay.summary)return;
  const renderers={overview:overview,events:eventsView,interventions:interventions,audit:auditView};
  document.getElementById('content').innerHTML=renderers[relay.view]();
  if(relay.view==='audit')loadAudit();
}

function overview(){
  const s=relay.summary,c=s.counts;
  const hottest=relay.orders.filter(order=>order.status!=='delivered').slice(0,5);
  return `<div class="kpis">${kpi('Orders in the system',UI.n(s.orders_total),`${s.statuses.delivered} delivered · ${s.orders_total-s.statuses.delivered} active`)}${kpi('High-risk orders',UI.n(s.high_risk),'Score ≥ 70 · inspect the evidence','warn')}${kpi('Open quarantine',UI.n(c.quarantine_open),`${c.quarantine_resolved} repaired · originals preserved`,'warn')}${kpi('Modeled exposure',money(s.modeled_exposure),'Illustrative planning index · not predicted loss')}</div>
    <div class="grid2"><section class="panel"><div class="section-head"><h2>A pipeline you can inspect</h2><span class="badge good">${c.reconciled?'RECONCILED':'CHECK COUNTS'}</span></div>
      <p>Immutable arrival records become validated events, then current operational state.</p>
      <div class="flow"><div class="flow-node"><small>01 / RAW</small><strong>${UI.n(c.raw)}</strong><p>Every arrival retained</p></div><div class="flow-node"><small>02 / VALIDATED</small><strong>${UI.n(c.validated)}</strong><p>Unique accepted events</p></div><div class="flow-node"><small>03 / SERVING</small><strong>${UI.n(s.orders_total)}</strong><p>Order projections</p></div></div>
      <div class="reconcile"><span><b class="pipeline-label">${c.duplicates}</b> duplicates suppressed</span><span><b class="warn">${c.quarantined}</b> invalid arrivals</span><span><b class="good">${c.late}</b> late events accepted</span></div>
      <div class="note">${c.raw} raw = ${c.validated} accepted + ${c.duplicates} duplicate + ${c.quarantined} quarantined. Repairs append a new event; original evidence stays in the trail.</div>
      <button type="button" class="secondary" data-view="events">Inspect event workbench →</button></section>
      <section class="panel"><h2>Where exposure concentrates</h2>${UI.bars(s.lanes.map(row=>({label:row.lane,value:row.exposure})),Math.max(1,...s.lanes.map(row=>row.exposure)))}<p class="compact-note">Lane exposure sums order value × risk score / 100. Scores are transparent heuristics built for this simulation.</p></section></div>
    <div class="grid2"><section class="panel"><div class="section-head"><h2>Immediate attention</h2><button type="button" class="secondary" data-view="interventions">Plan interventions →</button></div>${orderTable(hottest,false)}</section>
      <section class="panel"><h2>Business state, event-time rules</h2>${UI.bars(Object.entries(s.statuses).map(([name,value])=>({label:label(name),value})),s.orders_total)}<p class="compact-note">Lifecycle progress is monotonic and delivered is terminal. Late arrivals enrich history without rolling back a newer delivery state.</p></section></div>
    <section class="panel"><h2>Try the operational loop</h2><div class="grid3"><div><span class="mini-label">01 / Break the input</span><h3 style="margin:8px 0">Inject a scanner fault</h3><p>See invalid timestamps and delays isolated while a repeated event is suppressed.</p></div><div><span class="mini-label">02 / Recover with evidence</span><h3 style="margin:8px 0">Repair, then replay</h3><p>Append a corrected event. Replay the raw log and verify the projection fingerprint stays unchanged.</p></div><div><span class="mini-label">03 / Make the tradeoff</span><h3 style="margin:8px 0">Allocate a finite budget</h3><p>Compare an exact constrained plan with a first-due-first baseline using the same candidates.</p></div></div></section>`;
}

function orderTable(rows,full=true,selected=[]){
  if(!rows.length)return '<p class="empty">No orders match this selection.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Order / lineage</th>${full?'<th>Lane</th>':''}<th>State</th><th>Risk</th>${full?'<th>Promise</th><th>Evidence</th><th>Transfer cost</th>':''}${selected.length?'<th>Plan</th>':''}</tr></thead><tbody>${rows.map(order=>`<tr><td><button type="button" class="queue-button" data-order="${UI.e(order.order_id)}">${UI.e(order.order_id)}</button><br><small>${UI.e(order.customer)}</small></td>${full?`<td>${UI.e(order.lane)}</td>`:''}<td>${UI.e(label(order.status))}</td><td>${riskBadge(order)}</td>${full?`<td>${UI.e(stamp(order.promised_at))}</td><td class="explain">${UI.e(order.risk_reasons.join(' · '))}</td><td>${money(order.expedite_cost)}</td>`:''}${selected.length?`<td>${selected.includes(order.order_id)?'<span class="badge good">SELECTED</span>':'<span class="muted">Monitor</span>'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

function eventsView(){
  const c=relay.summary.counts;
  return `<div class="kpis">${kpi('Accepted events',UI.n(c.validated),'One canonical event per event identifier')}${kpi('Duplicate arrivals',UI.n(c.duplicates),'Stored in raw · excluded from serving')}${kpi('Open invalid events',UI.n(c.quarantine_open),'Repair appends a corrected event','warn')}${kpi('Late arrivals',UI.n(c.late),'Event time controls operational state','good')}</div>
    <section class="panel" style="margin-bottom:20px"><div class="section-head"><h2>Quarantine &amp; repair</h2><span class="badge warn">${c.quarantine_open} OPEN</span></div><p>Reason codes explain the failure. Open a row to inspect the immutable payload and propose a corrected event.</p><div class="table-wrap"><table><thead><tr><th>Raw ID</th><th>Reason</th><th>Event</th><th>Batch</th><th>State</th><th>Action</th></tr></thead><tbody>${relay.quarantine.map(row=>`<tr><td>#${row.raw_id}</td><td><span class="badge ${row.status==='resolved'?'good':'warn'}">${UI.e(row.reason_code)}</span></td><td>${UI.e(row.payload?.event_id||'(invalid object)')}</td><td>${UI.e(row.batch_id)}</td><td>${UI.e(row.status)}</td><td><button type="button" class="secondary" data-raw="${row.raw_id}">${row.status==='resolved'?'Inspect':'Inspect / repair'}</button></td></tr>`).join('')}</tbody></table></div><p class="compact-note">Resolved originals remain quarantined as historical evidence; the corrected event is a separate accepted arrival.</p></section>
    <section class="panel"><div class="section-head"><h2>Order explorer</h2><span class="badge">${filteredOrders().length} MATCHING</span></div><div class="form-grid">
      <label>Search order, customer, or lane<input id="order-search" value="${UI.e(relay.filters.q)}" placeholder="REL-001 or Cedar"></label>
      <label>Lifecycle<select data-filter="status"><option value="">All states</option>${['packed','in_transit','exception','delivered'].map(status=>`<option value="${status}" ${relay.filters.status===status?'selected':''}>${UI.e(label(status))}</option>`).join('')}</select></label>
      <label>Risk band<select data-filter="risk_band"><option value="">All risk bands</option>${['high','watch','low'].map(band=>`<option value="${band}" ${relay.filters.risk_band===band?'selected':''}>${band}</option>`).join('')}</select></label></div><div id="order-results">${orderTable(filteredOrders())}</div></section>`;
}

function filteredOrders(){return relay.orders.filter(order=>(!relay.filters.status||order.status===relay.filters.status)&&(!relay.filters.risk_band||order.risk_band===relay.filters.risk_band)&&(!relay.filters.q||`${order.order_id} ${order.customer} ${order.lane}`.toLowerCase().includes(relay.filters.q.toLowerCase())));}

function interventions(){
  const a=relay.allocation;
  const candidates=relay.orders.filter(order=>order.avoidable_exposure>0);
  const max=a?Math.max(1,a.optimized.avoidable_exposure,a.baseline.avoidable_exposure):1;
  return `<div class="note">Decision support uses a declared synthetic scoring model. Avoidable exposure is an illustrative objective, with independent additive benefits. This screen proposes a plan; it does not execute carrier transfers.</div>
    <div class="grid2"><section class="panel"><h2>Choose the constraint</h2><p>One intervention per eligible order. The solver maximizes avoidable exposure using exact 0/1 knapsack, subject to the selected budget.</p><form id="allocation-form"><div class="budget-controls" style="margin-top:20px"><label>Available budget<input id="budget-range" type="range" min="0" max="5000" step="10" value="${a?.budget??1200}" aria-label="Available intervention budget"></label><label>Budget ($)<input id="budget" type="number" min="0" max="5000" step="1" value="${a?.budget??1200}" required></label><button type="submit">Allocate budget →</button></div></form><p class="compact-note">${candidates.length} eligible orders · transfer costs ${money(Math.min(...candidates.map(order=>order.expedite_cost)))}–${money(Math.max(...candidates.map(order=>order.expedite_cost)))}. Carrier availability, network spillovers, and causal efficacy are outside this model.</p></section>
      <section class="panel"><h2>Compare the decision policy</h2>${a?`<div class="comparison-value"><span>Optimized plan · ${a.optimized.count} orders</span><strong class="good">${money(a.optimized.avoidable_exposure)}</strong></div><div class="allocation-bar"><i style="width:${a.optimized.avoidable_exposure/max*100}%"></i></div><div class="comparison-value"><span>First-due baseline · ${a.baseline.count} orders</span><strong class="pipeline-label">${money(a.baseline.avoidable_exposure)}</strong></div><div class="allocation-bar baseline"><i style="width:${a.baseline.avoidable_exposure/max*100}%"></i></div><div class="decision-result" style="margin-top:20px"><small>Additional illustrative exposure avoided</small><br><strong class="good">+${money(a.improvement)}</strong><p>${money(a.optimized.spent)} allocated of ${money(a.budget)} · ${money(a.unspent)} unspent</p></div><p class="compact-note">Baseline: earliest promise first, skipping unaffordable orders. Both policies use identical candidates, costs, and benefit estimates.</p>`:'<p class="empty">Allocate a budget to compare the two policies.</p>'}</section></div>
    <section class="panel"><div class="section-head"><h2>Intervention queue</h2><span class="badge">PRIORITY CARRIER TRANSFER</span></div>${a?`<p style="margin-bottom:15px">Selected plan: ${a.optimized.count} orders · modeled objective ${money(a.optimized.avoidable_exposure)}.</p>`:''}${orderTable(candidates,true,a?.optimized.order_ids||[])}</section>`;
}

function auditView(){
  const s=relay.summary;
  return `<div class="grid2"><section class="panel"><h2>Projection integrity</h2><p>Replay revalidates the raw arrival log and rebuilds serving state. It does not append a second copy of the raw arrivals.</p><div class="terminal-tag">SHA-256 / CANONICAL SERVING STATE</div><p class="audit-hash" style="margin-top:12px">${UI.e(s.projection_digest)}</p><button type="button" class="secondary" data-action="replay" style="margin-top:18px">Replay &amp; verify fingerprint</button><div id="replay-result"></div></section>
      <section class="panel"><h2>Declared model</h2><div class="stack"><div><h3>Risk score</h3><p class="compact-note">${UI.e(s.model.risk)}</p></div><div><h3>Exposure</h3><p class="compact-note">${UI.e(s.model.exposure)}</p></div><div><h3>Intervention value</h3><p class="compact-note">${UI.e(s.model.intervention)}</p></div></div></section></div>
    <section class="panel" style="margin-bottom:20px"><h2>Batch reconciliation</h2><div class="table-wrap"><table><thead><tr><th>Batch</th><th>Raw</th><th>Accepted</th><th>Duplicate</th><th>Quarantined</th></tr></thead><tbody>${s.batches.map(batch=>`<tr><td>${UI.e(batch.batch_id)}</td><td>${batch.raw}</td><td>${batch.validated}</td><td>${batch.duplicates}</td><td>${batch.quarantined}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><div class="section-head"><h2>Operator audit trail</h2><button type="button" class="secondary" data-action="export">Export audit JSON ↗</button></div><div id="audit-log"><p class="loading">Reading the action log…</p></div></section>`;
}

async function loadAudit(){
  try{const audit=await UI.api(P+'/audit');relay.audit=audit;const target=document.getElementById('audit-log');if(!target)return;target.innerHTML=audit.audit.slice().reverse().map(entry=>`<div class="audit-row"><span class="muted">#${entry.audit_id}</span><div><code>${UI.e(entry.action)}</code><br><small>${UI.e(stamp(entry.recorded_at))}</small></div><p>${UI.e(auditDescription(entry))}</p></div>`).join('');}catch(error){showError(error);}
}
function auditDescription(entry){const d=entry.details;if(entry.action==='allocation_proposed')return `${money(d.budget)} budget · ${d.optimized.count} selected · ${money(d.optimized.avoidable_exposure)} illustrative objective`;if(entry.action==='replay')return `${d.raw_rows_replayed} arrivals replayed · fingerprint ${d.idempotent?'unchanged':'changed'}`;if(entry.action==='repair')return `Raw #${d.raw_id} preserved → ${d.repair_event_id} appended`;if(entry.action==='disruption')return `${d.scenario} scenario · ${d.batch.validated} accepted · ${d.batch.quarantined} quarantined`;if(entry.action==='fixture_generated')return `Seed ${d.seed} · ${d.orders} orders · ${d.events} generated arrivals`;return JSON.stringify(d);}

function openDetail(title,html){document.getElementById('detail-title').textContent=title;document.getElementById('detail-body').innerHTML=html;const dialog=document.getElementById('detail');if(!dialog.open)dialog.showModal();}
async function lineage(orderId){
  const data=await UI.api(P+'/lineage?order_id='+encodeURIComponent(orderId)),order=data.order;
  openDetail(`${order.order_id} · Event lineage`,`<div class="dialog-kpis"><div><small>Current state</small>${UI.e(label(order.status))}</div><div><small>Risk score</small>${order.risk_score} / 99</div><div><small>Promise</small>${UI.e(stamp(order.promised_at))}</div><div><small>Estimated slack</small>${UI.n(order.slack_hours,1)}h</div></div><div class="note">${UI.e(order.risk_reasons.join(' · '))}</div><p class="compact-note">${UI.e(data.rule)}</p><h3 style="margin-top:20px">Accepted event-time history</h3><div class="table-wrap"><table><thead><tr><th>Business event time</th><th>Type</th><th>Event ID</th><th>Raw row</th><th>Arrival</th></tr></thead><tbody>${data.validated.map(event=>`<tr><td>${UI.e(stamp(event.occurred_at))}</td><td>${UI.e(event.event_type)}</td><td>${UI.e(event.event_id)}</td><td>#${event.raw_id}</td><td>${event.is_late?'<span class="badge warn">LATE</span>':'In order'}</td></tr>`).join('')}</tbody></table></div><h3 style="margin-top:24px">Raw arrival trail</h3><div class="table-wrap"><table><thead><tr><th>Raw ID</th><th>Batch</th><th>Event ID</th><th>Outcome</th></tr></thead><tbody>${data.raw.map(row=>`<tr><td>#${row.raw_id}</td><td>${UI.e(row.batch_id)}</td><td>${UI.e(row.payload.event_id)}</td><td>${UI.e(row.outcome)}</td></tr>`).join('')}</tbody></table></div>`);
}

function rawDetail(rawId){
  const row=relay.quarantine.find(item=>item.raw_id===rawId);if(!row)return;
  const defaultPatch=row.reason_code==='BAD_TIMESTAMP'?{occurred_at:new Date(new Date(relay.summary.as_of).getTime()-30*60*1000).toISOString()}:row.reason_code==='BAD_DELAY'?{delay_minutes:90}:row.reason_code==='UNKNOWN_ORDER'?{order_id:'REL-001'}:{hub:'Recovered scan'};
  openDetail(`Raw #${rawId} · ${row.reason_code}`,`<span class="badge ${row.status==='resolved'?'good':'warn'}">${UI.e(row.status)}</span><p style="margin-top:12px">${UI.e(row.detail)}</p><h3 style="margin-top:20px">Original immutable payload</h3><pre>${UI.e(JSON.stringify(row.payload,null,2))}</pre>${row.status==='resolved'?`<div class="note">Corrected event ${UI.e(row.repair_event_id)} was appended. This original remains unchanged.</div>`:`<form id="repair-form" data-raw-id="${rawId}"><label>Correction patch (JSON)<textarea class="patch" id="repair-patch" required>${UI.e(JSON.stringify(defaultPatch,null,2))}</textarea></label><p class="compact-note">Review the proposed correction. A new event ID is generated; raw #${rawId} stays immutable. Supported fields: order_id, type, occurred_at, delay_minutes, hub.</p><div class="actions" style="margin-top:15px"><button type="submit">Append corrected event</button></div><p id="repair-error" class="bad" role="alert" style="margin-top:12px"></p></form>`}`);
}

async function replay(){const result=await UI.api(P+'/replay',{});await refresh();UI.toast(`${result.raw_rows_replayed} arrivals replayed · projection ${result.idempotent?'unchanged ✓':'changed'}`);const target=document.getElementById('replay-result');if(target)target.innerHTML=`<div class="note">${result.idempotent?'✓ Fingerprint unchanged. Replay is idempotent.':'Projection changed; inspect the audit.'}<br>${result.raw_rows_replayed} raw arrivals rebuilt.</div>`;}
async function exportAudit(){const data=await UI.api(P+'/audit');UI.download('relay-operations-audit.json',JSON.stringify(data,null,2),'application/json');UI.toast('Synthetic audit exported');}

document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-view]');if(nav){relay.view=nav.dataset.view;render();return;}
  const order=event.target.closest('[data-order]');if(order){guarded(()=>lineage(order.dataset.order));return;}
  const raw=event.target.closest('[data-raw]');if(raw){rawDetail(Number(raw.dataset.raw));return;}
  const action=event.target.closest('[data-action]');if(action?.dataset.action==='replay')guarded(replay);if(action?.dataset.action==='export')guarded(exportAudit);
});
document.getElementById('close-detail').addEventListener('click',()=>document.getElementById('detail').close());
document.getElementById('replay').addEventListener('click',()=>guarded(replay));
document.getElementById('export').addEventListener('click',()=>guarded(exportAudit));
document.getElementById('disrupt').addEventListener('click',()=>guarded(async()=>{const result=await UI.api(P+'/disrupt',{scenario:document.getElementById('scenario').value});await refresh();UI.toast(`${result.scenario} injected · ${result.batch.validated} accepted · ${result.batch.quarantined} quarantined`);}));
document.getElementById('reset').addEventListener('click',()=>guarded(async()=>{await UI.api(P+'/reset',{});relay.allocation=null;await refresh();UI.toast('Generated fixture restored to seed 41');}));
document.addEventListener('input',event=>{
  if(event.target.id==='budget-range')document.getElementById('budget').value=event.target.value;
  if(event.target.id==='budget')document.getElementById('budget-range').value=event.target.value;
  if(event.target.id==='order-search'){relay.filters.q=event.target.value;document.getElementById('order-results').innerHTML=orderTable(filteredOrders());}
});
document.addEventListener('change',event=>{if(event.target.dataset.filter){relay.filters[event.target.dataset.filter]=event.target.value;render();}});
document.addEventListener('submit',event=>{
  if(event.target.id==='allocation-form'){event.preventDefault();guarded(async()=>{const budget=Number(document.getElementById('budget').value);relay.allocation=await UI.api(P+'/allocate',{budget});await refresh();UI.toast(`Plan proposed · ${money(relay.allocation.optimized.spent)} allocated`);});}
  if(event.target.id==='repair-form'){event.preventDefault();(async()=>{try{const patch=JSON.parse(document.getElementById('repair-patch').value);const result=await UI.api(P+'/repair',{raw_id:Number(event.target.dataset.rawId),patch});document.getElementById('detail').close();await refresh();UI.toast(`Corrected event ${result.repair_event_id} appended`);}catch(error){document.getElementById('repair-error').textContent=error.message;}})();}
});
guarded(refresh);
