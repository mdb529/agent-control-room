import {AGENTS, TERMINAL, normalizeEvents, isTerminal, project, visibleColleagues, measuredComparison, presentationDelay, safeURL, number, label} from './model.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const concise=(value,max=155)=>{const text=String(value||'');return text.length>max?text.slice(0,max-1).trimEnd()+'…':text;};
const format=value=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:2}).format(value);
const percent=value=>number(value)===null?'Not recorded':`${value>0?'+':''}${value}%`;
const time=value=>{const d=new Date(value);return Number.isNaN(d.valueOf())?'—':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
const state={runs:[],run:null,context:{},contextVersion:0,events:[],cursor:-1,playing:false,following:false,liveCapable:false,
  source:null,connected:false,timer:null,shownAt:0,animation:null,selected:'orchestrator',followAgent:true,inspected:null,epoch:0,controller:null,paths:new Map(),view:project([])};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const config=JSON.parse($('control-room-config')?.textContent||'{}');
let savedSnapshot;

function notice(message=''){$('notice').hidden=!message;$('notice').textContent=message;}
async function getJSON(url,signal){
  if(config.snapshot){
    savedSnapshot??=fetch(config.snapshot,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`Demo could not load (${r.status}).`);return r.json();});
    const snapshot=await savedSnapshot;
    if(url==='/api/runs')return {runs:[{...snapshot.run,is_live_native:false,event_count:snapshot.events.length}]};
    return snapshot;
  }
  const r=await fetch(url,{signal,cache:'no-store'});if(!r.ok)throw new Error(`Request failed (${r.status}).`);return r.json();
}
function replace(id,html){
  const element=$(id),open=new Set([...element.querySelectorAll('details[open][data-key]')].map(d=>d.dataset.key));
  element.innerHTML=html;
  element.querySelectorAll('details[data-key]').forEach(d=>{if(open.has(d.dataset.key))d.open=true;});
}
function disclosure(key,title,body){return `<details data-key="${esc(key)}"><summary>${esc(title)}</summary>${body}</details>`;}
function raw(value){return `<pre class="raw">${esc(JSON.stringify(value,null,2))}</pre>`;}
function link(url,title){const safe=safeURL(url);return safe?`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>`:esc(title);}

async function refreshRuns(initial=false){
  try{
    const data=await getJSON('/api/runs');state.runs=data.runs||[];
    const selected=state.run?.run_id;
    $('run-select').replaceChildren(...state.runs.map(run=>{
      const o=document.createElement('option');o.value=run.run_id;
      o.textContent=`${label(run.signal_id)} · ${run.status} · ${run.run_id.slice(0,8)}`;return o;
    }));
    if(!state.runs.length){$('run-select').innerHTML='<option>No recorded investigations</option>';if(initial){$('connection').textContent='No runs';$('trigger-title').textContent='Waiting for an investigation';notice('No local runs found. Start a run, or point the server at a directory of saved run artifacts.');}return;}
    if(selected&&state.runs.some(r=>r.run_id===selected))$('run-select').value=selected;
    if(initial)await loadRun(state.runs.find(r=>r.status==='running')?.run_id||state.runs[0].run_id);
  }catch(error){notice(`Could not load investigations. ${error.message} Use Refresh runs to retry.`);$('connection').textContent='Connection unavailable';}
}
function clearPlayback(){clearTimeout(state.timer);state.timer=null;cancelAnimationFrame(state.animation);state.animation=null;$('packet').setAttribute('visibility','hidden');}
async function loadRun(id){
  const epoch=++state.epoch;state.controller?.abort();state.controller=new AbortController();state.source?.close();state.source=null;clearPlayback();
  Object.assign(state,{run:null,events:[],cursor:-1,context:{},contextVersion:0,playing:false,following:false,liveCapable:false,connected:false,inspected:null,selected:'orchestrator',followAgent:true});
  $('overview-inspector').hidden=true;notice();$('connection').textContent='Loading…';render();
  try{
    const data=await getJSON(`/api/runs/${encodeURIComponent(id)}`,state.controller.signal);if(epoch!==state.epoch)return;
    const listed=state.runs.find(r=>r.run_id===id)||{};
    state.run={...listed,...data.run,run_id:id};state.context=data.context||{};state.events=normalizeEvents(data.events);
    state.contextVersion=state.events.at(-1)?.sequence||0;
    state.liveCapable=listed.is_live_native===true&&!isTerminal(state.events);
    state.following=state.liveCapable;state.cursor=Math.min(0,state.events.length-1);
    state.playing=!state.liveCapable&&state.events.length>1;state.shownAt=performance.now();
    $('run-select').value=id;render();if(state.liveCapable)followLive(id,epoch);schedule();
  }catch(error){if(error.name!=='AbortError'&&epoch===state.epoch){notice(`Could not open this run. ${error.message}`);$('connection').textContent='Unable to open run';}}
}
function followLive(id,epoch){
  const after=state.events.at(-1)?.sequence||0;
  const source=new EventSource(`/api/runs/${encodeURIComponent(id)}/events?after=${after}`);state.source=source;
  source.onopen=()=>{if(epoch!==state.epoch)return;state.connected=true;renderConnection();};
  source.onerror=()=>{if(epoch!==state.epoch||state.source!==source)return;state.connected=false;
    if(isTerminal(state.events))finishStream();
    renderConnection();};
  source.addEventListener('swarm',message=>{
    if(epoch!==state.epoch)return;
    let event;try{event=JSON.parse(message.data);}catch{return;}
    const before=state.events.length;state.events=normalizeEvents([...state.events,event]);
    if(state.events.length===before)return;
    renderConnection();renderControls();if(state.timer===null)schedule();
    $('scrubber').max=Math.max(0,state.events.length-1);
    if(['observation.completed','context_scout.completed',...TERMINAL].includes(event.event))refreshContext(id,epoch);
    if(['run.completed','run.failed'].includes(event.event))finishStream();
  });
}
async function refreshContext(id,epoch){
  try{const data=await getJSON(`/api/runs/${encodeURIComponent(id)}`,state.controller.signal);if(epoch!==state.epoch)return;
    const snapshot=normalizeEvents(data.events),version=snapshot.at(-1)?.sequence||0;
    if(version>=state.contextVersion){state.context=data.context||{};state.contextVersion=version;state.run={...state.run,...data.run};}
    state.events=normalizeEvents([...state.events,...snapshot]);
    if(state.events.some(e=>['run.completed','run.failed'].includes(e.event)))finishStream();
    render();if(state.timer===null)schedule();
  }catch(error){if(error.name!=='AbortError'&&epoch===state.epoch)notice('Source details could not be refreshed. Recorded events remain available; reselect the run to retry.');}
}
function renderConnection(){
  let message;
  if(!state.run)message=state.events.length?'Loading…':'No run selected';
  else if(state.liveCapable)message=state.connected?(state.following?`● Live · paced${state.events.length-state.cursor-1?' · '+(state.events.length-state.cursor-1)+' queued':''}`:'Live · view paused'):'Reconnecting to live events…';
  else message=config.snapshot?`${config.synthetic?'Fictional demo':'Recorded demo'} · ${state.playing?'playing':state.view.terminal?'finished':'paused'}`:state.playing?'Replay · playing':state.view.terminal?'Replay · finished':'Replay · paused';
  $('connection').textContent=message;$('connection').className=`connection ${state.liveCapable&&state.connected?'live':''}`;
  $('backend').textContent=state.run?`${state.run.backend==='replay'?'Scripted backend':label(state.run.backend)||'Backend unknown'}${state.events.some(e=>e.reconstructed)?' · reconstructed timing':''}`:'';
}
function renderControls(){
  const available=state.events.length>0;
  $('play').disabled=!available;$('next').disabled=!available||state.cursor>=state.events.length-1||state.following;
  $('replay').disabled=!available;$('scrubber').disabled=!available;
  $('play').textContent=state.following?'Pause live view':state.liveCapable?'Follow live':state.playing?'Pause replay':state.cursor>=state.events.length-1?'Replay from start':'Play replay';
  $('scrubber').max=Math.max(0,state.events.length-1);$('scrubber').value=Math.max(0,state.cursor);
  $('event-counter').textContent=available?`${state.cursor+1} / ${state.events.length} events`:'0 events';
  const trace=state.events.slice(0,state.cursor+1).find(e=>safeURL(e.langfuse_trace_url))?.langfuse_trace_url;
  $('trace-link').hidden=!trace;if(trace)$('trace-link').href=safeURL(trace);
  const dwell=presentationDelay(state.events[state.cursor],Number($('speed').value))/1000;
  $('timing-note').textContent=`${config.synthetic?'Fictional data & scripted responses':state.liveCapable?'Live events · paced view':'Recorded events'} · ${dwell}s for this step · findings get extra reading time${config.synthetic?'': ' · source timestamps preserved'}.`;
}

function render(motion=false){
  state.view=project(state.events,state.cursor);const v=state.view;
  if(state.followAgent||!v.agents[state.selected])state.selected=v.active;
  const observation=v.observation||state.context.observation;
  $('trigger-label').textContent=observation?`Investigation trigger · ${observation.window||state.run?.signal_id||''}`:'Investigation trigger';
  $('trigger-title').textContent=observation?observation.metric_label||label(observation.metric):state.run?label(state.run.signal_id):'Waiting for an investigation';
  const pct=number(observation?.pct_change);$('trigger-change').textContent=pct===null?'':`${pct<0?'↓':pct>0?'↑':'→'} ${Math.abs(pct)}%`;
  chart(observation);
  $('companion-details').hidden=!(observation?.companions?.length);
  replace('companions',(observation?.companions||[]).map(c=>`<p>${esc(label(c.metric))} <strong>${esc(percent(c.pct_change))}</strong></p>`).join(''));
  replace('stages',['Detect','Investigate','Decide','Review'].map((name,i)=>`${i?'<span aria-hidden="true">→</span>':''}<span class="stage ${i===v.stage?'current':i<v.stage?'past':''}" ${i===v.stage?'aria-current="step"':''}>${name}</span>`).join(''));
  $('manager-says').textContent=v.narrative;$('manager').classList.toggle('active',v.active==='orchestrator'&&!v.terminal);
  renderTeam(v);$('run-status').textContent=v.status;$('run-status').className=`status ${v.status.includes('failed')?'error':v.approval?'waiting':''}`;
  $('handoff-label').textContent=v.handoff?.label||'';
  replace('overview-hypotheses',roundsHTML(v));$('hypotheses-summary').textContent=v.rounds.length?`${v.rounds.at(-1).analyst.hypotheses?.length||0} hypotheses · ${v.rounds.length} ${v.rounds.length===1?'round':'rounds'} of review`:'Hypotheses & review · none shared yet';
  replace('overview-activity',activityHTML(v.events));replace('detail-activity',activityHTML(v.events));$('activity-summary').textContent=`Activity · ${v.events.length} events`;
  if(state.inspected&&v.agents[state.inspected])replace('inspector-body',inspectorHTML(v.agents[state.inspected]));else $('overview-inspector').hidden=true;
  renderDetails(v);renderConnection();renderControls();drawEdges();if(motion)animateHandoff();
}
function renderTeam(v){
  replace('colleagues',visibleColleagues(v).map(id=>{
    const a=v.agents[id],output=a.output;
    const reporting=v.latest?.agent===id&&v.latest?.event==='agent.completed';
    const challenged=id==='skeptic'&&v.latest?.event==='revision.requested';
    const bubble=id==='analyst'&&reporting?output?.hypotheses?.find(h=>h.id===output.leading_hypothesis_id)?.statement:
      id==='skeptic'&&(reporting||challenged)?(output?.required_revisions?.[0]||output?.claims_tested?.[0]?.test):null;
    return `<div class="colleague"><button class="person ${v.active===id&&!v.terminal?'active':''}" id="person-${esc(id)}" data-agent="${esc(id)}"><span class="avatar" aria-hidden="true">${a.avatar}</span><strong>${esc(a.name)}</strong><small>${id==='context_scout'?'Retrieval tool':esc(a.status==='working'?'Working':a.status==='waiting'?'Waiting for review':a.status==='error'?'Failed':'Reported back')}</small></button><p class="task">${esc(a.status==='working'?concise(a.question,90):a.event?.summary||'')}</p>${bubble?`<div class="bubble">${esc(concise(bubble,110))}<br><button class="quiet" data-agent="${esc(id)}">Open ${id==='analyst'?'hypotheses':'review'}</button></div>`:''}</div>`;
  }).join(''));
}
function activityHTML(events){return events.map(e=>`<li><time datetime="${esc(e.timestamp)}">${esc(time(e.timestamp))}</time><div><strong>${esc((AGENTS[e.agent]?.name||'Orchestrator')+' · '+label(e.event.replaceAll('.',' ')))}</strong><p>${esc(e.summary)}</p></div></li>`).join('')||'<li class="empty">No events recorded yet.</li>';}
function roundsHTML(v){
  if(!v.rounds.length)return '<p class="empty">The Analyst has not shared hypotheses at this point in the run.</p>';
  return [...v.rounds].reverse().map(round=>{
    const analyst=round.analyst,review=round.review;
    const hypotheses=(analyst.hypotheses||[]).map(h=>`<article class="hypothesis"><p class="eyebrow">${esc(h.id)}${h.id===analyst.leading_hypothesis_id?' · leading hypothesis':''} · confidence ${number(h.confidence)===null?'not recorded':Math.round(h.confidence*100)+'%'}</p><p>${esc(h.statement)}</p>${disclosure(`citations-${round.attempt}-${h.id}`,'Citations & data references',citationHTML(h.evidence_passage_ids||[],v)+`<p class="meta">${esc((h.data_refs||[]).join(' · ')||'No additional data references recorded.')}</p>`)}</article>`).join('');
    const claims=(review?.claims_tested||[]).map(c=>`<div class="claim"><span class="verdict ${c.result==='supported'?'supported':''}">${esc(label(c.result))}</span><p><strong>${esc(c.claim)}</strong></p><p>${esc(c.test)}</p></div>`).join('');
    const revisions=review?.required_revisions?.length?`<h3 style="margin-top:16px">Requested revisions</h3><ul>${review.required_revisions.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:'';
    const conflicts=review?.conflicts_with_canonical?.length?disclosure(`conflicts-${round.attempt}`,'Conflicts with canonical evidence',raw(review.conflicts_with_canonical)):'';
    return disclosure(`round-${round.attempt}`,`Round ${round.attempt} · ${analyst.hypotheses?.length||0} hypotheses · ${review?'Skeptic: '+label(review.verdict):'awaiting review'}`,hypotheses+disclosure(`draft-${round.attempt}`,'Analyst’s reported explanation',`<p class="prose">${esc(analyst.draft_explanation)}</p>`)+`<section class="review-round"><h3>Skeptic’s claim-by-claim review</h3><p class="meta">Tests are recorded against claims; the run does not assign a verdict to each hypothesis.</p>${claims||'<p>Review not yet reported.</p>'}${revisions}${conflicts}</section>`);
  }).join('');
}
function citationHTML(ids,v){
  const passages=v.contextReady?(state.context.evidence?.passages||[]):[];
  return ids.map(id=>{const p=passages.find(p=>p.passage_id===id);return `<div class="source"><code>${esc(id)}</code>${p?`<p>${link(p.citation_url,label(p.source_system)||'Source')}</p>${disclosure(`passage-${id}`,'Read cited passage',`<p class="prose">${esc(p.text)}</p>`)}`:'<p class="meta">Source passage not available in this run.</p>'}</div>`;}).join('')||'<p class="empty">No passage citations recorded.</p>';
}
function sourcesHTML(a,v){
  const available=v.contextReady,evidence=state.context.evidence||{},ids=new Set();
  for(const h of a.output?.hypotheses||[])for(const id of h.evidence_passage_ids||[])ids.add(id);
  for(const id of a.output?.knowledge_entry?.source_refs||[])ids.add(id);
  let html=a.id==='orchestrator'?'<p class="source">Inputs: recorded signal, pipeline checks, agent outputs and policy controls.</p>':
    `<p class="source">${a.id==='context_scout'?'Deterministic retrieval over the governed corpus.':'Inputs: '+esc(a.id==='sentinel'?'metric observation and pipeline checks':a.id==='skeptic'?'Analyst’s draft, retrieved evidence, canonical decisions and deterministic findings':'measured signal and assigned run context')+'.'}</p>`;
  if(v.observation||state.context.observation)html+=disclosure('source-observation','Measured signal',raw(v.observation||state.context.observation));
  if(available){
    html+=`<p class="source">Retrieved systems: ${esc((v.sourceSystems.length?v.sourceSystems:[...new Set((evidence.passages||[]).map(p=>p.source_system))]).map(label).join(', ')||'Not recorded')}.</p>`;
    html+=ids.size?citationHTML([...ids],v):disclosure('all-passages',`${evidence.passages?.length||0} retrieved passages`,(evidence.passages||[]).map(p=>`<div class="source"><code>${esc(p.passage_id)}</code><p>${link(p.citation_url,label(p.source_system))}</p><p class="prose">${esc(p.text)}</p></div>`).join('')||'<p class="empty">Passage text was not saved with this run.</p>');
    if(evidence.governed_decisions)html+=disclosure('governed-decisions','Governed decision register',raw(evidence.governed_decisions));
    if(evidence.prior_findings?.length)html+=disclosure('prior-findings','Prior findings · memory, not primary evidence',raw(evidence.prior_findings));
  }else html+='<p class="empty">Business context has not been retrieved at this point in the run.</p>';
  return html;
}
function inspectorHTML(a){return `<h3>${a.avatar} ${esc(a.name)} <small>${esc(a.role)}</small></h3><p><strong>Question:</strong> ${esc(a.question)}</p><p>${esc(a.event?.summary||state.view.narrative)}</p>${a.id==='analyst'||a.id==='skeptic'?roundsHTML(state.view):disclosure(`inspector-${a.id}`,'Recorded output',raw(a.output||{}))}`;}
function renderDetails(v){
  $('follow-agent').textContent=state.followAgent?'Following active agent':'Follow active agent';$('follow-agent').setAttribute('aria-pressed',String(state.followAgent));
  $('update-by').textContent=v.latest?`${AGENTS[v.latest.agent]?.name||'Orchestrator'} · ${time(v.latest.timestamp)}`:'Waiting for activity';$('current-update').textContent=v.latest?.summary||'No events recorded yet.';
  replace('agent-list',Object.values(v.agents).map(a=>`<button class="agent-choice" data-select="${esc(a.id)}" aria-pressed="${state.selected===a.id}"><span class="face" aria-hidden="true">${a.avatar}</span><span>${esc(a.name)}<small>${esc(a.status==='working'?'Working':label(a.status))}</small></span></button>`).join(''));
  const a=v.agents[state.selected]||v.agents.orchestrator;
  const result=a.output?.decision||a.output?.verdict||(a.status==='working'?'No result reported yet.':a.event?.summary)||'No result reported yet.';
  replace('agent-detail',`<div class="work-header"><span class="face" aria-hidden="true">${a.avatar}</span><div><h2>${esc(a.name)}</h2><p class="meta">${esc(a.role)}</p></div></div><dl class="work-rows"><div><dt>Question</dt><dd>${esc(a.question)}</dd></div><div><dt>Doing now</dt><dd>${esc(a.id==='orchestrator'?v.narrative:a.status==='working'?a.started?.summary||a.question:a.event?.summary||'Waiting')}</dd></div><div><dt>Why this step</dt><dd>${esc(a.output?.rationale||a.why)}</dd></div><div><dt>Result so far</dt><dd>${esc(a.id==='orchestrator'?v.terminal?v.outcome:'Coordinating the investigation.':result)}</dd></div></dl>`+
    disclosure(`sources-${a.id}`,'Data sources & evidence',sourcesHTML(a,v))+
    disclosure(`hypotheses-${a.id}`,'Hypotheses & independent review',roundsHTML(v))+
    disclosure(`record-${a.id}`,'Recorded task & output',raw({question:a.question,latest_event:a.event,attempts:a.attempts}))) ;
  replace('management',v.decisions.map(d=>`<li><time datetime="${esc(d.event.timestamp)}">${esc(time(d.event.timestamp))}</time><div><strong>${esc(d.action)}</strong><p>${esc(d.why)}</p></div></li>`).join('')||'<li class="empty">No delegation recorded yet.</li>');
  $('outcome-title').textContent=v.outcomeTitle;
  $('outcome-description').textContent=v.terminal?(state.run?.reason||v.outcome):v.agents.decision_maker?.output?.decision||'The investigation has not ended. No final outcome is recorded yet.';
  replace('outcome-links',v.terminal?link(state.run?.pr_url||v.agents.developer?.output?.pr_url,'Review proposed change'): '');
  if(!safeURL(state.run?.pr_url||v.agents.developer?.output?.pr_url))$('outcome-links').textContent='';
}

function chart(observation){
  const host=$('trigger-chart'),comparison=measuredComparison(observation),w=host.clientWidth;if(!w)return;
  if(!comparison){host.innerHTML='<p class="chart-empty">Comparable measured values are not available for this run.</p>';return;}
  const {baseline,observed,min,max}=comparison,left=w<440?92:128,right=65,span=w-left-right,range=max-min||1,x=value=>left+(value-min)/range*span;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${w} 140`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${observation.metric_label||observation.metric}: comparison ${baseline}, observed ${observed}. ${percent(observation.pct_change)} change.`);
  const add=(name,attrs,text)=>{const node=document.createElementNS(svg.namespaceURI,name);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);if(text!==undefined)node.textContent=text;svg.append(node);return node;};
  for(const value of new Set([min,min+(max-min)/2,max])){add('line',{x1:x(value),y1:15,x2:x(value),y2:94,stroke:'var(--line)'});add('text',{x:x(value),y:113,'text-anchor':'middle'},format(value));}
  [['Comparison',baseline,38],['Observed',observed,78]].forEach(([name,value,y],i)=>{
    const rect=add('rect',{x:Math.min(x(0),x(value)),y:y-12,width:Math.abs(x(value)-x(0)),height:23,rx:3,fill:i?'var(--gold)':'var(--line)'});
    const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${name}: ${value.toLocaleString()}`;rect.append(title);
    add('text',{x:left-10,y:y+4,'text-anchor':'end'},name);add('text',{x:Math.max(x(0),x(value))+7,y:y+4,'text-anchor':'start',class:'value'},format(value));
  });
  add('text',{x:left,y:136},'Measured values · '+(observation.window||'period not recorded'));host.replaceChildren(svg);
}
function drawEdges(){
  const canvas=$('team-canvas'),r=canvas.getBoundingClientRect(),svg=$('edges'),group=$('edge-paths');if(!r.width)return;
  svg.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);group.replaceChildren();state.paths=new Map();
  const node=id=>id==='orchestrator'?$('manager'):$('person-'+id);
  const pos=id=>{const a=node(id)?.querySelector('.avatar');if(!a)return null;const b=a.getBoundingClientRect();return{x:b.left-r.left+b.width/2,y:b.top-r.top+b.height/2,r:b.width/2+8};};
  const edges=visibleColleagues(state.view).map(id=>['orchestrator',id]);
  if(node('analyst')&&node('skeptic'))edges.push(['analyst','skeptic']);
  const h=state.view.handoff;if(h&&node(h.from)&&node(h.to)&&!edges.some(([a,b])=>a===h.from&&b===h.to))edges.push([h.from,h.to]);
  for(const[from,to]of edges){const a=pos(from),b=pos(to);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,x1=a.x+dx/d*a.r,y1=a.y+dy/d*a.r,x2=b.x-dx/d*b.r,y2=b.y-dy/d*b.r;
    const path=document.createElementNS(svg.namespaceURI,'path');const horizontal=from!=='orchestrator'&&to!=='orchestrator';
    path.setAttribute('d',horizontal?`M ${x1} ${y1} Q ${(x1+x2)/2} ${y1+(from==='skeptic'?24:-24)} ${x2} ${y2}`:`M ${x1} ${y1} C ${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2} ${x2} ${y2}`);
    const hot=h?.from===from&&h?.to===to;path.setAttribute('fill','none');path.setAttribute('stroke',hot?'var(--green)':'var(--line)');path.setAttribute('stroke-width',hot?'1.8':'1.2');path.setAttribute('marker-end','url(#arrow-tip)');if(from==='skeptic'&&to==='analyst')path.setAttribute('stroke-dasharray','4 4');group.append(path);state.paths.set(from+'-'+to,path);
  }
}
function animateHandoff(){
  cancelAnimationFrame(state.animation);const packet=$('packet');packet.setAttribute('visibility','hidden');if(reduced.matches||$('overview').hidden)return;
  const h=state.view.handoff,path=h&&state.paths.get(h.from+'-'+h.to);if(!path)return;
  const total=path.getTotalLength(),start=performance.now();packet.setAttribute('visibility','visible');
  function step(now){const p=Math.min(1,(now-start)/1150),point=path.getPointAtLength(p*total);packet.setAttribute('cx',point.x);packet.setAttribute('cy',point.y);if(p<1)state.animation=requestAnimationFrame(step);else packet.setAttribute('visibility','hidden');}
  state.animation=requestAnimationFrame(step);
}
function finishStream(){
  const automatic=state.following||state.playing;
  state.source?.close();state.source=null;state.connected=false;state.liveCapable=false;state.following=false;
  state.playing=automatic&&state.cursor<state.events.length-1;
  renderConnection();renderControls();schedule();
}
function schedule(){
  clearTimeout(state.timer);state.timer=null;
  if(!state.playing&&!state.following)return;
  if(state.cursor>=state.events.length-1){
    if(!state.liveCapable){state.playing=false;state.following=false;renderConnection();renderControls();}
    return;
  }
  const dwell=presentationDelay(state.events[state.cursor],Number($('speed').value));
  const remaining=Math.max(0,dwell-(performance.now()-state.shownAt));
  state.timer=setTimeout(()=>{
    state.timer=null;state.cursor++;state.shownAt=performance.now();
    if(state.cursor===state.events.length-1&&!state.liveCapable){state.playing=false;state.following=false;}
    render(true);schedule();
  },remaining);
}
function play(){
  if(state.following||state.playing){state.following=false;state.playing=false;clearPlayback();renderConnection();renderControls();return;}
  if(state.liveCapable){state.following=true;state.shownAt=performance.now();renderConnection();renderControls();schedule();return;}
  if(state.cursor>=state.events.length-1)state.cursor=0;
  state.playing=true;state.shownAt=performance.now();render();schedule();
}
function switchTab(details,focus=false){
  $('overview').hidden=details;$('investigation-details').hidden=!details;
  for(const[id,selected]of [['overview-tab',!details],['details-tab',details]]){$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;if(selected&&focus)$(id).focus();}
  if(!details)requestAnimationFrame(()=>{chart(state.view.observation||state.context.observation);drawEdges();});
}
$('run-select').addEventListener('change',e=>loadRun(e.target.value));$('refresh-runs').addEventListener('click',()=>config.snapshot&&state.run?loadRun(state.run.run_id):refreshRuns(!state.run));
if(config.snapshot)$('refresh-runs').textContent='Restart demo';
$('play').addEventListener('click',play);$('next').addEventListener('click',()=>{clearPlayback();state.playing=false;state.following=false;if(state.cursor<state.events.length-1)state.cursor++;state.shownAt=performance.now();render(true);});
$('replay').addEventListener('click',()=>{clearPlayback();state.playing=true;state.following=false;state.cursor=0;state.shownAt=performance.now();state.inspected=null;$('overview-inspector').hidden=true;render();schedule();});
$('speed').addEventListener('change',()=>{state.shownAt=performance.now();renderControls();schedule();});
$('scrubber').addEventListener('input',e=>{clearPlayback();state.playing=false;state.following=false;state.cursor=Number(e.target.value);state.shownAt=performance.now();render();});
$('follow-agent').addEventListener('click',()=>{state.followAgent=!state.followAgent;if(state.followAgent)state.selected=state.view.active;renderDetails(state.view);});
$('close-inspector').addEventListener('click',()=>{state.inspected=null;$('overview-inspector').hidden=true;});
document.addEventListener('click',e=>{const button=e.target.closest('[data-agent],[data-select]');if(!button)return;
  if(button.dataset.agent){state.inspected=button.dataset.agent;$('overview-inspector').hidden=false;replace('inspector-body',inspectorHTML(state.view.agents[state.inspected]));}
  else{state.selected=button.dataset.select;state.followAgent=false;renderDetails(state.view);}
});
$('overview-tab').addEventListener('click',()=>switchTab(false));$('details-tab').addEventListener('click',()=>switchTab(true));
for(const id of ['overview-tab','details-tab'])$(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();switchTab(e.key==='Home'?false:e.key==='End'?true:id==='overview-tab',true);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(state.animation);$('packet').setAttribute('visibility','hidden');}});
new ResizeObserver(()=>{chart(state.view.observation||state.context.observation);drawEdges();}).observe($('team-canvas'));
refreshRuns(true);
