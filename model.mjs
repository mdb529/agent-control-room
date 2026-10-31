/** Event projection shared by live playback and replay. No DOM or network state. */
export const AGENTS = {
  orchestrator: {name:'Orchestrator', avatar:'👩🏽‍💼', role:'Team manager', question:'What should happen next?', why:'Route the work, require evidence, and enforce the stopping and approval rules.'},
  triage: {name:'Triage', avatar:'👨🏻‍💼', role:'Signal selection', question:'Which signal needs attention?', why:'Choose the strongest candidate and account for signals passed over.'},
  sentinel: {name:'Sentinel', avatar:'👩🏾‍🔬', role:'Signal validation', question:'Is this signal real, material, and safe to investigate?', why:'Check the measured signal and pipeline health before investigating a cause.'},
  context_scout: {name:'Context Scout', avatar:'⌕', role:'Retrieval tool · deterministic', question:'Which governed sources are relevant?', why:'Retrieve source passages and canonical decisions independently of the Analyst.'},
  analyst: {name:'Analyst', avatar:'🧑🏻‍💻', role:'Investigator', question:'Which competing explanations best fit the evidence?', why:'Compare multiple explanations and connect claims to source passages and measured data.'},
  skeptic: {name:'Skeptic', avatar:'👨🏾‍💼', role:'Independent reviewer', question:'Which claims survive citation and canonical checks?', why:'Test the Analyst’s claims independently; return specific revision requirements.'},
  decision_maker: {name:'Decision Maker', avatar:'👩🏼‍💼', role:'Analytics lead', question:'What is the smallest safe action that helps?', why:'Turn a supported explanation into a scoped proposal or choose no change.'},
  governance_gate: {name:'Human review', avatar:'👤', role:'Approval gate · policy control', question:'Has the proposed change been approved?', why:'Require accountable human approval before a governed change can proceed.'},
  developer: {name:'Developer', avatar:'👨🏽‍💻', role:'Change preparation', question:'Can the approved change be prepared within scope?', why:'Prepare a reviewable change within the approved paths and acceptance criteria.'},
  curator: {name:'Curator', avatar:'👩🏻‍🏫', role:'Organizational memory', question:'What should the organization remember and test next time?', why:'Propose knowledge and regression-test candidates without promoting them automatically.'},
};
export const TERMINAL = new Set(['run.completed','run.failed','run.stopped']);
export const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const label = value => String(value || '').replaceAll('_',' ');
export function safeURL(value) {
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function normalizeEvents(events) {
  const bySequence = new Map();
  for (const e of events || []) {
    if (e && typeof e.event === 'string' && Number.isInteger(e.sequence) && e.sequence > 0) bySequence.set(e.sequence,e);
  }
  return [...bySequence.values()].sort((a,b)=>a.sequence-b.sequence);
}
export function isTerminal(events) { return events.some(e=>TERMINAL.has(e.event)); }
export function stageFor(agent) {
  if (['decision_maker'].includes(agent)) return 2;
  if (['governance_gate','developer','curator'].includes(agent)) return 3;
  if (['analyst','skeptic','context_scout'].includes(agent)) return 1;
  return 0;
}
export function project(events, cursor = events.length - 1) {
  const visible = events.slice(0,Math.max(0,cursor+1));
  const manager = {id:'orchestrator', ...AGENTS.orchestrator, status:'working', attempts:[], output:null, event:null};
  const view = {events:visible, agents:{orchestrator:manager}, active:'orchestrator', stage:0,
    observation:null, contextReady:false, sourceSystems:[], rounds:[], decisions:[], latest:visible.at(-1),
    status:'Waiting', narrative:'Select an investigation to follow the work.', handoff:null,
    terminal:false, reason:null, outcome:'No action proposed.', outcomeTitle:'Outcome pending', approval:false};
  for (const e of visible) {
    const d = e.details || {}, id = e.agent || 'orchestrator';
    const persona = AGENTS[id] || {name:label(id),avatar:'👤',role:'Specialist',question:'What does the evidence show?',why:'Complete the assigned investigation task.'};
    if (e.event === 'observation.completed') view.observation = d.observation || null;
    if (e.event === 'context_scout.completed') {view.contextReady=true; view.sourceSystems=d.source_systems || [];}
    const started = ['agent.started','context_scout.started'].includes(e.event);
    const completed = ['agent.completed','context_scout.completed','agent.failed','context_scout.failed'].includes(e.event);
    if (started || completed || e.event === 'approval.required') {
      const a = view.agents[id] ||= {id,...persona,attempts:[],output:null,status:'working',event:null};
      a.event=e;
      if (started) {
        a.status='working';a.question=e.summary || persona.question;a.started=e;
        view.active=id;view.stage=Math.max(view.stage,stageFor(id));
        view.status=id==='context_scout'?'Researching context':'Investigating';
        view.narrative=id==='context_scout'?'I’m retrieving the governed context before handing it to the Analyst.':`${persona.name}, ${assignment(id,d.attempt)}.`;
        view.handoff={from:id==='skeptic'&&view.agents.analyst?'analyst':'orchestrator',to:id,
          label:id==='skeptic'?'Analyst → Skeptic · independent review':`Orchestrator → ${persona.name}`};
        view.decisions.push({event:e,action:`Assigned ${persona.name}`,why:persona.why});
      } else if (completed) {
        a.status=e.event.endsWith('.failed')?'error':'complete';
        a.output=d.output || null;a.attempts.push({event:e,output:a.output,attempt:d.attempt || 1,question:a.question});
        view.active='orchestrator';view.status=a.status==='error'?'Agent failed':'Reviewing findings';
        view.handoff={from:id,to:'orchestrator',label:`${persona.name} → Orchestrator`};
        view.narrative=a.status==='error'?`${persona.name} could not complete the task. I’m stopping to report the failure.`:`${persona.name} has reported back. ${nextSummary(id)}`;
        if(id==='analyst'&&a.output){view.rounds.push({attempt:d.attempt || 1,analyst:a.output,review:null,started:e.sequence});}
        if(id==='skeptic'&&a.output){const round=[...view.rounds].reverse().find(r=>r.attempt===(d.attempt || 1));if(round)round.review=a.output;}
        if(id==='decision_maker'&&a.output){view.outcome=a.output.decision || 'Proposal prepared.';}
      }
    }
    if (e.event==='agent.skipped') {
      view.decisions.push({event:e,action:`Skipped ${persona.name}`,why:e.summary});
      if(view.agents[id])view.agents[id].status='skipped';
    }
    if (e.event==='run.started') {view.status='Detecting';view.narrative='I’m checking the signal and deciding which specialist should investigate.';}
    if(e.event==='pipeline.completed'){view.narrative=e.status==='error'?'The data checks found a problem. I won’t proceed with an explanation.':'The data checks are recorded. Next I’ll validate the signal.';}
    if(e.event==='revision.requested') {
      view.active='orchestrator';view.status='Revision requested';view.stage=Math.max(view.stage,1);
      view.narrative='Analyst, address the Skeptic’s findings before we consider an action.';
      view.handoff={from:view.agents.skeptic?'skeptic':'orchestrator',to:'analyst',label:'Skeptic → Analyst · revision requested'};
      view.decisions.push({event:e,action:'Requested a revision',why:e.summary});
    }
    if(e.event==='approval.required') {
      view.active='governance_gate';view.stage=3;view.approval=true;view.status='Awaiting human review';
      view.agents.governance_gate.status='waiting';
      view.narrative='A person needs to review the proposal. Approval is separate from this investigation.';
      view.handoff={from:view.agents.decision_maker?'decision_maker':'orchestrator',to:'governance_gate',label:'Proposal → Human review'};
      view.decisions.push({event:e,action:'Requested human review',why:e.summary});
    }
    if(TERMINAL.has(e.event)) {
      view.terminal=true;view.active='orchestrator';
      const status=e.event==='run.failed'?'error':e.event==='run.stopped'?'stopped':e.status;
      if(e.event!=='run.completed'||!view.reason)view.reason=e.summary;
      view.status=status==='error'?'Run failed':status==='stopped'?(/unresolved/i.test(view.reason)?'Stopped · unresolved':'Stopped'):status==='awaiting_human_review'?'Awaiting human review':status==='no_change'?'Complete · no change':'Complete';
      view.outcomeTitle=view.status;
      if(status==='stopped'||status==='error') {view.outcome=view.reason;view.narrative=status==='stopped'?'The stopping rule was reached. I’m retaining the findings; no change will be proposed.':'The run failed. I’m retaining the recorded activity for inspection.';}
      else if(status==='awaiting_human_review'||view.approval){view.outcomeTitle='Awaiting human review';view.outcome='The run produced a proposal requiring human review. This viewer does not approve or apply changes.';view.narrative='The proposal is ready for human review. The investigation has ended.';}
      else {view.narrative='The investigation has ended. The recorded outcome is available below.';if(!view.agents.decision_maker?.output)view.outcome=e.summary;}
      for(const a of Object.values(view.agents))if(a.status==='working')a.status=status==='error'?'interrupted':'complete';
      view.handoff=null;
      if(e.event!=='run.completed'||!visible.some(p=>p.sequence<e.sequence&&['run.stopped','run.failed'].includes(p.event))) view.decisions.push({event:e,action:view.status,why:view.reason});
    }
  }
  return view;
}
function assignment(id,attempt) {
  return ({triage:'choose the signal that deserves investigation',sentinel:'check whether the signal is real and safe to investigate',analyst:attempt>1?'revisit the explanation using the review findings':'develop competing explanations for the change',skeptic:'test the explanation against the evidence',decision_maker:'choose the smallest useful action, or no change',developer:'prepare the approved change within scope',curator:'capture what we should remember and test next time'})[id] || 'review the assigned evidence';
}
function nextSummary(id) {return ({analyst:'I’ll ask the Skeptic to challenge the explanation.',skeptic:'I’ll use the review to decide whether to revise or proceed.',sentinel:'I’ll check the recorded validation before proceeding.',context_scout:'The retrieved sources are ready for analysis.',decision_maker:'The proposal remains subject to the approval rules.'})[id] || 'I’m coordinating the next step.';}
export function visibleColleagues(view) {
  const seen=Object.keys(view.agents).filter(id=>id!=='orchestrator'&&view.agents[id].status!=='skipped');
  if(view.stage===1&&view.agents.analyst)return ['analyst','skeptic'].filter(id=>seen.includes(id));
  if(view.terminal&&view.agents.analyst)return ['analyst','skeptic'].filter(id=>seen.includes(id));
  if(view.active!=='orchestrator')return seen.includes(view.active)?[view.active]:[];
  return seen.slice(-1);
}
/** No future result or evidence is mixed into the projection during replay. */
export function measuredComparison(observation) {
  if(!observation)return null;
  const baseline=number(observation.baseline),observed=number(observation.observed);
  if(baseline===null||observed===null)return null;
  return {baseline,observed,min:Math.min(0,baseline,observed),max:Math.max(0,baseline,observed),pct:number(observation.pct_change)};
}

/** Use the selected interval consistently, including findings and revisions. */
export function presentationDelay(_event, pace=10000) {
  return [16000,10000,5000].includes(pace)?pace:10000;
}
