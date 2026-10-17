/* WOS v2.1 verification (jsdom), against the real 2026-09-30 backup.
   Covers PRD app-v2.1: choose today's workout (picker, offPlan, A/B order),
   EMOM of the week, weight→reps pad, EMOM stays on screen with a walk block,
   vest on the finisher walk, live-only EMOM countdown beeps, Finish → Back.
   Run:  node test-v210.js   (reads ../index.html and <WOS_DIR>/state/wos-backup.json) */
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

let pass = 0, fail = 0; const F = [];
function ok(n, c, d){ if(c){ pass++; console.log('  PASS  '+n); } else { fail++; const m = n+(d!==undefined?(' :: got '+JSON.stringify(d)):''); F.push(m); console.log('  FAIL  '+m); } }
function eq(n, a, b){ ok(n, JSON.stringify(a)===JSON.stringify(b), a); }

/* Fresh app on a fixed day. Date.now() = fixed + window.__clockOffset, so a
   test can move time forward (the EMOM timer runs on Date.now()). */
function boot(dayISO, seed){
  const fixed = new Date(dayISO).getTime();
  const dom = new JSDOM(HTML, { runScripts:'dangerously', url:'https://wos.local/', pretendToBeVisual:true,
    beforeParse(w){
      const RD = w.Date;
      class FD extends RD { constructor(...a){ if(!a.length) super(fixed + (w.__clockOffset||0)); else super(...a); } static now(){ return fixed + (w.__clockOffset||0); } }
      w.Date = FD; w.__clockOffset = 0;
      w.confirm = ()=>true; w.alert = ()=>{}; w.navigator.vibrate = ()=>true;
      for(const k in (seed||SEED)) w.localStorage.setItem('wos.'+k, JSON.stringify((seed||SEED)[k]));
    } });
  const w = dom.window;
  w.eval(`window.__beeps = []; beep = function(ms){ window.__beeps.push(ms||300); };`);
  return { dom, w, ev: code => w.eval(code), store: k => JSON.parse(w.localStorage.getItem('wos.'+k)) };
}
const txt = w => { const c = w.document.body.cloneNode(true); c.querySelectorAll('script').forEach(s=>s.remove()); return c.textContent.replace(/\s+/g,' '); };
function answer(app, sl, so, en){ app.w.setReadiness('sleep', sl); app.w.setReadiness('sore', so); app.w.setReadiness('energy', en); }
function pick(app, label){
  app.w.openPicker();
  const rows = [...app.w.document.querySelectorAll('.pick-row')];
  const row = rows.find(r => r.querySelector('.list-title').textContent.trim() === label);
  if(!row) throw new Error('no picker row '+label);
  row.click();
}
function saveWith(app, rpe){ app.w.setRPE(rpe||6); app.ev('saveSession(30)'); }

const WED = '2026-09-30T09:00:00';   // an EMOM (K) day
const THU = '2026-10-01T09:00:00';   // a strength (S) day

console.log('\n== EMOM of the week ==');
{
  const a = boot(WED);
  // Last EMOM week (9/21) began with E4 → this week is E1 (Joel's rule, 2026-09-30).
  eq('this week (9/30) recommends E1', a.ev(`weekEmomId('2026-09-30')`), 'E1');
  eq('Mon 9/28 same week → E1', a.ev(`weekEmomId('2026-09-28')`), 'E1');
  eq('Fri 10/2 same week → E1', a.ev(`weekEmomId('2026-10-02')`), 'E1');
  // Picking E2 on the week's first EMOM session sets the week.
  a.ev(`var ss=store.get('sessions'); ss.push({date:'2026-09-30',slot:'EMOM',emomId:'E2',rounds:3,min:18,readiness:null}); store.set('sessions',ss);`);
  eq('first EMOM of the week sets the week (E2)', a.ev(`weekEmomId('2026-10-02')`), 'E2');
  // A different EMOM later the same week is a one-off.
  a.ev(`var ss=store.get('sessions'); ss.push({date:'2026-10-02',slot:'EMOM',emomId:'E4',rounds:3,min:18,readiness:null}); store.set('sessions',ss);`);
  eq('later one-off does not change this week', a.ev(`weekEmomId('2026-10-03')`), 'E2');
  eq('next week advances from the week\'s first (E3), not the one-off', a.ev(`weekEmomId('2026-10-05')`), 'E3');
  // A missed week does not skip a workout.
  eq('missed week: the week after still gets E3', a.ev(`weekEmomId('2026-10-14')`), 'E3');
  eq('nextEmomId follows the week rule (E2 logged today)', a.ev(`nextEmomId()`), 'E2');
  a.dom.window.close();
}

console.log('\n== Home: Recommended + picker ==');
{
  const a = boot(WED);
  const t = txt(a.w);
  ok('Today card shows Kettlebell EMOM 1', /Kettlebell EMOM 1/.test(a.w.document.getElementById('today-card').textContent));
  ok('Today card marked Recommended', /Recommended/.test(a.w.document.getElementById('today-card').textContent));
  ok('Today card shows "This week: Kettlebell EMOM 1"', /This week: Kettlebell EMOM 1/.test(t));
  ok('"Pick a different workout" link present', !!a.w.document.getElementById('pick-link'));
  a.w.openPicker();
  const rows = [...a.w.document.querySelectorAll('.pick-row')].map(r=>r.querySelector('.list-title').textContent.trim());
  eq('picker lists every workout, Recommended first', rows,
    ['Kettlebell EMOM 1','Strength A','Strength B','Kettlebell EMOM 2','Kettlebell EMOM 3','Kettlebell EMOM 4','Cardio',
     'No gym — Gym circuit','No gym — Travel / bodyweight','No gym — Outdoor walk']);
  const sheet = a.w.document.getElementById('pick-sheet').textContent;
  ok('next strength letter marked "next up"', /Strength A\s*next up/.test(sheet.replace(/\s+/g,' ')));
  ok('Recommended group header shown', /Recommended/.test(sheet));
  a.w.document.getElementById('pick-close').click();
  ok('picker closes', !a.w.document.getElementById('pick-sheet'));
  // Tap outside also closes
  a.w.openPicker(); const bd = a.w.document.getElementById('pick-sheet');
  bd.dispatchEvent(new a.w.MouseEvent('click', {bubbles:true}));
  ok('tap outside closes the picker', !a.w.document.getElementById('pick-sheet'));
  // Picking sets the pending session and names it
  pick(a, 'Strength A');
  ok('pick banner names the choice', /Today: Strength A/.test(txt(a.w)));
  ok('Recommended card unchanged after a pick', /Kettlebell EMOM 1/.test(a.w.document.getElementById('today-card').textContent));
  pick(a, 'Kettlebell EMOM 1');
  eq('picking the Recommended one clears the pending pick', a.ev('pendingQuick'), null);
  a.dom.window.close();
}

console.log('\n== Picker + readiness: GREEN / YELLOW / RED ==');
{
  const a = boot(WED);
  pick(a, 'Strength A'); answer(a, 4, 4, 4); a.w.startSession();
  const v = a.ev('sessionState.variant');
  eq('GREEN pick of Strength A runs Strength A', [v.kind, v.letter, !!v.degraded], ['STRENGTH','A',false]);
  eq('off-plan pick flagged on the session', v.offPlan, true);
  a.dom.window.close();
}
{
  const a = boot(WED);
  pick(a, 'Strength A'); answer(a, 3, 3, 3); a.w.startSession();
  const v = a.ev('sessionState.variant');
  eq('YELLOW pick of Strength A is degraded', [v.kind, v.letter, v.degraded], ['STRENGTH','A',true]);
  const cfgSets = a.ev(`store.get('config').workouts.A[0].sets`);
  eq('YELLOW drops the last set', a.w.document.querySelectorAll('.ex-card')[0].querySelectorAll('.set-row').length, cfgSets-1);
  a.dom.window.close();
}
{
  const a = boot(WED);
  pick(a, 'Strength A'); answer(a, 5, 1, 5); a.w.startSession();   // stored sore 1 → RED
  const v = a.ev('sessionState.variant');
  eq('RED after a pick still routes to recovery', v.kind, 'REC');
  ok('RED recovery never offPlan', !v.offPlan, v.offPlan);
  a.dom.window.close();
}
{
  const a = boot(WED);
  pick(a, 'Kettlebell EMOM 3'); answer(a, 3, 3, 3); a.w.startSession();
  eq('YELLOW picked EMOM drops a round', [a.ev('sessionState.variant.emomId'), a.ev('sessionState.emom.rounds')], ['E3', 2]);
  a.dom.window.close();
}
{
  const a = boot(WED);
  pick(a, 'Cardio'); answer(a, 3, 3, 3); a.w.startSession();
  eq('YELLOW picked cardio is degraded (20 min rule)', [a.ev('sessionState.variant.kind'), a.ev('sessionState.variant.degraded')], ['CARDIO', true]);
  a.dom.window.close();
}
{
  const a = boot(WED);
  pick(a, 'No gym — Outdoor walk'); answer(a, 4, 4, 4); a.w.startSession();
  eq('picked MVS outdoor runs MVS outdoor', [a.ev('sessionState.variant.kind'), a.ev('sessionState.variant.mvsType')], ['MVS','outdoor']);
  a.dom.window.close();
}

console.log('\n== offPlan flag on the saved record ==');
{
  const a = boot(WED);
  answer(a, 4, 4, 4); a.w.startSession();                       // follow the plan: EMOM E1
  eq('plan session is EMOM E1', a.ev('sessionState.variant.emomId'), 'E1');
  a.ev('finishEmomSession()'); saveWith(a);
  const last = a.store('sessions').slice(-1)[0];
  ok('following the plan: no offPlan field', !('offPlan' in last), last.offPlan);
  a.dom.window.close();
}
{
  const a = boot(WED);
  a.w.quickWalk(); answer(a, 4, 4, 4); a.w.startSession();       // "Log a walk" on an EMOM day
  a.ev('finishCardioSession(35)'); saveWith(a);
  eq('"Log a walk" on an EMOM day saves offPlan:true', a.store('sessions').slice(-1)[0].offPlan, true);
  a.dom.window.close();
}
{
  const a = boot(WED);
  a.w.quickEmom('E1'); answer(a, 4, 4, 4); a.w.startSession();   // library Start of this week's EMOM
  a.ev('finishEmomSession()'); saveWith(a);
  ok('library Start of the Recommended EMOM is not offPlan', !('offPlan' in a.store('sessions').slice(-1)[0]));
  a.dom.window.close();
}

console.log('\n== A/B order after an off-plan strength pick ==');
{
  const a = boot(WED);
  eq('before: next strength letter is A', a.ev('nextStrengthLetter()'), 'A');
  pick(a, 'Strength A'); answer(a, 4, 4, 4); a.w.startSession();
  a.ev(`finishStrengthSession(); var b=document.getElementById('cs-cancel'); if(b) b.click();`);
  saveWith(a);
  const s = a.store('sessions').slice(-1)[0];
  eq('picked letter logged as slot A with offPlan', [s.slot, s.offPlan], ['A', true]);
  const seed = {}; for(let i=0;i<a.w.localStorage.length;i++){ const k=a.w.localStorage.key(i); if(k.startsWith('wos.')) seed[k.slice(4)] = JSON.parse(a.w.localStorage.getItem(k)); }
  a.dom.window.close();
  const b = boot(THU, seed);
  ok('next day recommends the other letter (Strength B)', /Strength B/.test(b.w.document.getElementById('today-card').textContent));
  b.dom.window.close();
}

console.log('\n== C1: weight Save opens the reps pad; outside tap cancels ==');
{
  const a = boot(THU);
  answer(a, 4, 4, 4); a.w.startSession();
  const rBefore = a.w.document.getElementById('rchip-0-0').textContent.trim();
  a.w.editSet(0, 0, 'weight');
  let sheet = a.w.document.querySelector('.modal-backdrop');
  ok('weight pad opens', sheet && /Weight/.test(sheet.textContent));
  sheet.querySelector('#numpad-input').value = '35';
  sheet.querySelector('#numpad-save').click();
  eq('weight saved to the chip', a.w.document.getElementById('wchip-0-0').textContent.trim(), '35');
  sheet = a.w.document.querySelector('.modal-backdrop');
  ok('reps pad opens straight after', sheet && /Reps/.test(sheet.textContent));
  sheet.querySelector('#numpad-input').value = '99';
  sheet.dispatchEvent(new a.w.MouseEvent('click', {bubbles:true}));   // tap outside the sheet
  ok('tap outside closes the pad', !a.w.document.querySelector('.modal-backdrop'));
  eq('tap outside does not save', a.w.document.getElementById('rchip-0-0').textContent.trim(), rBefore);
  // tapping inside the sheet must not close it
  a.w.editSet(0, 1, 'reps');
  sheet = a.w.document.querySelector('.modal-backdrop');
  sheet.querySelector('.modal-sheet').dispatchEvent(new a.w.MouseEvent('click', {bubbles:true}));
  ok('tap inside the pad keeps it open', !!a.w.document.querySelector('.modal-backdrop'));
  sheet.querySelector('#numpad-cancel').click();
  a.dom.window.close();
}

console.log('\n== C2: EMOM ends on the EMOM screen, walk block, FINISH ==');
// v2.2: ported to the new timer (clock starts with the screen; done screen replaces
// the timer). Same intent as the v2.1 checks; the v2.2 layout is in test-v220.js.
let emomDoneSeed = null;
{
  const a = boot(WED);
  answer(a, 4, 4, 4); a.w.startSession();
  const total = a.ev('sessionState.emom.rounds * emomWorkout(sessionState.emom.emomId).ex.length');
  ok('walk block hidden while the EMOM runs', !a.w.document.getElementById('emom-walk'));
  for(let m=0; m<=total; m++){ a.w.__clockOffset += 60000; a.w.emomPaint(); }   // get-ready + every minute
  eq('still on the session screen after the last minute', a.ev('lastRender.name'), 'session');
  eq('no Finish draft created', a.ev('finishDraft'), null);
  ok('shows the EMOM done screen', /DONE/.test(a.w.document.getElementById('emom-done').textContent));
  eq('emom marked done', a.ev('sessionState.emom.stage'), 'done');
  ok('walk block visible', !!a.w.document.getElementById('emom-walk'));
  ok('timer controls gone once done', !a.w.document.getElementById('emom-pause'));
  ok('walk block has a vest field', !!a.w.document.querySelector('#emom-walk #vest-lb'));
  ok('walk block has no mode picker', !a.w.document.getElementById('fin-mode-carry'));
  eq('done state autosaved to active', a.store('active').emom.stage, 'done');
  // Resume keeps the done state
  const seed = {}; for(let i=0;i<a.w.localStorage.length;i++){ const k=a.w.localStorage.key(i); if(k.startsWith('wos.')) seed[k.slice(4)] = JSON.parse(a.w.localStorage.getItem(k)); }
  emomDoneSeed = seed;
  // Walk: type 10 min, 20 lb vest
  a.w.setFinisherMin('10'); a.w.setVest('20','finisherVest');
  a.ev('finishEmomSession()');
  const d = a.ev('finishDraft');
  eq('walk logged as finisher {mode:walk,min,vest}', d.finisher, {mode:'walk', min:10, vest:20});
  eq('walk minutes added to session min', d.min, total + 10);
  saveWith(a);
  const s = a.store('sessions').slice(-1)[0];
  eq('saved EMOM record carries the walk', [s.slot, s.emomId, s.finisher, s.min], ['EMOM','E1',{mode:'walk',min:10,vest:20}, total+10]);
  eq('vest becomes the default', a.store('prefs').vestLb, 20);
  a.dom.window.close();
}
{
  const a = boot(WED, emomDoneSeed);
  a.w.resumeActive();
  ok('resume after done shows the done screen', !!a.w.document.getElementById('emom-done'));
  ok('resume after done shows the walk block', !!a.w.document.getElementById('emom-walk'));
  a.dom.window.close();
}
{
  const a = boot(WED);
  answer(a, 4, 4, 4); a.w.startSession();
  a.ev('finishEmomSession()');
  const d = a.ev('finishDraft');
  ok('no walk → no finisher, no confirm nag', !d.finisher && !a.w.document.querySelector('.modal-backdrop'));
  a.dom.window.close();
}
{
  const a = boot(WED);
  answer(a, 4, 4, 4); a.w.startSession();
  const per = a.ev('emomWorkout(sessionState.emom.emomId).ex.length');
  a.w.__clockOffset = 10000 + 2*per*60000 + 1000; a.w.emomPaint();   // two full rounds of three
  a.w.emomDrop();                                                      // 3 → 2 rounds: already done
  eq('Drop a round that ends it stays on screen', [a.ev('lastRender.name'), a.ev('sessionState.emom.stage')], ['session', 'done']);
  a.dom.window.close();
}

console.log('\n== C4: EMOM countdown sounds, live only (v2.2 PE sounds replace the v2.1 beeps) ==');
{
  const a = boot(WED);
  answer(a, 4, 4, 4); a.w.startSession();
  a.ev(`window.__snd = []; emomSound = function(k){ window.__snd.push(k); };`);
  // Walk the clock from 56 s into minute 1 to the start of minute 2 in 250 ms steps, like the live repaint.
  a.w.__clockOffset = 10000 + 56000; a.w.emomPaint();
  for(let i=0;i<17;i++){ a.w.__clockOffset += 250; a.w.emomPaint(); }
  eq('ticks at 3, 2, 1 then the minute-change chime', a.w.__snd, ['tick','tick','tick','change']);
  a.w.__snd.length = 0;
  // Phone sleeps 3 minutes, wakes: repaint after a long gap must be silent.
  a.w.__clockOffset += 3*60000; a.w.emomPaint();
  eq('no late sound on wake', a.w.__snd, []);
  a.dom.window.close();
}

console.log('\n== C3: vest on the strength finisher (incline walk only) ==');
{
  const a = boot(THU);
  answer(a, 4, 4, 4); a.w.startSession();
  a.w.setFinisherMode('incline_walk');
  ok('vest shows for incline walk', a.w.document.getElementById('fin-vest').style.display==='block');
  a.w.setFinisherMode('carry');
  ok('vest hidden for carries', a.w.document.getElementById('fin-vest').style.display==='none');
  a.w.setFinisherMode('incline_walk');
  a.w.setFinisherMin('10'); a.w.setVest('15','finisherVest');
  eq('finisher vest autosaved', a.store('active').finisherVest, 15);
  a.ev('finishStrengthSession()');
  eq('strength finisher logs vest', a.ev('finishDraft').finisher, {mode:'incline_walk', min:10, vest:15});
  a.dom.window.close();
}
{
  const a = boot(THU);
  answer(a, 4, 4, 4); a.w.startSession();
  a.w.setFinisherMode('carry'); a.w.setFinisherMin('8'); a.w.setVest('15','finisherVest');
  a.ev('finishStrengthSession()');
  eq('carries never log a vest', a.ev('finishDraft').finisher, {mode:'carry', min:8});
  a.dom.window.close();
}
{
  const a = boot(THU);
  answer(a, 4, 4, 4); a.w.startSession();
  a.w.setFinisherMode('incline_walk'); a.w.setFinisherMin('8');
  a.ev('finishStrengthSession()');
  ok('blank vest logs no vest', !('vest' in a.ev('finishDraft').finisher));
  a.dom.window.close();
}

console.log('\n== Finish → Back returns to the session intact ==');
{
  const a = boot(THU);
  answer(a, 4, 4, 4); a.w.startSession();
  a.w.logSet(0, 0);
  a.w.setFinisherMode('incline_walk');
  a.w.toggleFinisherTimer(); a.w.__clockOffset += 5*60000;          // walk 5 min on the clock
  a.ev('finishStrengthSession()');
  ok('Finish screen has a Back link', !!a.w.document.getElementById('finish-back'));
  a.w.document.getElementById('finish-back').click();
  eq('back on the session screen', a.ev('lastRender.name'), 'session');
  ok('logged set survived Back', a.w.document.getElementById('circ-0-0').classList.contains('logged'));
  eq('finisher timer kept its 5 minutes', a.ev('finisherTimer.minutes()'), 5);
  ok('finisher timer shows RESUME', a.w.document.getElementById('finisher-toggle').textContent==='RESUME');
  eq('active is back at the session screen', [a.store('active').screen, a.store('active').finishDraft], ['session', null]);
  ok('nothing saved by going Back', a.store('sessions').length === SEED.sessions.length);
  a.dom.window.close();
}
{
  const a = boot(WED);
  a.w.quickWalk(); answer(a, 4, 4, 4); a.w.startSession();
  a.w.toggleCardioTimer(); a.w.__clockOffset += 12*60000;
  a.ev('finishCardioSession(35)');
  a.w.document.getElementById('finish-back').click();
  eq('cardio Back: timer kept its 12 minutes', a.ev('cardioTimer.minutes()'), 12);
  eq('cardio Back: pick flag kept', a.ev('sessionState.variant.offPlan'), true);
  a.ev('finishCardioSession(35)'); saveWith(a);
  eq('cardio saved after Back with the timer minutes', a.store('sessions').slice(-1)[0].work[0].min, 12);
  a.dom.window.close();
}
{
  const a = boot(WED, emomDoneSeed);
  a.w.resumeActive();
  a.ev('finishEmomSession()');
  a.w.document.getElementById('finish-back').click();
  ok('EMOM Back returns to the done screen with the walk block', !!a.w.document.getElementById('emom-done') && !!a.w.document.getElementById('emom-walk'));
  a.dom.window.close();
}

console.log('\n== Library + version ==');
{
  const a = boot(WED);
  a.ev("Nav.tab('workouts')");
  ok('library shows "This week: Kettlebell EMOM 1"', /This week: Kettlebell EMOM 1/.test(txt(a.w)));
  ok('this week\'s EMOM row is marked', /Kettlebell EMOM 1\s*This week/.test(txt(a.w)));
  // v2.2: older files only check the version is set; the newest test-vXYZ.js checks the exact one.
  ok('APP_VERSION is set', /const APP_VERSION = '\d+\.\d+\.\d+'/.test(HTML));
  a.dom.window.close();
}

console.log('\nv2.1: ' + pass + ' pass, ' + fail + ' fail');
if(fail){ console.log(F.join('\n')); process.exit(1); }
