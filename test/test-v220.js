/* WOS v2.2 verification (jsdom), against the real 2026-09-30 backup.
   Covers PRD app-v2.2: log a past EMOM (A), overnight EMOM + Resume card (D),
   EMOM-done walk steps (C), the PE-style EMOM timer screen (B).
   Run:  node test-v220.js   (reads ../index.html and <WOS_DIR>/state/wos-backup.json) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Specs live in Joel's OneDrive workout folder, not this repo. Override with WOS_DIR.
const WOS_DIR = process.env.WOS_DIR || 'C:/Users/JoelTerrell/OneDrive - Terrell World/Documents/Cowork/workout';
const HTML = fs.readFileSync(process.env.WOS_HTML || path.join(__dirname, '../index.html'), 'utf8');
const BACKUP = JSON.parse(fs.readFileSync(path.join(WOS_DIR, 'state/wos-backup.json'), 'utf8'));
// Records up to the 9/30 export, so later backups don't move the expectations.
const upTo = d => !!d && d <= '2026-09-29';
const SEED = {
  config: BACKUP.config,
  sessions: BACKUP.sessions.filter(s => upTo(s.date)),
  daily: (BACKUP.daily || []).filter(s => upTo(s.date)),
  weekly: (BACKUP.weekly || []).filter(s => upTo(s.weekOf)),
  meta: Object.assign({}, BACKUP.meta),
  notes: BACKUP.notes || [],
  active: null
};
const clone = o => JSON.parse(JSON.stringify(o));

let pass = 0, fail = 0; const F = [];
function ok(n, c, d){ if(c){ pass++; console.log('  PASS  '+n); } else { fail++; const m = n+(d!==undefined?(' :: got '+JSON.stringify(d)):''); F.push(m); console.log('  FAIL  '+m); } }
function eq(n, a, b){ ok(n, JSON.stringify(a)===JSON.stringify(b), a); }
const tick = (ms) => new Promise(r => setTimeout(r, ms||5));

/* Fresh app on a fixed day. Date.now() = fixed + window.__clockOffset, so a
   test can move time forward (every timer runs on Date.now()). Sounds are
   recorded in window.__sounds instead of played. */
function boot(dayISO, seed){
  const fixed = new Date(dayISO).getTime();
  const s = seed || SEED;
  const dom = new JSDOM(HTML, { runScripts:'dangerously', url:'https://wos.local/', pretendToBeVisual:true,
    beforeParse(w){
      const RD = w.Date;
      class FD extends RD { constructor(...a){ if(!a.length) super(fixed + (w.__clockOffset||0)); else super(...a); } static now(){ return fixed + (w.__clockOffset||0); } }
      w.Date = FD; w.__clockOffset = 0;
      w.confirm = ()=>true; w.alert = ()=>{}; w.navigator.vibrate = ()=>true;
      w.open = (u)=>{ w.__opened = u; };
      for(const k in s) w.localStorage.setItem('wos.'+k, JSON.stringify(s[k]));
    } });
  const w = dom.window;
  w.eval(`window.__sounds = []; emomSound = function(k){ window.__sounds.push(k); }; window.__beeps = []; beep = function(ms){ window.__beeps.push(ms||300); };`);
  return { dom, w, ev: code => w.eval(code), store: k => JSON.parse(w.localStorage.getItem('wos.'+k)),
           seed(){ const o = {}; for(let i=0;i<w.localStorage.length;i++){ const k=w.localStorage.key(i); if(k.startsWith('wos.')) o[k.slice(4)] = JSON.parse(w.localStorage.getItem(k)); } return o; } };
}
const txt = el => el.textContent.replace(/\s+/g,' ').trim();
const $ = (a, id) => a.w.document.getElementById(id);
function answer(app, sl, so, en){ app.w.setReadiness('sleep', sl); app.w.setReadiness('sore', so); app.w.setReadiness('energy', en); }
function saveWith(app, rpe){ app.w.setRPE(rpe||6); app.ev('saveSession(30)'); }
const lastSession = a => a.store('sessions').slice(-1)[0];

const OCT7 = '2026-10-07T09:00:00';   // Wed; 9/30..10/6 hold no sessions in the fixture
const WED  = '2026-09-30T09:00:00';   // an EMOM (K) day

(async function main(){

console.log('\n== A: past EMOM — date fence and slot list ==');
{
  const seed = clone(SEED);
  seed.sessions.push({date:'2026-10-01', slot:'C', readiness:null, work:[{mode:'incline_walk',min:30}], min:30, manual:true});
  const a = boot(OCT7, seed);
  a.ev('Nav.toManual({})');
  const days = [...a.w.document.querySelectorAll('#app .pill-btn')].map(b=>({t:txt(b), off:b.classList.contains('disabled')}));
  ok('8 days back (Sep 29) is not offered', !days.some(d=>/September 29/.test(d.t)), days.map(d=>d.t));
  ok('7 days back (Sep 30) is offered', days.some(d=>/September 30/.test(d.t) && !d.off));
  ok('an already-logged date (Oct 1) is disabled', days.some(d=>/October 1\b/.test(d.t) && d.off && /already logged/.test(d.t)));
  a.w.manualPickDate('2026-10-05');
  const slots = [...a.w.document.querySelectorAll('#app .pill-btn')].map(txt);
  const iB = slots.indexOf('STRENGTH B'), iE = slots.indexOf('KETTLEBELL EMOM'), iC = slots.indexOf('CARDIO');
  ok('slot list has KETTLEBELL EMOM between Strength B and Cardio', iE>0 && iE===iB+1 && iC===iE+1, slots);
  a.dom.window.close();
}

console.log('\n== A: past EMOM — defaults, autosave, saved record ==');
{
  const a = boot(OCT7);
  a.ev('Nav.toManual({})'); a.w.manualPickDate('2026-10-05'); a.w.manualPickSlot('EMOM');
  ok('readiness step offers "Don\'t remember"', /DON'T REMEMBER/.test(txt(a.w.document.getElementById('app'))));
  a.w.manualProceed(true);
  ok('past-EMOM screen shown (no timer)', !!$(a,'emom-past') && !$(a,'emom-screen'));
  const wk = a.ev(`weekEmomId('2026-10-05')`);
  eq('week of 10/5 EMOM is E1 (after the 9/21 week, first E4)', wk, 'E1');
  const sel = a.w.document.querySelector('#emom-past .emom-pick.sel');
  ok('that week\'s EMOM is picked by default', sel && sel.id==='past-emom-E1');
  ok('and tagged "this week"', sel && /this week/.test(txt(sel)));
  eq('four EMOM buttons', a.w.document.querySelectorAll('#emom-past .emom-pick').length, 4);
  eq('rounds default to the program (3)', txt($(a,'past-rounds')), '3');
  eq('EMOM minutes fill in as rounds × 6', $(a,'past-emom-min').value, '18');
  eq('walk blank by default', $(a,'finisher-min').value, '');
  eq('vest blank by default', $(a,'vest-lb').value, '');
  a.w.setPastRounds(-1);
  eq('rounds − → 2', txt($(a,'past-rounds')), '2');
  eq('minutes refill to 12', $(a,'past-emom-min').value, '12');
  for(let i=0;i<5;i++) a.w.setPastRounds(-1);
  eq('rounds floor at 1', txt($(a,'past-rounds')), '1');
  for(let i=0;i<9;i++) a.w.setPastRounds(1);
  eq('rounds cap at 5', txt($(a,'past-rounds')), '5');
  a.w.setPastRounds(-1); a.w.setPastRounds(-1);   // back to 3
  a.w.setPastEmom('E2');
  ok('picking EMOM 2 selects it', a.w.document.querySelector('#emom-past .emom-pick.sel').id==='past-emom-E2');
  a.w.setPastEmomMin('20');
  a.w.setFinisherMin('10'); a.w.setVest('20','finisherVest');
  const act = a.store('active');
  eq('every field autosaved to active', [act.emom.emomId, act.emom.rounds, act.emom.emomMin, act.finisherMin, act.finisherVest, act.manual], ['E2',3,20,10,20,true]);
  a.w.finishEmomPast();
  eq('NEXT: FINISH goes to Finish', a.ev('lastRender.name'), 'finish');
  eq('Finish duration seeded with EMOM + walk minutes', $(a,'finish-min').value, '30');
  saveWith(a);
  const s = lastSession(a);
  eq('saved record', [s.date, s.slot, s.emomId, s.rounds, s.min, s.manual, s.readiness], ['2026-10-05','EMOM','E2',3,30,true,null]);
  eq('walk + vest in finisher', s.finisher, {mode:'walk', min:10, vest:20});
  ok('no offPlan on a manual entry', !('offPlan' in s));
  ok('no steps on a past EMOM', !('steps' in s));
  eq('vest becomes the default', a.store('prefs').vestLb, 20);
  eq('active cleared after save', a.store('active'), null);
  a.dom.window.close();
}
{
  const a = boot(OCT7);
  a.ev('Nav.toManual({})'); a.w.manualPickDate('2026-10-02'); a.w.manualPickSlot('EMOM');
  answer(a, 4, 4, 4); a.w.manualProceed(false);
  a.w.setVest('25','finisherVest');                       // vest typed, but no walk
  a.w.finishEmomPast(); saveWith(a);
  const s = lastSession(a);
  eq('remembered readiness saved', s.readiness && s.readiness.state, 'GREEN');
  eq('blank walk: min = rounds × 6, no finisher', [s.min, 'finisher' in s], [18, false]);
  a.dom.window.close();
}
{
  const a = boot(OCT7);
  a.ev('Nav.toManual({})'); a.w.manualPickDate('2026-10-02'); a.w.manualPickSlot('EMOM'); a.w.manualProceed(true);
  a.w.setPastEmomMin('');                                  // cleared → rounds × 6
  a.w.setFinisherMin('0');
  a.w.finishEmomPast();
  const d = a.ev('finishDraft');
  eq('cleared minutes = rounds × 6; walk 0 = no finisher', [d.min, 'finisher' in d], [18, false]);
  a.dom.window.close();
}
{
  const a = boot(OCT7);
  a.ev('Nav.toManual({})'); a.w.manualPickDate('2026-10-02'); a.w.manualPickSlot('EMOM'); a.w.manualProceed(true);
  a.w.pastEmomBack();
  eq('‹ Back clears the half-made entry', a.store('active'), null);
  ok('‹ Back returns to the slot list', /KETTLEBELL EMOM/.test(txt(a.w.document.getElementById('app'))));
  a.dom.window.close();
}

console.log('\n== A: a backfilled first-of-week EMOM sets the week ==');
{
  const a = boot(OCT7);
  eq('before: week of 10/5 is E1', a.ev(`weekEmomId('2026-10-07')`), 'E1');
  a.ev('Nav.toManual({})'); a.w.manualPickDate('2026-10-05'); a.w.manualPickSlot('EMOM'); a.w.manualProceed(true);
  a.w.setPastEmom('E3'); a.w.finishEmomPast(); saveWith(a);
  eq('after backfilling E3 on Mon 10/5, the week is E3', a.ev(`weekEmomId('2026-10-07')`), 'E3');
  eq('next week moves on to E4', a.ev(`weekEmomId('2026-10-12')`), 'E4');
  ok('Home today card names the week\'s EMOM', /Kettlebell EMOM 3/.test(txt($(a,'today-card'))));
  a.dom.window.close();
}

console.log('\n== A: Edit from History opens the past-EMOM screen ==');
{
  const seed = clone(SEED);
  seed.sessions.push({date:'2026-10-05', slot:'EMOM', emomId:'E3', rounds:2, min:22, readiness:null, rpe:7, note:'felt good',
                      finisher:{mode:'walk', min:10, vest:15}, steps:{start:100, end:2600}});
  const idx = seed.sessions.length-1;
  const a = boot(OCT7, seed);
  a.ev('Nav.toManual({editingIndex:'+idx+'})'); await tick();
  ok('edit opens the past-EMOM screen', !!$(a,'emom-past'));
  ok('header says editing', /editing a saved session/.test(txt($(a,'emom-past'))));
  ok('saved EMOM selected', a.w.document.querySelector('#emom-past .emom-pick.sel').id==='past-emom-E3');
  eq('rounds from the record', txt($(a,'past-rounds')), '2');
  eq('EMOM minutes = min − walk', $(a,'past-emom-min').value, '12');
  eq('walk and vest from the record', [$(a,'finisher-min').value, $(a,'vest-lb').value], ['10','15']);
  a.w.setFinisherMin('12');
  a.w.finishEmomPast();
  ok('Finish shows the saved note', $(a,'finish-note').value==='felt good');
  saveWith(a);
  const ss = a.store('sessions');
  eq('edit replaces the record in place', ss.length, seed.sessions.length);
  const s = ss[idx];
  eq('edited record', [s.slot, s.emomId, s.rounds, s.min, s.finisher, s.manual], ['EMOM','E3',2,24,{mode:'walk',min:12,vest:15},true]);
  eq('steps survive the edit', s.steps, {start:100, end:2600});
  eq('note survives the edit', s.note, 'felt good');
  a.dom.window.close();
}
{
  const a = boot(OCT7);
  const idx = a.store('sessions').findIndex(s=>s.date==='2026-09-23' && s.slot==='EMOM');
  a.ev('Nav.toManual({editingIndex:'+idx+'})'); await tick();
  ok('editing a live EMOM record opens the past-EMOM screen, not recovery', !!$(a,'emom-past') && a.ev('sessionState.variant.kind')==='EMOM');
  eq('filled in from the live record', [a.w.document.querySelector('#emom-past .emom-pick.sel').id, txt($(a,'past-rounds')), $(a,'past-emom-min').value], ['past-emom-E1','3','18']);
  a.dom.window.close();
}

console.log('\n== D1: an overnight EMOM closed with "Finish & log it" saves as EMOM ==');
const READINESS_G = {sleep:4, sore:4, energy:4, score:12, state:'GREEN'};
function staleSeed(emom, extra){
  const seed = clone(SEED);
  seed.active = Object.assign({ date:'2026-09-29', screen:'session', startedAt: new Date('2026-09-29T08:00:00').getTime(),
    variant:{kind:'EMOM', emomId:'E1', degraded:false, readiness:READINESS_G}, note:'', manual:false, editingIndex:null,
    emom, steps:null, finisherMode:'walk', finisherMin:null, finisherVest:null, timers:{} }, extra||{});
  return seed;
}
{
  // A 2.1.0-shaped active EMOM that reached "EMOM done", with a typed walk.
  const a = boot(WED, staleSeed({emomId:'E1', rounds:3, idx:18, endAt:null, remain:null, running:false, done:true},
                                {finisherMin:10, finisherVest:20, steps:{start:'500', end:'2500'}}));
  const sheet = a.w.document.querySelector('.modal-backdrop');
  ok('previous-day prompt shown', sheet && /Unfinished session from 2026-09-29/.test(txt(sheet)));
  ok('prompt names the EMOM', sheet && /KB EMOM 1/.test(txt(sheet)), sheet && txt(sheet));
  sheet.querySelector('#cs-ok').click();
  const d = a.ev('finishDraft');
  eq('draft is an EMOM, not recovery', [d.slot, d.emomId, d.rounds, d.min, d.date], ['EMOM','E1',3,28,'2026-09-29']);
  eq('walk + vest carried', d.finisher, {mode:'walk', min:10, vest:20});
  eq('steps carried', d.steps, {start:500, end:2500});
  saveWith(a);
  const s = a.store('sessions').find(x=>x.date==='2026-09-29' && x.slot==='EMOM');
  ok('saved as slot EMOM on its own date', !!s && s.min===28, s);
  ok('no recovery record written', !a.store('sessions').some(x=>x.date==='2026-09-29' && x.slot==='REC'));
  a.dom.window.close();
}
{
  // 2.1.0 shape, abandoned mid-way (minute 9 of 18).
  const a = boot(WED, staleSeed({emomId:'E2', rounds:3, idx:8, endAt:null, remain:30000, running:false, done:false}));
  a.w.document.querySelector('#cs-ok').click();
  const d = a.ev('finishDraft');
  eq('old shape mid-way: 8 minutes done, 1 full round', [d.slot, d.emomId, d.min, d.rounds, 'finisher' in d], ['EMOM','E2',8,1,false]);
  a.dom.window.close();
}
{
  // 2.2 shape, paused 7.5 minutes in (10 s get-ready + 7 full minutes + 30 s).
  const a = boot(WED, staleSeed({v:2, emomId:'E1', rounds:3, base:0, pausedAt:10000+7*60000+30000, stage:'run'}));
  a.w.document.querySelector('#cs-ok').click();
  const d = a.ev('finishDraft');
  eq('new shape paused at minute 8: 7 minutes, 1 round', [d.slot, d.min, d.rounds], ['EMOM',7,1]);
  a.dom.window.close();
}
{
  // 2.2 shape, left running overnight: the clock says it ran out.
  const a = boot(WED, staleSeed({v:2, emomId:'E1', rounds:3, base:new Date('2026-09-29T08:00:00').getTime(), pausedAt:null, stage:'run'}));
  a.w.document.querySelector('#cs-ok').click();
  const d = a.ev('finishDraft');
  eq('left running overnight counts by the clock (all 18 min, 3 rounds)', [d.min, d.rounds], [18,3]);
  a.dom.window.close();
}

console.log('\n== D2: the Resume card names the EMOM ==');
{
  const seed = staleSeed({v:2, emomId:'E1', rounds:3, base:new Date(WED).getTime()-90000, pausedAt:null, stage:'run'});
  seed.active.date = '2026-09-30';
  const a = boot(WED, seed);
  const app = a.w.document.getElementById('app');
  ok('Home shows the in-progress card', /Session in progress/.test(txt(app)));
  ok('summary names the EMOM', /KB EMOM 1/.test(txt(app.querySelector('.accent-card'))), txt(app));
  const btn = [...app.querySelectorAll('.pill-btn')].map(txt);
  ok('button reads RESUME KB EMOM 1', btn.includes('RESUME KB EMOM 1'), btn);
  a.dom.window.close();
}
{
  const seed = staleSeed(null);
  seed.active.date = '2026-09-30'; seed.active.variant = {kind:'CARDIO', readiness:READINESS_G};
  const a = boot(WED, seed);
  ok('other session types still say RESUME SESSION', [...a.w.document.querySelectorAll('#app .pill-btn')].map(txt).includes('RESUME SESSION'));
  a.dom.window.close();
}

console.log('\n== C: EMOM-done screen — walk, vest, start/end steps ==');
function doneSeed(over, readiness){
  const seed = staleSeed(Object.assign({v:2, emomId:'E1', rounds:3, base:0, pausedAt:10000+18*60000, stage:'done', doneMin:18, doneRounds:3, ended:false}, over||{}));
  seed.active.date = '2026-09-30';
  if(readiness) seed.active.variant.readiness = readiness;
  return seed;
}
{
  const a = boot(WED, doneSeed());
  a.w.resumeActive();
  ok('done screen shown', !!$(a,'emom-done') && !$(a,'emom-screen'));
  const name = a.w.document.querySelector('#emom-done .emom-name');
  eq('header "KB EMOM 1" in the readiness color', [txt(name), name.style.color], ['KB EMOM 1','var(--green)']);
  eq('DONE strip reads "3 rounds · 18:00"', txt($(a,'emom-done-sub')), '3 rounds · 18:00');
  eq('one blue bar per round', [a.w.document.querySelectorAll('#emom-done .emom-dbar').length, a.w.document.querySelectorAll('#emom-done .emom-dbar.full').length], [3,3]);
  ok('walk block: timer, typed minutes, vest, start + end steps',
     ['finisher-timer','finisher-toggle','finisher-min','vest-lb','walk-steps-start','walk-steps-end','walk-steps'].every(id=>!!$(a,id)));
  ok('Back to the timer link and FINISH present', !!$(a,'emom-back-timer') && /FINISH/.test(txt($(a,'emom-done'))));
  eq('steps line blank until both are in', txt($(a,'walk-steps')), '–');
  a.w.setWalkSteps('start', '1000');
  eq('only start typed: still blank', txt($(a,'walk-steps')), '–');
  a.w.setWalkSteps('end', '3500');
  eq('"Steps on the walk" = end − start, live', txt($(a,'walk-steps')), '2,500');
  eq('steps autosaved to active', a.store('active').steps, {start:'1000', end:'3500'});
  a.w.setFinisherMin('12'); a.w.setVest('20','finisherVest');
  a.ev('finishEmomSession()');
  const d = a.ev('finishDraft');
  eq('draft: steps, walk + vest, min = 18 + 12', [d.steps, d.finisher, d.min, d.rounds], [{start:1000,end:3500},{mode:'walk',min:12,vest:20},30,3]);
  a.w.document.getElementById('finish-back').click();
  ok('Finish → Back returns to the done screen', !!$(a,'emom-done'));
  eq('steps still there after Back', [$(a,'walk-steps-start').value, $(a,'walk-steps-end').value, txt($(a,'walk-steps'))], ['1000','3500','2,500']);
  a.ev('finishEmomSession()'); saveWith(a);
  const s = lastSession(a);
  eq('saved record carries the walk steps in `steps`', [s.slot, s.steps, s.min], ['EMOM',{start:1000,end:3500},30]);
  a.dom.window.close();
}
{
  const a = boot(WED, doneSeed());
  a.w.resumeActive();
  a.w.setWalkSteps('start', '1000');                    // end left blank
  a.ev('finishEmomSession()');
  const d = a.ev('finishDraft');
  ok('blank end steps: no steps, no finisher, no nag', !('steps' in d) && !('finisher' in d) && !a.w.document.querySelector('.modal-backdrop'), d);
  eq('min = EMOM minutes only', d.min, 18);
  a.dom.window.close();
}
{
  const a = boot(WED, doneSeed({doneMin:14, doneRounds:2, ended:true, pausedAt:10000+14*60000+20000}, {sleep:3,sore:3,energy:3,score:9,state:'YELLOW'}));
  a.w.resumeActive();
  eq('after an early stop: "2 rounds · 14:00"', txt($(a,'emom-done-sub')), '2 rounds · 14:00');
  eq('2 of 3 round bars blue', a.w.document.querySelectorAll('#emom-done .emom-dbar.full').length, 2);
  eq('YELLOW session: header in yellow', a.w.document.querySelector('#emom-done .emom-name').style.color, 'var(--yellow)');
  a.ev('finishEmomSession()');
  eq('early stop logs minutes and full rounds done', [a.ev('finishDraft.min'), a.ev('finishDraft.rounds')], [14,2]);
  a.dom.window.close();
}
{
  const a = boot(WED, doneSeed());
  a.w.resumeActive();
  a.w.toggleFinisherTimer();
  eq('walk timer START → PAUSE', txt($(a,'finisher-toggle')), 'PAUSE');
  a.w.__clockOffset += 8*60000;
  a.ev('refreshTimers()');
  eq('walk timer shows wall-clock time', txt($(a,'finisher-timer')), '08:00');
  const seed = a.seed(); a.dom.window.close();
  const b = boot(WED, seed); b.w.__clockOffset += 8*60000 + 60000;   // reopen one minute later
  b.w.resumeActive();
  eq('resume: walk timer still counting, shows PAUSE', [txt($(b,'finisher-timer')), txt($(b,'finisher-toggle'))], ['09:00','PAUSE']);
  b.ev('finishEmomSession()');
  eq('timed walk logged as finisher minutes', b.ev('finishDraft.finisher'), {mode:'walk', min:9});
  b.dom.window.close();
}

console.log('\n== B: EMOM timer screen — layout ==');
const MOVES_E1 = SEED.config.emom.workouts[0].ex.map(e=>e.name);
function startEmom(readiness){
  const a = boot(WED);
  if(readiness==='YELLOW') answer(a, 3, 3, 3); else answer(a, 4, 4, 4);
  a.w.startSession();
  return a;
}
// Move the clock by ms in 200 ms repaint steps, like the live interval.
function run(a, ms){ const steps = Math.round(ms/200); for(let i=0;i<steps;i++){ a.w.__clockOffset += 200; a.w.emomPaint(); } }
const shown = a => ({ pill: txt($(a,'emom-pill')), now: txt($(a,'emom-nowname')), label: txt($(a,'emom-boxlabel')), t: txt($(a,'emom-tval')),
                      next: txt($(a,'emom-nextname')), left: txt($(a,'emom-left')), nowLabel: txt($(a,'emom-nowlabel')) });
{
  const a = startEmom();
  ok('timer screen shown', !!$(a,'emom-screen'));
  const name = a.w.document.querySelector('#emom-screen .emom-name');
  eq('header "KB EMOM 1" in GREEN', [txt(name), name.style.color], ['KB EMOM 1','var(--green)']);
  const s = shown(a);
  eq('get-ready: pill, labels, number', [s.pill, s.nowLabel, s.label, s.t], ['GET READY','FIRST UP','GET READY','0:10']);
  ok('GET READY pill is blue', $(a,'emom-pill').classList.contains('ready'));
  eq('get-ready shows move 1 now and move 2 next', [s.now, s.next], [MOVES_E1[0], MOVES_E1[1]]);
  eq('total time left 18:00', s.left, '18:00');
  eq('meter: 18 bars in 3 round groups', [a.w.document.querySelectorAll('#emom-segs .emom-rgrp').length, a.w.document.querySelectorAll('#emom-segs .emom-seg').length], [3,18]);
  eq('controls: Back, Pause, Skip, Stop', [...a.w.document.querySelectorAll('.emom-ctrl')].map(txt), ['Back','Pause','Skip','Stop']);
  eq('Drop a round label shows the change', txt($(a,'emom-drop')), 'Drop a round (3 → 2)');
  ok('Video link present', /Video/.test(txt(a.w.document.querySelector('.emom-video'))));
  ok('no steps fields on the timer screen', !a.w.document.querySelector('#emom-screen input'));
  ok('no minute pill, no state word', !/Minute \d+ of/.test(txt($(a,'emom-screen'))) && !/GREEN/.test(txt($(a,'emom-screen'))));
  eq('timer saved to active (v2 clock fields)', (({v,emomId,rounds,pausedAt,stage})=>({v,emomId,rounds,pausedAt,stage}))(a.store('active').emom), {v:2, emomId:'E1', rounds:3, pausedAt:null, stage:'run'});
  a.dom.window.close();
}

console.log('\n== B: right minute and move from the clock ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000; a.w.emomPaint();
  let s = shown(a);
  eq('10 s: minute 1, round 1', [s.pill, s.nowLabel, s.now, s.label, s.t, s.left], ['Round 1 of 3','NOW',MOVES_E1[0],'THIS MINUTE','0:59','18:00']);
  a.w.__clockOffset = 10000 + 5*60000 + 30000; a.w.emomPaint();
  s = shown(a);
  eq('5:40: minute 6 (last of round 1), 0:30 left', [s.pill, s.now, s.t, s.next, s.left], ['Round 1 of 3', MOVES_E1[5], '0:30', MOVES_E1[0], '12:30']);
  ok('"Starts round 2" chip on the last minute of a round', !$(a,'emom-nextchip').classList.contains('hidden') && txt($(a,'emom-nextchip'))==='Starts round 2');
  eq('meter: 5 bars done', a.w.document.querySelectorAll('#emom-segs .emom-seg.full').length, 5);
  eq('current bar half full', parseFloat(a.w.document.querySelectorAll('#emom-segs .emom-seg')[5].firstChild.style.width), 50);
  a.w.__clockOffset = 10000 + 7*60000 + 57500; a.w.emomPaint();
  s = shown(a);
  eq('8:07.5: minute 8, round 2, last 3 s', [s.pill, s.now, s.label, s.t], ['Round 2 of 3', MOVES_E1[1], 'SWITCH COMING', '0:02']);
  ok('box turns blue for the last 3 s', $(a,'emom-box').classList.contains('warn'));
  ok('no round chip mid-round', $(a,'emom-nextchip').classList.contains('hidden'));
  a.w.__clockOffset = 10000 + 17*60000 + 1000; a.w.emomPaint();
  s = shown(a);
  eq('last minute: NEXT reads Done, no round chip', [s.pill, s.now, s.next, $(a,'emom-nextchip').classList.contains('hidden')], ['Round 3 of 3', MOVES_E1[5], 'Done', true]);
  a.dom.window.close();
}

console.log('\n== B: sounds, live only ==');
{
  const a = startEmom();
  a.w.__sounds.length = 0;
  run(a, 10000 + 60000 + 400);   // through get-ready, minute 1, into minute 2
  eq('ticks 3,2,1 in get-ready, chime, ticks 3,2,1, chime', a.w.__sounds, ['tick','tick','tick','change','tick','tick','tick','change']);
  a.w.__sounds.length = 0;
  // Phone sleeps 90 s, then wakes mid-minute: repaint is silent and on the right minute.
  a.w.__clockOffset += 90000; a.ev('refreshTimers()');
  eq('90 s sleep: no sound fired on wake', a.w.__sounds, []);
  const e = a.ev('emomElapsed(sessionState.emom)');
  eq('90 s sleep: lands on the right minute (2:30 into the minutes = minute 3)', [Math.floor((e-10000)/60000)+1, txt($(a,'emom-nowname'))], [3, MOVES_E1[2]]);
  run(a, 2000);
  eq('after waking, no stale sounds on the next live repaints', a.w.__sounds, []);
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 17*60000 + 55000; a.w.emomPaint();   // near the end
  a.w.__sounds.length = 0;
  run(a, 6000);
  eq('last minute: ticks then the finish sound (no chime)', a.w.__sounds, ['tick','tick','tick','finish']);
  ok('ends on the done screen, not Finish', !!$(a,'emom-done') && a.ev('lastRender.name')==='session' && a.ev('finishDraft')===null);
  eq('full run done: 3 rounds · 18:00', txt($(a,'emom-done-sub')), '3 rounds · 18:00');
  eq('done state autosaved', (({stage,doneMin,doneRounds,ended})=>({stage,doneMin,doneRounds,ended}))(a.store('active').emom), {stage:'done',doneMin:18,doneRounds:3,ended:false});
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 50000; a.w.emomPaint();
  a.w.__clockOffset = 10000 + 17*60000 + 55000; a.w.emomPaint();        // slept through to near the end
  a.w.__clockOffset = 10000 + 18*60000 + 120000; a.w.__sounds.length = 0; a.w.emomPaint();   // and past it
  eq('ran out while asleep: no finish sound', a.w.__sounds, []);
  ok('still lands on the done screen', !!$(a,'emom-done'));
  a.dom.window.close();
}

console.log('\n== B: Pause, Back, Skip ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 2*60000 + 20000; a.w.emomPaint();   // minute 3, 0:40 left
  a.w.emomTogglePause();
  ok('paused: PAUSED tag shows, number dims', $(a,'emom-box').classList.contains('paused'));
  eq('Pause button becomes Resume', txt($(a,'emom-pause')), 'Resume');
  ok('pause autosaved', a.store('active').emom.pausedAt === 10000 + 2*60000 + 20000);
  a.w.__sounds.length = 0;
  run(a, 30000);
  eq('pause holds: still 0:40, minute 3', [txt($(a,'emom-tval')), txt($(a,'emom-nowname'))], ['0:40', MOVES_E1[2]]);
  eq('no sounds while paused', a.w.__sounds, []);
  a.w.emomBack();
  eq('Back (paused): start of this minute', a.ev('emomElapsed(sessionState.emom)'), 10000 + 2*60000);
  a.w.emomBack();
  eq('Back again at the start: previous minute', a.ev('emomElapsed(sessionState.emom)'), 10000 + 60000);
  a.w.emomSkip();
  eq('Skip: start of the next minute', a.ev('emomElapsed(sessionState.emom)'), 10000 + 2*60000);
  ok('Back/Skip autosave', a.store('active').emom.pausedAt === 10000 + 2*60000);
  a.w.emomTogglePause();
  a.w.__clockOffset += 5000; a.w.emomPaint();
  eq('resume runs on from where it was', [txt($(a,'emom-tval')), txt($(a,'emom-pause'))], ['0:55','Pause']);
  a.w.emomBack();
  eq('Back while running: start of this minute', Math.round(a.ev('emomElapsed(sessionState.emom)')), 10000 + 2*60000);
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 4000; a.w.emomPaint();
  a.w.emomBack();
  eq('Back in get-ready: start of get-ready', a.ev('emomElapsed(sessionState.emom)'), 0);
  a.w.emomSkip();
  eq('Skip in get-ready: minute 1', a.ev('emomElapsed(sessionState.emom)'), 10000);
  eq('Skip lands on minute 1 with no sound', [txt($(a,'emom-pill')), a.w.__sounds.length], ['Round 1 of 3', 0]);
  a.w.__clockOffset += 1000; a.w.emomBack();
  eq('Back in the first 2 s of minute 1: start of get-ready', a.ev('emomElapsed(sessionState.emom)'), 0);
  a.w.emomTogglePause();
  ok('Pause works during get-ready', $(a,'emom-box').classList.contains('paused') && txt($(a,'emom-pill'))==='GET READY');
  a.w.emomTogglePause();
  a.ev('emomSetElapsed(sessionState.emom, 10000 + 17*60000 + 3000)'); a.w.emomPaint();
  a.w.emomSkip();
  ok('Skip from the last minute ends the EMOM as complete', !!$(a,'emom-done') && txt($(a,'emom-done-sub'))==='3 rounds · 18:00');
  a.dom.window.close();
}

console.log('\n== B: Stop → End it, Keep going ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 14*60000 + 25000; a.w.emomPaint();   // minute 15
  a.w.emomAskStop();
  const ask = $(a,'emom-ask');
  ok('Stop asks "End EMOM early?"', ask && /End EMOM early\?/.test(txt(ask)) && /End it/.test(txt(ask)) && /Keep going/.test(txt(ask)));
  $(a,'emom-ask-no').click();
  ok('Keep going closes it and the timer runs on', !$(a,'emom-ask') && !!$(a,'emom-screen') && a.store('active').emom.pausedAt===null);
  a.w.__clockOffset += 5000; a.w.emomPaint();
  a.w.emomAskStop(); $(a,'emom-ask-yes').click();
  ok('End it goes to the done screen', !!$(a,'emom-done') && !$(a,'emom-ask'));
  eq('End it logs full rounds + minutes finished', txt($(a,'emom-done-sub')), '2 rounds · 14:00');
  a.ev('finishEmomSession()');
  eq('draft: rounds 2, min 14', [a.ev('finishDraft.rounds'), a.ev('finishDraft.min')], [2,14]);
  saveWith(a);
  eq('saved early-stop record', (({slot,emomId,rounds,min})=>({slot,emomId,rounds,min}))(lastSession(a)), {slot:'EMOM',emomId:'E1',rounds:2,min:14});
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 3000; a.w.emomPaint();
  a.w.emomAskStop(); $(a,'emom-ask-yes').click();
  eq('Stop during get-ready: 0 rounds · 0:00', txt($(a,'emom-done-sub')), '0 rounds · 0:00');
  a.dom.window.close();
}

console.log('\n== B: Back to the timer ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 9*60000 + 40000; a.w.emomPaint();
  a.w.emomAskStop(); $(a,'emom-ask-yes').click();
  a.w.document.getElementById('emom-back-timer').click();
  ok('after End it: back on the timer, paused where it stopped', !!$(a,'emom-screen') && a.ev('emomElapsed(sessionState.emom)')===10000+9*60000+40000 && $(a,'emom-box').classList.contains('paused'));
  eq('timer state back to run', [a.store('active').emom.stage, 'doneMin' in a.store('active').emom], ['run', false]);
  a.w.emomTogglePause(); a.w.__clockOffset += 1000; a.w.emomPaint();
  eq('Resume carries on', txt($(a,'emom-tval')), '0:19');
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 18*60000 + 500; a.w.emomPaint();
  a.w.document.getElementById('emom-back-timer').click();
  ok('after a full run: back on the timer, paused at the start of the last minute',
     !!$(a,'emom-screen') && a.ev('emomElapsed(sessionState.emom)')===10000+17*60000 && txt($(a,'emom-pill'))==='Round 3 of 3');
  a.dom.window.close();
}

console.log('\n== B: Drop a round, YELLOW ==');
{
  const a = startEmom();
  a.w.emomDrop();
  eq('Drop: 3 → 2 rounds, meter regroups', [a.ev('sessionState.emom.rounds'), a.w.document.querySelectorAll('#emom-segs .emom-rgrp').length, txt($(a,'emom-left'))], [2,2,'12:00']);
  eq('label at the floor', txt($(a,'emom-drop')), 'Drop a round (at 2, the floor)');
  a.w.emomDrop();
  eq('floor 2: a second drop does nothing', a.ev('sessionState.emom.rounds'), 2);
  eq('drop autosaved', a.store('active').emom.rounds, 2);
  a.dom.window.close();
}
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 12*60000 + 5000; a.w.emomPaint();   // two rounds done
  a.w.emomDrop();
  ok('a drop that is already reached ends it, on the done screen', !!$(a,'emom-done') && txt($(a,'emom-done-sub'))==='2 rounds · 12:00');
  a.dom.window.close();
}
{
  const a = startEmom('YELLOW');
  eq('YELLOW starts at N−1 = 2 rounds', [a.ev('sessionState.emom.rounds'), txt($(a,'emom-left'))], [2,'12:00']);
  eq('YELLOW header in yellow', a.w.document.querySelector('#emom-screen .emom-name').style.color, 'var(--yellow)');
  a.dom.window.close();
}
{
  const a = boot(WED); answer(a, 5, 1, 5); a.w.startSession();
  ok('RED still routes to recovery, never the EMOM screen', a.ev('sessionState.variant.kind')==='REC' && !$(a,'emom-screen'));
  a.dom.window.close();
}

console.log('\n== B: video, wake lock ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 60000 + 5000; a.w.emomPaint();
  a.w.document.querySelector('.emom-video').click();
  eq('Video opens the current move\'s link', a.w.__opened, SEED.config.emom.workouts[0].ex[1].url);
  a.dom.window.close();
}
{
  // A fake Wake Lock API: requested while the timer shows, released when it ends.
  const a = boot(WED);
  a.ev(`window.__wake = []; Object.defineProperty(navigator, 'wakeLock', { configurable:true, value:{ request(){ const s={ released:false, l:null,
        addEventListener(e,f){ this.l=f; }, release(){ this.released=true; window.__wake.push('release'); if(this.l) this.l(); return Promise.resolve(); } };
        window.__wake.push('request'); return Promise.resolve(s); } } });`);
  answer(a, 4, 4, 4); a.w.startSession(); await tick();
  eq('wake lock requested when the timer opens', a.w.__wake, ['request']);
  a.w.emomAskStop(); $(a,'emom-ask-yes').click(); await tick();
  eq('released when the EMOM is stopped', a.w.__wake, ['request','release']);
  a.dom.window.close();
}
{
  const a = startEmom();   // jsdom has no navigator.wakeLock
  ok('no Wake Lock support: timer still runs', !!$(a,'emom-screen') && (a.w.__clockOffset = 20000, a.w.emomPaint(), txt($(a,'emom-pill'))==='Round 1 of 3'));
  a.dom.window.close();
}

console.log('\n== B: resume after refresh, and a 2.1.0 active EMOM ==');
{
  const a = startEmom();
  a.w.__clockOffset = 10000 + 3*60000 + 15000; a.w.emomPaint();
  const seed = a.seed(); a.dom.window.close();
  const b = boot(WED, seed); b.w.__clockOffset = 10000 + 6*60000 + 45000;   // reopened 3.5 min later
  ok('Home offers RESUME KB EMOM 1', [...b.w.document.querySelectorAll('#app .pill-btn')].map(txt).includes('RESUME KB EMOM 1'));
  b.w.resumeActive();
  const s = shown(b);
  eq('resume lands on the clock\'s minute (minute 7, 0:15 left)', [s.pill, s.now, s.t], ['Round 2 of 3', MOVES_E1[0], '0:15']);
  b.dom.window.close();
}
{
  // An active EMOM saved by 2.1.0, mid-way, on today's date.
  const seed = staleSeed({emomId:'E1', rounds:3, idx:7, endAt:null, remain:41000, running:false, done:false});
  seed.active.date = '2026-09-30';
  const a = boot(WED, seed);
  a.w.resumeActive();
  ok('2.1.0 active resumes on the new timer screen', !!$(a,'emom-screen'));
  eq('paused at the start of the minute it was on (minute 8)', [txt($(a,'emom-pill')), txt($(a,'emom-nowname')), $(a,'emom-box').classList.contains('paused')], ['Round 2 of 3', MOVES_E1[1], true]);
  a.dom.window.close();
}
{
  const seed = staleSeed({emomId:'E1', rounds:3, idx:18, endAt:null, remain:null, running:false, done:true});
  seed.active.date = '2026-09-30';
  const a = boot(WED, seed);
  a.w.resumeActive();
  ok('2.1.0 active that was done resumes on the done screen', !!$(a,'emom-done') && txt($(a,'emom-done-sub'))==='3 rounds · 18:00');
  a.dom.window.close();
}

console.log('\n== Version ==');
ok('APP_VERSION is 2.2.0', /const APP_VERSION = '2\.2\.0'/.test(HTML));

console.log('\nv2.2: ' + pass + ' pass, ' + fail + ' fail');
if(fail){ console.log(F.join('\n')); process.exit(1); }
})().catch(e=>{ console.error(e); process.exit(1); });
