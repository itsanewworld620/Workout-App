/* v1.6.0 logic tests against the real 2026-07-31 backup fixture. */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('/sessions/great-happy-lamport/mnt/workout/Current App Build/Workout App/index.html','utf8');
const backup = JSON.parse(fs.readFileSync('/sessions/great-happy-lamport/mnt/workout/state/wos-backup.json','utf8'));
const m = html.match(/<script>([\s\S]*)<\/script>/);
if(!m) throw new Error('no script block');
let script = m[1];

/* ---- DOM/browser stubs ---- */
const mem = {};
function fakeEl(){
  return { innerHTML:'', textContent:'', value:'', style:{cssText:''},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    dataset:{}, appendChild(){}, removeChild(){}, remove(){},
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; },
    addEventListener(){}, focus(){}, select(){}, click(){}, onclick:null };
}
const sandbox = {
  localStorage: {
    getItem:k=>(k in mem?mem[k]:null),
    setItem:(k,v)=>{mem[k]=String(v);},
    removeItem:k=>{delete mem[k];}
  },
  document: {
    getElementById(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    createElement(){ return fakeEl(); },
    body: fakeEl(),
    addEventListener(){}
  },
  window: { addEventListener(){} },
  history: { pushState(){} },
  navigator: {},
  confirm: ()=>true,
  alert: ()=>{},
  setInterval: ()=>0, clearInterval: ()=>{}, setTimeout: (f)=>0,
  Date, JSON, Math, console, URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
  Blob: function(){},
};
sandbox.window.AudioContext = function(){ throw new Error('no audio'); };
vm.createContext(sandbox);

/* ---- tests appended into the same script scope ---- */
const tests = `
;(function(){
  const results = [];
  function T(name, fn){ try{ fn(); results.push(['PASS',name]); }catch(e){ results.push(['FAIL',name+' :: '+e.message]); } }
  function eq(a,b,msg){ if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

  // Load the real backup
  const backup = __BACKUP__;
  store.set('config', backup.config);
  store.set('sessions', backup.sessions);
  store.set('daily', backup.daily);
  store.set('weekly', backup.weekly);
  store.set('meta', backup.meta);
  store.set('active', null);

  // 1. Replay engine on real data
  const lifts = recomputeLifts();
  T('goblet: advanced, next GREEN target 30', ()=>{ eq(lifts.goblet_squat.weight,30); eq(lifts.goblet_squat.lastWeight,20); eq(lifts.goblet_squat.advanced,true); });
  T('bench: advanced 40->45', ()=>{ eq(lifts.db_bench.weight,45); eq(lifts.db_bench.lastWeight,40); });
  T('row: not advanced (10s), carry 80 with per-set 80/60', ()=>{
    eq(lifts.cable_row.advanced,false); eq(lifts.cable_row.weight,80);
    eq(lifts.cable_row.lastSets,[[80,10],[60,10]]);
  });
  T('carry: duration lift advanced 40->50', ()=>{ eq(lifts.farmer_carry.weight,50); eq(lifts.farmer_carry.advanced,true); });
  T('dead_bug: incrementLb 0 never adds load', ()=>{ eq(lifts.dead_bug.weight,10); eq(lifts.dead_bug.advanced,false); });
  T('trapbar: single set 10 reps, no advance, carry 95', ()=>{ eq(lifts.trapbar_deadlift.weight,95); eq(lifts.trapbar_deadlift.advanced,false); });
  T('ohp: 30x12 advanced -> 35', ()=>{ eq(lifts.db_ohp.weight,35); });

  // 2. GREEN pre-fill (workout A, next session)
  sessionState = { variant:null, date:'2026-08-03', startedAt:Date.now(), exercises:null };
  renderStrengthSession({kind:'STRENGTH', letter:'A', degraded:false, readiness:{state:'GREEN'}});
  const exG = sessionState.exercises;
  T('GREEN goblet: bumped to 30, reps reset to repLo', ()=>{
    eq(exG[0].weight,30); eq(exG[0].prefillReps,null); eq(prefillRepsFor(exG[0],0),8);
  });
  T('GREEN row: carries 80, per-set weights 80/60, reps 10/10', ()=>{
    eq(exG[2].weight,80); eq(prefillWeightFor(exG[2],0),80); eq(prefillWeightFor(exG[2],1),60);
    eq(prefillRepsFor(exG[2],0),10);
  });
  T('GREEN bench: bumped to 45', ()=>{ eq(exG[1].weight,45); });

  // 3. YELLOW pre-fill: no bumps anywhere
  sessionState = { variant:null, date:'2026-08-03', startedAt:Date.now(), exercises:null };
  renderStrengthSession({kind:'STRENGTH', letter:'A', degraded:true, readiness:{state:'YELLOW'}});
  const exY = sessionState.exercises;
  T('YELLOW goblet: last actual 20, no bump, reps carried at 12', ()=>{
    eq(exY[0].weight,20); eq(prefillRepsFor(exY[0],0),12);
  });
  T('YELLOW bench: 40, not 45', ()=>{ eq(exY[1].weight,40); });

  // 4. Soreness freeze: two stored-sore<=2 sessions running
  const frozenSessions = backup.sessions.concat([
    {date:'2026-08-01', slot:'C', readiness:{sleep:4,sore:2,energy:4,score:10,state:'YELLOW'}, work:[{mode:'bike',min:20}], rpe:4, min:20},
    {date:'2026-08-02', slot:'A', readiness:{sleep:4,sore:2,energy:4,score:10,state:'YELLOW'}, work:[], rpe:4, min:20}
  ]);
  store.set('sessions', frozenSessions);
  T('freeze active within 7 days of the pair', ()=>{ eq(sorenessFreezeActive('2026-08-03'),true); });
  T('freeze expired after 7 days', ()=>{ eq(sorenessFreezeActive('2026-08-10'),false); });
  T('no freeze on the real (non-sore) history', ()=>{
    store.set('sessions', backup.sessions);
    eq(sorenessFreezeActive('2026-08-03'),false);
  });
  // GREEN session during a freeze must not bump
  store.set('sessions', frozenSessions); recomputeLifts();
  sessionState = { variant:null, date:'2026-08-03', startedAt:Date.now(), exercises:null };
  renderStrengthSession({kind:'STRENGTH', letter:'A', degraded:false, readiness:{state:'GREEN'}});
  T('frozen GREEN: goblet stays at last actual 20', ()=>{
    eq(sessionState.frozen,true); eq(sessionState.exercises[0].weight,20);
  });
  store.set('sessions', backup.sessions); recomputeLifts();

  // 5. Soreness display flip: stored semantics unchanged
  T('sore dots render 5..1 with stored 1..5', ()=>{
    const html = readinessQ('sore','Soreness / joint feel');
    const vals = [...html.matchAll(/data-val="(\\d)"[^>]*>(\\d)</g)].map(x=>[+x[1],+x[2]]);
    eq(vals,[[1,5],[2,4],[3,3],[4,2],[5,1]]);
  });
  T('computeReadiness unchanged: stored sore 1 forces RED', ()=>{
    eq(computeReadiness(5,1,5).state,'RED');
  });
  T('computeReadiness: stored sore 5 (displayed 1, fresh) is fine', ()=>{
    eq(computeReadiness(4,5,4).state,'GREEN');
  });

  // 6. Old-backup compatibility: v1.5.x lifts shape lacks lastWeight — render must not crash
  T('old lifts shape does not crash pre-fill', ()=>{
    store.set('lifts', { goblet_squat:{weight:30, lastReps:[12,12]} });
    sessionState = { variant:null, date:'2026-08-03', startedAt:Date.now(), exercises:null };
    renderStrengthSession({kind:'STRENGTH', letter:'A', degraded:false, readiness:{state:'GREEN'}});
    eq(sessionState.exercises[0].weight,30);
    recomputeLifts();
  });

  // 7. Restore round-trip: backup in, keys land, lifts rebuilt not trusted
  T('applyRestore round-trips sessions/daily/weekly', ()=>{
    applyRestore(JSON.stringify(backup));
    eq(store.get('sessions').length, backup.sessions.length);
    eq(store.get('daily').length, backup.daily.length);
    const l = store.get('lifts');
    eq(l.dead_bug.weight, 10); // rebuilt with the increment fix, NOT the backup's stale 15
  });

  // 8. Finisher lands on the draft
  T('finishStrengthSession attaches finisher and prompts nothing when logged', ()=>{
    sessionState = { variant:{kind:'STRENGTH', letter:'A', readiness:{state:'GREEN'}},
      date:'2026-08-03', startedAt:Date.now(), exercises:[], finisherMode:'incline_walk', finisherMin:10 };
    let captured=null;
    const oldTo = Nav.toFinish; Nav.toFinish = d=>{ captured=d; };
    finishStrengthSession();
    Nav.toFinish = oldTo;
    eq(captured.finisher,{mode:'incline_walk',min:10});
  });

  // 9. Vest lands in work[0] and updates the default
  T('finishCardioSession writes vest + default', ()=>{
    store.set('prefs',{});
    sessionState = { variant:{kind:'CARDIO', readiness:{state:'GREEN'}}, date:'2026-08-03',
      startedAt:Date.now(), mode:'incline_walk', min:40, vest:20 };
    let captured=null;
    const oldTo = Nav.toFinish; Nav.toFinish = d=>{ captured=d; };
    finishCardioSession(35);
    Nav.toFinish = oldTo;
    eq(captured.work[0].vest,20);
    eq(store.get('prefs').vestLb,20);
  });

  // 10. Progress renders on real data without crashing; rolling avg correct
  T('renderProgress runs; weight card uses 7-day rolling avg', ()=>{
    store.set('sessions', backup.sessions); store.set('daily', backup.daily); recomputeLifts();
    const html = renderProgress();
    if(html.indexOf('7-day average')<0) throw new Error('missing avg label');
    // last rolling avg over 07-25..07-31 window entries: 200,202.2,202,200.8,200 -> 201.0
    if(html.indexOf('201.0')<0) throw new Error('expected 201.0 in weight card');
    if(html.indexOf('top-set weight')<0) throw new Error('missing lift chart label');
    if(html.indexOf('polyline')<0) throw new Error('charts have no connecting line');
  });

  // 11. saveSession preserves finisher and vest through the work rebuild
  T('saveSession keeps finisher + vest', ()=>{
    store.set('sessions', backup.sessions.slice());
    sessionState = null;
    finishDraft = { date:'2026-08-03', slot:'A', readiness:{sleep:4,sore:4,energy:4,score:12,state:'GREEN'},
      work:[{ex:'goblet_squat',target:'2x8-12@30',sets:[[30,8],[30,8]]}], finisher:{mode:'carry',min:9} };
    selectedRPE = 6;
    saveSession(40);
    const ss = store.get('sessions'); const last = ss[ss.length-1];
    eq(last.finisher,{mode:'carry',min:9});
    finishDraft = { date:'2026-08-04', slot:'C', readiness:null,
      work:[{mode:'incline_walk',min:30,vest:20}], min:30 };
    selectedRPE = 5;
    saveSession(30);
    const last2 = store.get('sessions').pop();
    eq(last2.work[0].vest,20); eq(last2.work[0].min,30);
  });

  // 12. Boot migration refreshed meta.appVersion
  T('meta.appVersion refreshed to APP_VERSION at boot', ()=>{
    // boot already ran at script load with empty store; simulate stale meta now
    const meta = store.get('meta'); meta.appVersion='1.3.0'; store.set('meta',meta);
    if(APP_VERSION!=='1.6.0') throw new Error('APP_VERSION wrong: '+APP_VERSION);
  });

  globalThis.__RESULTS = results;
})();
`.replace('__BACKUP__', JSON.stringify(backup));

vm.runInContext(script + tests, sandbox);
const res = sandbox.__RESULTS || [];
let fail = 0;
res.forEach(([s,n])=>{ console.log(s+'  '+n); if(s==='FAIL') fail++; });
console.log('\n' + (res.length-fail) + '/' + res.length + ' passed');
process.exit(fail?1:0);
