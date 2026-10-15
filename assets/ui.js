window.UI = {
  e: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  n: (value, digits=0) => Number(value).toLocaleString('en-US', {maximumFractionDigits:digits}),
  api: async (path, body) => {
    const r=await fetch(path, body===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await r.json(); if(!r.ok) throw new Error(data.error || 'Request failed'); return data;
  },
  bars: (rows, max) => rows.map(r=>`<div class="bar-row"><span>${UI.e(r.label)}</span><div class="bar-track"><i style="width:${Math.max(0, Math.min(100, r.value/(max||1)*100))}%"></i></div><strong>${UI.n(r.value,1)}</strong></div>`).join(''),
  download: (name, text, mime='text/plain') => {
    const content=String(text), filename=String(name);
    const save=()=>{const u=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=u;a.download=filename;a.hidden=true;document.body.append(a);try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}};
    document.getElementById('export-preview')?.remove();
    const dialog=document.createElement('dialog');dialog.id='export-preview';dialog.className='export-preview';dialog.setAttribute('aria-labelledby','export-preview-title');
    const heading=document.createElement('h2');heading.id='export-preview-title';heading.textContent='Export ready';
    const info=document.createElement('p');info.textContent=filename+' · '+content.length.toLocaleString('en-US')+' characters · synthetic demo output';
    const preview=document.createElement('textarea');preview.readOnly=true;preview.value=content;preview.setAttribute('aria-label','Prepared export contents');preview.spellcheck=false;
    const actions=document.createElement('div');actions.className='actions';
    const retry=document.createElement('button');retry.textContent='Save file';retry.onclick=save;
    const copy=document.createElement('button');copy.className='secondary';copy.textContent='Copy contents';copy.onclick=async()=>{try{await navigator.clipboard.writeText(content);UI.toast('Export contents copied');}catch{preview.focus();preview.select();UI.toast('Contents selected. Use your browser’s copy command.');}};
    const close=document.createElement('button');close.className='secondary';close.textContent='Close';close.onclick=()=>dialog.close();
    actions.append(retry,copy,close);dialog.append(heading,info,preview,actions);document.body.append(dialog);dialog.showModal();save();
  },
  toast: text => {let x=document.getElementById('toast');if(!x){x=document.createElement('div');x.id='toast';x.setAttribute('role','status');document.body.append(x);}x.textContent=text;x.hidden=false;clearTimeout(UI.timer);UI.timer=setTimeout(()=>x.hidden=true,3500);},
  line: (series, labels=[]) => {const max=Math.max(1,...series.flatMap(s=>s.values));const size=Math.max(1,...series.map(s=>s.values.length-1));return `<svg role="img" aria-label="${UI.e(labels.join(', ')||'Series comparison')}" viewBox="0 0 600 190"><path d="M20 10V170H580" fill="none" stroke="#34424b"/>${series.map((s,i)=>`<polyline fill="none" stroke="${(UI.chartColors||['#b2f977','#64cddd','#e8aa6b'])[i%3]}" stroke-width="3" points="${s.values.map((v,j)=>`${20+j/size*560},${170-v/max*150}`).join(' ')}"/>`).join('')}</svg><div class="legend">${series.map((s,i)=>`<span style="color:${(UI.chartColors||['#b2f977','#64cddd','#e8aa6b'])[i%3]}">${UI.e(s.name)}</span>`).join('')}</div>`;}
};
