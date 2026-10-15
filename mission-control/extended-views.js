/* Original local-only views over the synthetic Mission Control model. */
(() => {
  let ageThreshold = 7;
  let assistantQuestion = '';
  let assistantAnswer = null;
  const rowsOf = data => Array.isArray(data.tickets) ? data.tickets : [];
  const epicsOf = data => Array.isArray(data.epics) ? data.epics : [];
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const statusBadge = (value, e) => `<span class="badge ${value==='Blocked'?'warn':value==='Done'?'good':''}">${e(value)}</span>`;
  function triage(data) {
    return rowsOf(data).filter(t => t.status !== 'Done' && (t.status === 'Blocked' || number(t.age_days) >= ageThreshold))
      .sort((a,b) => Number(b.status === 'Blocked') - Number(a.status === 'Blocked') || number(b.age_days) - number(a.age_days) || String(a.id).localeCompare(String(b.id)));
  }
  function checks(data) {
    const tickets=rowsOf(data), epics=epicsOf(data), epicIds=new Set(epics.map(x=>x.id));
    const duplicates=items=>{const seen=new Set();return items.filter(x=>{if(seen.has(x.id))return true;seen.add(x.id);return false;});};
    return [
      {name:'Unique story keys',failures:duplicates(tickets).map(t=>t.id),total:tickets.length,detail:'Every story key occurs once in the selected slice.'},
      {name:'Valid outcome references',failures:tickets.filter(t=>!epicIds.has(t.epic)).map(t=>t.id),total:tickets.length,detail:'Every story references an outcome represented in this scoped response.'},
      {name:'Unique outcome keys',failures:duplicates(epics).map(x=>x.id),total:epics.length,detail:'Outcome reference keys are unique.'},
      {name:'Owner coverage',failures:tickets.filter(t=>!String(t.owner||'').trim()).map(t=>t.id),total:tickets.length,detail:'An explicit fictional contributor is assigned.'},
      {name:'Confirmed estimate coverage',failures:tickets.filter(t=>!t.estimated||!Number.isFinite(Number(t.points))||number(t.points)<=0).map(t=>t.id),total:tickets.length,detail:'Estimate flag is confirmed and story points are positive and finite.'},
      {name:'Description coverage',failures:tickets.filter(t=>!t.description).map(t=>t.id),total:tickets.length,detail:'Synthetic description-present flag is true; content quality is not inferred.'},
      {name:'Acceptance coverage',failures:tickets.filter(t=>!t.acceptance).map(t=>t.id),total:tickets.length,detail:'Synthetic acceptance-present flag is true; criteria are not reviewed.'},
      {name:'Recognized workflow status',failures:tickets.filter(t=>!['Ready','In progress','Blocked','Done'].includes(t.status)).map(t=>t.id),total:tickets.length,detail:'Status belongs to the four documented demo workflow states.'},
    ];
  }
  function answer(question,data) {
    const text=question.toLowerCase(),tickets=rowsOf(data),m=data.metrics||{};
    if(/block|stuck|unblock/.test(text)) {
      const blocked=tickets.filter(t=>t.status==='Blocked').sort((a,b)=>number(b.age_days)-number(a.age_days));
      return {title:'Blocked work in this selection',summary:`${blocked.length} stories are marked Blocked. ${blocked.filter(t=>number(t.age_days)>=7).length} have a synthetic recorded age of at least 7 days. Age is a supplied field, not measured time in the blocked state.`,evidence:blocked.slice(0,6).map(t=>`${t.id} · ${t.title} · ${t.team} · ${t.owner} · recorded age ${t.age_days} days`),action:blocked.length?'Ask the listed owners to identify the unblock decision and confirm upstream dependencies. The ordering uses status and recorded age, not inferred business impact.':'No blocked stories are recorded in this selection. Check the selected team and sprint before interpreting that result.'};
    }
    if(/capacity|overload|commit|utiliz|scope/.test(text)) {
      const capacity=data.capacity||[],over=capacity.filter(c=>number(c.points)>number(c.capacity));
      return {title:'Capacity and commitment',summary:`${over.length} of ${capacity.length} selected teams exceed their modeled capacity envelope. Capacity is a user-editable planning assumption, not observed team productivity.`,evidence:capacity.map(c=>`${c.team}: ${c.points} committed points / ${c.capacity} modeled capacity (${c.utilization}% utilization).`),action:over.length?'Discuss removing or deferring scope with the teams above their envelope. Compare against the saved baseline before accepting additions.':'The current commitments fit the entered envelopes. Validate the capacity assumptions and review blockers before adding work.'};
    }
    if(/ready|readiness|quality|accept|description|estimate/.test(text)) {
      const gaps=tickets.filter(t=>!t.description||!t.acceptance||!t.estimated);
      return {title:'Readiness gaps',summary:`${gaps.length} of ${tickets.length} stories fail at least one readiness flag. Recorded readiness is ${m.hygiene??0}%. Flags indicate presence only, not the quality of written requirements.`,evidence:gaps.slice(0,6).map(t=>`${t.id} · ${t.owner}: ${[!t.description?'description absent':null,!t.acceptance?'acceptance absent':null,!t.estimated?'estimate unconfirmed':null].filter(Boolean).join('; ')}.`),action:gaps.length?'Review missing context with story owners and write acceptance criteria before commitment. Use the readiness view to inspect the full queue.':'All three presence flags are set in this selection. A human review is still needed to assess whether requirements are useful.'};
    }
    if(/summary|summar|overview|report|delivery|progress/.test(text)) {
      return {title:'Scoped delivery summary',summary:`${m.done??0} of ${m.points??0} points are complete (${m.completion??0}%) across ${tickets.length} stories. ${m.blocked??0} stories are blocked and readiness is ${m.hygiene??0}%.`,evidence:(data.risks||[]).map(r=>`${r.kind}: ${r.title}. ${r.detail}`),action:'Use these figures as a discussion starting point. They describe a generated snapshot; they do not measure customer value or predict a production outcome.'};
    }
    return {title:'Choose a question grounded in the current model',summary:'This local assistant supports four topics: blocked work, capacity, readiness, and the delivery summary. It does not call an AI service or invent an answer outside these rules.',evidence:[],action:'Try “Which stories are blocked?”, “Are we over capacity?”, “What is missing for readiness?”, or “Summarize delivery.”'};
  }
  function answerHtml(result,e) {
    return `<h3>${e(result.title)}</h3><p style="margin-top:10px">${e(result.summary)}</p>${result.evidence.length?`<div class="cards-list" style="margin-top:16px">${result.evidence.map(x=>`<div class="risk-card"><p>${e(x)}</p></div>`).join('')}</div>`:''}<div class="note">${e(result.action)}</div><small>Rule-based response · evidence from the currently selected synthetic overview · no external model.</small>`;
  }
  function render(view,data,h) {
    const {e,n,table,panel,kpi}=h,tickets=rowsOf(data),epics=epicsOf(data);
    if(view==='gantt') return `${panel('Outcome timeline',`<div id="mx-gantt-body" aria-live="polite"><p>Loading the dependency schedule for this selection…</p></div>`)}<div class="note">A synthetic finish-to-start schedule. Durations use remaining points divided by entered team capacity per working day; they are modeled estimates, not commitments or historical delivery measurements. Upstream outcomes may appear across the selected team boundary.</div>`;
    if(view==='assistant') {
      if(assistantQuestion)assistantAnswer=answer(assistantQuestion,data);
      return `<div class="grid2">${panel('Ask about this portfolio',`<span class="badge">Local rule-based assistant</span><p style="margin:12px 0 18px">Inspect the same scoped evidence used in the dashboard. Answers are deterministic and limited to the documented model.</p><form id="mx-assistant-form"><label>Your question<input id="mx-assistant-question" maxlength="250" value="${e(assistantQuestion)}" placeholder="Which stories are blocked?" required></label><button style="margin-top:14px">Inspect evidence</button></form><div class="actions" style="margin-top:18px">${[['blocked','Blocked work'],['capacity','Capacity'],['readiness','Readiness'],['summary','Delivery summary']].map(([q,label])=>`<button class="secondary" data-mx-question="${q}">${e(label)}</button>`).join('')}</div>`)}${panel('Evidence-backed response',`<div id="mx-assistant-answer" aria-live="polite">${assistantAnswer?answerHtml(assistantAnswer,e):'<p>Choose a topic or ask a question to see the supporting story keys, counts, and planning assumptions.</p>'}</div>`)}</div>`;
    }
    if(view==='operations') {
      const queue=triage(data),aged=tickets.filter(t=>t.status!=='Done'&&number(t.age_days)>=ageThreshold),blocked=tickets.filter(t=>t.status==='Blocked'),unowned=queue.filter(t=>!String(t.owner||'').trim());
      return `<div class="kpis">${kpi('Triage queue',n(queue.length),'Blocked or over the selected age threshold')}${kpi('Blocked',n(blocked.length),'All blocked stories enter the queue')}${kpi('Aged open stories',n(aged.length),`${ageThreshold}+ recorded age days; Done excluded`)}${kpi('Unowned in queue',n(unowned.length),'No contributor assigned')}</div>${panel('Operational triage',`<div class="actions" style="margin-bottom:18px"><label for="mx-age-threshold">Recorded age threshold</label><select id="mx-age-threshold">${[3,5,7,10,14].map(v=>`<option value="${v}"${v===ageThreshold?' selected':''}>${v}+ days</option>`).join('')}</select><button class="secondary" id="mx-triage-export">Download triage JSON</button></div>${table(['Story / action','Team / owner','Status','Recorded age','Priority'],queue.map(t=>`<tr><td class="wrap"><strong>${e(t.id)}</strong> · ${e(t.title)}<br><small>${t.status==='Blocked'?'Confirm the unblock decision and upstream owner.':'Review scope, next step, and whether recorded age needs correction.'}</small></td><td>${e(t.team)}<br><small>${e(t.owner||'Unassigned')}</small></td><td>${statusBadge(t.status,e)}</td><td>${e(t.age_days)}d</td><td>${e(t.priority||'Unspecified')}</td></tr>`))}`)}<div class="note">Triage sorts blocked work first, then recorded age. The threshold is an exploratory planning rule, not a production SLA. Recorded age is not cycle time or time spent in the current status.</div>`;
    }
    if(view==='platform') {
      const cs=checks(data),failed=cs.filter(c=>c.failures.length),coverage=(field)=>tickets.length?Math.round(100*tickets.filter(t=>t[field]).length/tickets.length):100;
      return `<div class="kpis">${kpi('Stories inspected',n(tickets.length),'Current team and sprint selection')}${kpi('Checks passing',`${cs.length-failed.length} / ${cs.length}`,'No failed records for each passing check')}${kpi('Estimate coverage',coverage('estimated')+'%','Confirmation flag; positive values checked below')}${kpi('Acceptance coverage',coverage('acceptance')+'%','Presence flag, not content review')}</div>${panel('Scoped dataset integrity',table(['Validation rule','Result','Passing records','Definition / exceptions'],cs.map(c=>`<tr><td>${e(c.name)}</td><td><span class="badge ${c.failures.length?'warn':'good'}">${c.failures.length?'Review':'Passed'}</span></td><td>${c.total-c.failures.length} / ${c.total}</td><td class="wrap">${e(c.detail)}${c.failures.length?`<br><small>Exceptions: ${e(c.failures.slice(0,12).join(', '))}${c.failures.length>12?` +${c.failures.length-12} more`:''}</small>`:''}</td></tr>`)))}<div class="grid2">${panel('Entity model',`<div class="cards-list"><div class="risk-card"><h3>Story → Outcome</h3><p>Story.epic references Outcome.id. Stories are the only counted work items; outcome rows do not add extra story points.</p></div><div class="risk-card"><h3>Story → Team / Contributor / Sprint</h3><p>Team, owner, and sprint attributes define the scoped operating model. Fictional contributor identities carry no real employee information.</p></div></div>`)}${panel('Coverage interpretation',`<p>These validations inspect only the overview supplied to this view. They do not certify an entire database, inspect upstream integrations, or prove that requirements are useful.</p><div class="note">Readiness flags can intentionally be incomplete in generated data. A failed completeness check is a visible demo condition, not an undisclosed data source failure.</div>`)}</div>`;
    }
    if(view==='sources') return `<div class="kpis">${kpi('Data origin','Generated','Original Python synthetic generator')}${kpi('Seed','917','Reset rebuilds the fictional portfolio')}${kpi('Snapshot',data.as_of||'2026-10-14','Fixed demo date; not a live refresh')}${kpi('External connectors','0','No credentials or external account access')}</div><div class="grid2">${panel('Source manifest',table(['Source','Behavior','Purpose'],[
      '<tr><td>Deterministic generator</td><td>Seeded fictional records</td><td class="wrap">Stories, outcomes, contributor labels, and readiness flags</td></tr>',
      '<tr><td>Local sandbox state</td><td>Edited through dashboard controls</td><td class="wrap">Capacity, story status, added scope, baseline, and fictional review sessions</td></tr>',
      '<tr><td>Scoped overview</td><td>Current selected team and sprint</td><td class="wrap">One shared response powers the cards, tables, and this download</td></tr>'
    ]))}${panel('Inspect the current source slice',`<p>Download the current overview as JSON, including its generated records and derived metrics. This export contains only what is already loaded in the selected dashboard scope.</p><div class="actions" style="margin-top:20px"><button id="mx-source-download">Download scoped overview JSON</button></div><div class="note">No external system is connected. Connector logos, credentials, sync timestamps, and production success claims are intentionally absent because no such integration exists.</div>`)}</div>${panel('Field provenance',table(['Field family','Origin','Interpretation'],[
      '<tr><td>Keys and titles</td><td>Generated</td><td class="wrap">Fictional story/outcome IDs and generic software work</td></tr>',
      '<tr><td>Story points and capacity</td><td>Generated / sandbox edits</td><td class="wrap">Planning units and explicit capacity assumptions</td></tr>',
      '<tr><td>Age and cycle days</td><td>Generated fixture values</td><td class="wrap">Illustrative attributes, not observed production telemetry</td></tr>',
      '<tr><td>Completion and readiness</td><td>Computed from scoped stories</td><td class="wrap">Status and presence-flag aggregations</td></tr>',
      '<tr><td>Forecast and dependency schedule</td><td>Local mathematical model</td><td class="wrap">Modeled scenarios with disclosed assumptions</td></tr>'
    ]))}`;
    return null;
  }
  function bind(view,data,ctx) {
    const e=UI.e,n=UI.n;
    if(view==='gantt') {
      const target=document.getElementById('mx-gantt-body');
      if(!target)return;
      const suffix=typeof ctx.query==='function'?ctx.query():String(ctx.query||'');
      ctx.api('/api/mission/dependencies'+suffix).then(schedule=>{
        if(!document.contains(target))return;
        const nodes=schedule.nodes||[],horizon=Math.max(1,...nodes.map(x=>number(x.finish))),critical=new Set(schedule.critical_path||[]);
        target.innerHTML=`<div class="actions" style="justify-content:space-between;margin-bottom:22px"><p><strong>${e((schedule.critical_path||[]).join(' → ')||'No remaining chain')}</strong><br><small>Estimated critical chain · ${n(schedule.total_days||0)} modeled working days</small></p><span class="badge">Day 0–${horizon}</span></div><div class="table-wrap"><table><thead><tr><th>Outcome</th><th>Start</th><th>Duration</th><th style="min-width:300px">Modeled working-day timeline</th><th>Finish</th></tr></thead><tbody>${nodes.map(x=>{const start=number(x.start),duration=number(x.duration),finish=number(x.finish);return `<tr><td class="wrap"><strong>${e(x.id)}</strong> · ${e(x.title)}${critical.has(x.id)?'<br><small>On estimated critical chain</small>':''}</td><td>${start}d</td><td>${duration}d</td><td><div role="img" aria-label="${e(x.id)} starts day ${start} and finishes day ${finish}" style="position:relative;height:28px;min-width:280px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#94a3b833 calc(10% - 1px),#94a3b833 10%);border-bottom:1px solid #94a3b833"><i style="position:absolute;top:5px;left:${Math.min(100,start/horizon*100)}%;width:${Math.max(duration?1:0,Math.min(100,duration/horizon*100))}%;height:16px;background:${critical.has(x.id)?'#5b78c7':'#77b8ab'};border-radius:3px"></i>${duration===0?`<span style="position:absolute;left:${Math.min(98,start/horizon*100)}%;top:3px;color:#5b78c7">◆</span>`:''}</div></td><td>${finish}d</td></tr>`;}).join('')||'<tr><td colspan="5">No outcomes in this selection.</td></tr>'}</tbody></table></div><p style="margin-top:15px"><small>Blue: estimated critical chain. Teal: other dependency work. A diamond marks zero remaining modeled duration. The horizontal scale spans 0–${horizon} working days.</small></p>`;
      }).catch(err=>{if(document.contains(target))target.innerHTML=`<div class="error">${e(err.message)}</div>`;ctx.toast(err.message);});
    }
    if(view==='assistant') {
      const form=document.getElementById('mx-assistant-form');
      const respond=question=>{assistantQuestion=question.trim().slice(0,250);assistantAnswer=answer(assistantQuestion,data);const output=document.getElementById('mx-assistant-answer');if(output)output.innerHTML=answerHtml(assistantAnswer,e);const input=document.getElementById('mx-assistant-question');if(input)input.value=assistantQuestion;};
      if(form)form.onsubmit=ev=>{ev.preventDefault();respond(document.getElementById('mx-assistant-question').value);};
      document.querySelectorAll('[data-mx-question]').forEach(b=>b.onclick=()=>respond(b.dataset.mxQuestion));
    }
    if(view==='operations') {
      const input=document.getElementById('mx-age-threshold');
      if(input)input.onchange=()=>{ageThreshold=Number(input.value);ctx.render();};
      const button=document.getElementById('mx-triage-export');
      if(button)button.onclick=()=>ctx.download('mission-synthetic-triage.json',JSON.stringify({synthetic:true,as_of:data.as_of,rule:{age_threshold_days:ageThreshold,include_all_blocked:true,exclude_status:'Done',note:'Recorded synthetic age is not time in current status or an SLA.'},tickets:triage(data)},null,2),'application/json');
    }
    if(view==='sources') {
      const button=document.getElementById('mx-source-download');
      if(button)button.onclick=()=>ctx.download('mission-synthetic-scoped-overview.json',JSON.stringify({export_kind:'current synthetic scoped overview',generator_seed:917,fixed_snapshot:data.as_of,overview:data},null,2),'application/json');
    }
  }
  window.MissionExtras={render,bind};
})();
