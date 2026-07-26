/* WOS v1.5.0 verification suite (jsdom).
   Covers the v1.5 features and the v1.4.0 regression set. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(process.env.WOS_HTML, 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(process.env.WOS_CONFIG, 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

const consoleErrors = [];
const netRequests = [];

/* Boot a fresh app instance with a fixed clock and seeded storage. */
function boot(nowISO, seed) {
  const fixedNow = new Date(nowISO).getTime();
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://wos.local/',
    pretendToBeVisual: true,
    resources: undefined, // never fetch subresources
    beforeParse(window) {
      // fixed clock: no-arg Date and Date.now are pinned; arg forms stay real
      const RealDate = window.Date;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(fixedNow); else super(...a); }
        static now() { return window.__clockOffset ? fixedNow + window.__clockOffset : fixedNow; }
      }
      window.__clockOffset = 0;
      window.Date = FakeDate;
      window.confirm = () => true;
      window.alert = () => {};
      window.navigator.vibrate = () => true;
      window.fetch = (u) => { netRequests.push(String(u)); return Promise.reject(new Error('blocked')); };
      window.XMLHttpRequest = function () { netRequests.push('xhr'); this.open = () => {}; this.send = () => {}; };
      window.console.error = (...a) => consoleErrors.push(a.join(' '));
      if (seed) for (const k in seed) window.localStorage.setItem('wos.' + k, JSON.stringify(seed[k]));
    }
  });
  // const/let at script top level are lexical globals, not window properties.
  // Bridge the ones the tests drive. Function declarations are already on window.
  dom.window.eval(`
    window.Nav = Nav; window.Screens = Screens; window.store = store;
    window.cardioTimer = cardioTimer; window.recTimer = recTimer; window.outdoorTimer = outdoorTimer;
    window.BACKFILL_DAYS = BACKFILL_DAYS;
    Object.defineProperty(window,'sessionState',{get:()=>sessionState,set:v=>{sessionState=v},configurable:true});
    Object.defineProperty(window,'readinessAns',{get:()=>readinessAns,set:v=>{readinessAns=v},configurable:true});
    Object.defineProperty(window,'mvsMode',{get:()=>mvsMode,set:v=>{mvsMode=v},configurable:true});
    Object.defineProperty(window,'selectedRPE',{get:()=>selectedRPE,configurable:true});
    Object.defineProperty(window,'restEndAt',{get:()=>restEndAt,configurable:true});
  `);
  return dom;
}
function storeOf(dom, k) {
  const v = dom.window.localStorage.getItem('wos.' + k);
  return v ? JSON.parse(v) : null;
}
function dump(dom) {
  const out = {};
  for (let i = 0; i < dom.window.localStorage.length; i++) {
    const key = dom.window.localStorage.key(i);
    if (key.startsWith('wos.')) out[key.slice(4)] = JSON.parse(dom.window.localStorage.getItem(key));
  }
  return out;
}
/* Visible text only. body.textContent would otherwise include the inline
   <script> source, which contains words like GREEN and Rest and produces
   false matches. */
function txt(dom) {
  const clone = dom.window.document.body.cloneNode(true);
  clone.querySelectorAll('script').forEach(s => s.remove());
  return clone.textContent.replace(/\s+/g, ' ');
}

const MON = '2026-07-27T09:00:00';   // Monday -> strength day
const SUN = '2026-07-26T09:00:00';   // Sunday -> cardio day

/* ---------------------------------------------------------------- */
console.log('\n== 1. Boot, import, replay baseline ==');
{
  const dom = boot(MON);
  const w = dom.window;
  ok('boots without throwing', !!w.document.getElementById('app'));
  w.applyProgramImport(JSON.stringify(CONFIG));
  ok('config imported', !!storeOf(dom, 'config'));
  const lifts = storeOf(dom, 'lifts');
  eq('replay seeds goblet_squat at startWeight', lifts.goblet_squat.weight, 30);
  eq('replay seeds trapbar at startWeight', lifts.trapbar_deadlift.weight, 65);
  ok('no active session at boot', storeOf(dom, 'active') === null);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 2. Autosave during a live session (the reported bug) ==');
let midSessionSeed = null;
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  const btn = w.document.getElementById('start-btn');
  ok('start button enabled after 3 answers', !btn.classList.contains('disabled'));
  ok('start button carries GREEN state', btn.classList.contains('green'));
  w.startSession();
  ok('active written on entering session', storeOf(dom, 'active') !== null);
  w.logSet(0, 0, 30, 10);
  w.logSet(0, 1, 30, 10);
  const a = storeOf(dom, 'active');
  eq('logged sets persisted immediately', a.exercises[0].sets.filter(Boolean).length, 2);
  eq('persisted set values', a.exercises[0].sets[0], { weight: 30, reps: 10 });
  ok('rest timer end persisted', a.restEndAt > 0);
  midSessionSeed = dump(dom);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 3. Refresh mid-session -> resume restores taps ==');
{
  const dom = boot(MON, midSessionSeed);           // simulates a hard refresh
  const w = dom.window;
  ok('Home offers resume', /Session in progress/.test(txt(dom)));
  ok('summary reports logged sets', /2 sets logged/.test(txt(dom)));
  ok('readiness block replaced', !w.document.getElementById('start-btn'));
  w.resumeActive();
  const c00 = w.document.getElementById('circ-0-0');
  const c01 = w.document.getElementById('circ-0-1');
  ok('set 1 still marked logged after refresh', c00 && c00.classList.contains('logged'));
  ok('set 2 still marked logged after refresh', c01 && c01.classList.contains('logged'));
  eq('reps chip restored', w.document.getElementById('rchip-0-0').textContent.trim(), '10');
  eq('in-memory state rehydrated', w.sessionState.exercises[0].sets[1], { weight: 30, reps: 10 });
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 4. Back press raises a guard, and leaving loses nothing ==');
{
  const dom = boot(MON, midSessionSeed);
  const w = dom.window;
  w.resumeActive();
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  ok('guard sheet shown on back', /Leave session\?/.test(txt(dom)));
  const btns = [...w.document.querySelectorAll('.modal-sheet button')];
  const leave = btns.find(b => /LEAVE/.test(b.textContent));
  leave.click();
  ok('back on Home after leaving', /Session in progress/.test(txt(dom)));
  ok('active still intact after leaving', storeOf(dom, 'active') !== null);
  eq('taps survived the exit', storeOf(dom, 'active').exercises[0].sets.filter(Boolean).length, 2);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 5. Finish + save clears active and replays lifts ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 5); w.setReadiness('sore', 5); w.setReadiness('energy', 5);
  w.startSession();
  // config gives 2 sets in weeks 1-2; hit the top of the range on both
  w.logSet(0, 0, 30, 12); w.logSet(0, 1, 30, 12);
  w.finishStrengthSession();
  w.setRPE(6);
  w.saveSession(47);
  const sessions = storeOf(dom, 'sessions');
  eq('one session saved', sessions.length, 1);
  eq('slot recorded', sessions[0].slot, 'A');
  ok('not flagged manual', !sessions[0].manual);
  ok('active cleared on save', storeOf(dom, 'active') === null);
  eq('double progression advanced 30 -> 40', storeOf(dom, 'lifts').goblet_squat.weight, 40);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 6. Duration-based lift no longer auto-advances (the repHi:null bug) ==');
{
  // farmer_carry: repHi null, durationSec 30, increment 10, start 35
  const under = [{ date: '2026-07-20', slot: 'A', readiness: null, min: 40, rpe: 6,
    work: [{ ex: 'farmer_carry', target: '', sets: [[35, 20], [35, 20]] }] }];
  const domU = boot(MON, { config: CONFIG, sessions: under });
  domU.window.recomputeLifts();
  eq('short carries do NOT add load', storeOf(domU, 'lifts').farmer_carry.weight, 35);
  domU.window.close();

  const met = [{ date: '2026-07-20', slot: 'A', readiness: null, min: 40, rpe: 6,
    work: [{ ex: 'farmer_carry', target: '', sets: [[35, 30], [35, 30]] }] }];
  const domM = boot(MON, { config: CONFIG, sessions: met });
  domM.window.recomputeLifts();
  eq('carries at target DO add load', storeOf(domM, 'lifts').farmer_carry.weight, 45);
  domM.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 7. A/B sequencing follows dates, not array order ==');
{
  const outOfOrder = [
    { date: '2026-07-24', slot: 'B', readiness: null, min: 40, rpe: 6, work: [] }, // pushed first
    { date: '2026-07-22', slot: 'A', readiness: null, min: 40, rpe: 6, work: [] }  // backfilled later
  ];
  const dom = boot(MON, { config: CONFIG, sessions: outOfOrder });
  const w = dom.window;
  eq('latest strength by date is B', w.lastStrengthLetter(), 'B');
  eq('next letter is A', w.nextStrengthLetter(), 'A');
  eq('letter for a date before 07-24 is B', w.nextStrengthLetter('2026-07-23'), 'B');
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 8. Manual entry fences ==');
{
  const existing = [{ date: '2026-07-25', slot: 'C', readiness: null, min: 30, rpe: 4, work: [{ mode: 'bike', min: 30 }] }];
  const dom = boot(MON, { config: CONFIG, sessions: existing });
  const w = dom.window;
  w.Nav.toManual({});
  const t = txt(dom);
  ok('offers a 7-day window', /Last 7 days only/.test(t));
  ok('occupied date marked already logged', /already logged \(C\)/.test(t));
  const disabled = [...w.document.querySelectorAll('.pill-btn.disabled')];
  ok('occupied date button disabled', disabled.some(b => /already logged/.test(b.textContent)));
  const enabled = [...w.document.querySelectorAll('.pill-btn.ghost')].filter(b => b.getAttribute('onclick'));
  const dates = enabled.map(b => (b.getAttribute('onclick').match(/'([\d-]+)'/) || [])[1]).filter(Boolean);
  const oldest = dates.sort()[0];
  eq('oldest offered date is exactly 7 days back', oldest, '2026-07-20');
  ok('nothing older than 7 days offered', !dates.some(d => d < '2026-07-20'));
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 9. Manual backfill lands, counts, and is flagged ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.toManual({});
  w.manualPickDate('2026-07-24');
  w.manualPickSlot('A');
  w.manualProceed(true);                    // "don't remember"
  ok('manual strength session opened', !!w.document.getElementById('circ-0-0'));
  w.logSet(0, 0, 30, 12); w.logSet(0, 1, 30, 12);
  w.finishStrengthSession();
  ok('finish screen offers editable duration', !!w.document.getElementById('finish-min'));
  ok('manual banner shown', /Marked as a manual entry/.test(txt(dom)));
  w.setRPE(6);
  w.document.getElementById('finish-min').value = '52';
  w.saveSession(45);
  const s = storeOf(dom, 'sessions')[0];
  eq('backfilled to the chosen date', s.date, '2026-07-24');
  eq('flagged manual', s.manual, true);
  eq('readiness recorded as unknown, not invented', s.readiness, null);
  eq('typed duration honoured', s.min, 52);
  eq('manual work feeds progression', storeOf(dom, 'lifts').goblet_squat.weight, 40);
  eq('counts toward streak', w.currentStreak() >= 0, true);
  dom.window.close();
}

const tick = () => new Promise(r => setTimeout(r, 10));

(async function main() {

/* ---------------------------------------------------------------- */
console.log('\n== 10. Edit a saved session -> replay corrects lift state ==');
{
  const seeded = [{ date: '2026-07-24', slot: 'A', readiness: null, min: 45, rpe: 6,
    work: [{ ex: 'goblet_squat', target: '2x8-12@30', sets: [[30, 12], [30, 12]] }] }];
  const dom = boot(MON, { config: CONFIG, sessions: seeded });
  const w = dom.window;
  w.recomputeLifts();
  eq('before edit, lift advanced to 40', storeOf(dom, 'lifts').goblet_squat.weight, 40);

  w.Nav.toManual({ editingIndex: 0 });
  await tick();                                     // renderManualForEdit defers by a tick
  ok('edit opens the session screen', !!w.document.getElementById('circ-0-0'));
  // correct the record: it was really 8 reps, not 12 -> must not advance
  w.logSet(0, 0, 30, 8); w.logSet(0, 1, 30, 8);
  w.finishStrengthSession();
  w.setRPE(6);
  w.saveSession(45);
  const sessions = storeOf(dom, 'sessions');
  eq('edit replaced, did not append', sessions.length, 1);
  eq('corrected reps stored', sessions[0].work[0].sets, [[30, 8], [30, 8]]);
  eq('edited record flagged manual', sessions[0].manual, true);
  eq('replay walked the lift back to 30', storeOf(dom, 'lifts').goblet_squat.weight, 30);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 11. Delete a session -> replay + counts correct ==');
{
  const seeded = [
    { date: '2026-07-22', slot: 'A', readiness: null, min: 45, rpe: 6,
      work: [{ ex: 'goblet_squat', target: '', sets: [[30, 12], [30, 12]] }] },
    { date: '2026-07-24', slot: 'B', readiness: null, min: 45, rpe: 6,
      work: [{ ex: 'trapbar_deadlift', target: '', sets: [[65, 12], [65, 12]] }] }
  ];
  const dom = boot(MON, { config: CONFIG, sessions: seeded });
  const w = dom.window;
  w.recomputeLifts();
  eq('both lifts advanced', [storeOf(dom, 'lifts').goblet_squat.weight, storeOf(dom, 'lifts').trapbar_deadlift.weight], [40, 75]);
  w.Nav.toHistory();
  ok('history lists both sessions', /July 22/.test(txt(dom)) && /July 24/.test(txt(dom)));
  w.deleteSession(0);
  const btns = [...w.document.querySelectorAll('.modal-sheet button')];
  btns.find(b => /DELETE/.test(b.textContent)).click();
  eq('one session remains', storeOf(dom, 'sessions').length, 1);
  eq('deleted lift reset to startWeight', storeOf(dom, 'lifts').goblet_squat.weight, 30);
  eq('surviving lift unchanged', storeOf(dom, 'lifts').trapbar_deadlift.weight, 75);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 12. Consistency denominator computed from schedule ==');
{
  const dom = boot(MON, { config: CONFIG, meta: { startDate: '2026-06-01', appVersion: '1.5.0', lastBackup: null } });
  const w = dom.window;
  // schedule is 6 training days/week -> 28 days trailing = 24
  eq('28-day scheduled count from schedule', w.scheduledCountLast28(), 24);
  ok('denominator is not the old literal path', w.renderProgress().includes('of 24 scheduled'));
  dom.window.close();

  // a start date inside the window must shrink the denominator, not report 24
  const dom2 = boot(MON, { config: CONFIG, meta: { startDate: '2026-07-20', appVersion: '1.5.0', lastBackup: null } });
  ok('partial history reports honestly', dom2.window.scheduledCountLast28() < 24);
  dom2.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 13. Readiness regressions (YELLOW / RED) ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  eq('GREEN at 12', w.computeReadiness(4, 4, 4).state, 'GREEN');
  eq('YELLOW at 9', w.computeReadiness(3, 3, 3).state, 'YELLOW');
  eq('RED at 6', w.computeReadiness(2, 2, 2).state, 'RED');
  eq('a single 1 downgrades GREEN to YELLOW', w.computeReadiness(1, 5, 5).state, 'YELLOW');
  eq('soreness 1 forces RED', w.computeReadiness(5, 1, 5).state, 'RED');

  // YELLOW drops the last set of every exercise
  w.Nav.home();
  w.setReadiness('sleep', 3); w.setReadiness('sore', 3); w.setReadiness('energy', 3);
  w.startSession();
  const rows = w.document.querySelectorAll('.ex-card')[0].querySelectorAll('.set-row');
  eq('YELLOW renders one fewer set (2 -> 1)', rows.length, 1);
  eq('YELLOW drops a set on every exercise, not just the first', w.document.querySelectorAll('.set-row').length, 4);
  ok('YELLOW badge shown, GREEN not offered', /YELLOW — modified/.test(txt(dom)) && !/GREEN/.test(txt(dom)));
  dom.window.close();
}
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 5); w.setReadiness('sore', 1); w.setReadiness('energy', 5);
  w.startSession();
  ok('soreness 1 routes to Recovery, never a skip', /RED — recovery session/.test(txt(dom)));
  ok('no strength rows rendered on RED', !w.document.getElementById('circ-0-0'));
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 14. Recovery + MVS tap state survives a refresh ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 5); w.setReadiness('sore', 1); w.setReadiness('energy', 5);
  w.startSession();
  const circles = w.document.querySelectorAll('.tap-circle');
  w.toggleRecCheck(0, circles[0]);
  w.toggleRecCheck(2, circles[2]);
  const seed = dump(dom);
  eq('mobility ticks persisted to storage', storeOf(dom, 'active').recChecks, [true, false, true, false, false]);
  dom.window.close();

  const dom2 = boot(MON, seed);
  dom2.window.resumeActive();
  const c2 = dom2.window.document.querySelectorAll('.tap-circle');
  ok('mobility tick 1 restored', c2[0].classList.contains('logged'));
  ok('mobility tick 3 restored', c2[2].classList.contains('logged'));
  ok('untouched tick still clear', !c2[1].classList.contains('logged'));
  dom2.window.close();
}
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.mvsMode = true;
  w.startSession();
  ok('no-gym routes to the MVS picker', /Pick a minimum session/.test(txt(dom)));
  w.pickMvs('gym');
  w.logMvsSet(0, 0);
  const seed = dump(dom);
  eq('MVS tap persisted', storeOf(dom, 'active').mvsItems[0].logged[0], true);
  dom.window.close();

  const dom2 = boot(MON, seed);
  dom2.window.resumeActive();
  ok('MVS tap restored after refresh', dom2.window.document.getElementById('mcirc-0-0').classList.contains('logged'));
  dom2.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 15. MVS logs slot/mvsType and counts like any session ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.mvsMode = true;
  w.startSession();
  w.pickMvs('outdoor');
  w.finishMvsOutdoor();
  w.setRPE(4);
  w.saveSession(20);
  const s = storeOf(dom, 'sessions')[0];
  eq('slot is MVS', s.slot, 'MVS');
  eq('mvsType outdoor', s.mvsType, 'outdoor');
  ok('outdoor carries no work array', !s.work);
  eq('counts toward the streak', w.currentStreak(), 1);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 16. Wall-clock timers survive a simulated device sleep ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.mvsMode = true;
  w.startSession();
  w.pickMvs('outdoor');
  w.toggleOutdoorTimer();                 // start
  w.__clockOffset = 90 * 1000;            // phone sleeps 90 s; setInterval never fires
  eq('elapsed reflects wall clock, not ticks', w.outdoorTimer.elapsedSec(), 90);
  w.refreshTimers();
  eq('display snapped on wake', w.document.getElementById('outdoor-timer').textContent, '01:30');
  w.__clockOffset = 21 * 60 * 1000;
  w.finishMvsOutdoor();
  w.setRPE(4);
  w.saveSession(21);
  eq('logged minutes are wall-clock', storeOf(dom, 'sessions')[0].min, 21);
  dom.window.close();
}
{
  // a rest countdown that expires while the phone is asleep must not beep late
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.startSession();
  w.logSet(0, 0, 30, 10);
  ok('rest timer visible', /Rest/.test(txt(dom)));
  w.__clockOffset = 120 * 1000;           // long sleep, rest ended during it
  let vibrated = false;
  w.navigator.vibrate = () => { vibrated = true; return true; };
  w.renderRestTimer();
  ok('no stale vibrate after a long sleep', !vibrated);
  ok('rest timer cleared on wake', !/Rest/.test(txt(dom)));
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 17. Stale session from a previous day is offered, not dropped ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.startSession();
  w.logSet(0, 0, 30, 10);
  const seed = dump(dom);
  dom.window.close();

  // reopen the next day
  const dom2 = boot('2026-07-28T09:00:00', seed);
  const w2 = dom2.window;
  ok('stale session prompt shown', /Unfinished session from 2026-07-27/.test(txt(dom2)));
  ok('offers to log it', /FINISH & LOG IT/.test(txt(dom2)));
  ok('active not silently discarded', storeOf(dom2, 'active') !== null);
  const btns = [...w2.document.querySelectorAll('.modal-sheet button')];
  btns.find(b => /FINISH/.test(b.textContent)).click();
  w2.setRPE(6);
  w2.saveSession(40);
  const s = storeOf(dom2, 'sessions')[0];
  eq('logged under the day it happened', s.date, '2026-07-27');
  eq('the logged set survived overnight', s.work[0].sets, [[30, 10]]);
  ok('active cleared after logging', storeOf(dom2, 'active') === null);
  dom2.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 18. Backup -> wipe -> restore round-trip ==');
{
  const seeded = [{ date: '2026-07-24', slot: 'A', readiness: null, min: 45, rpe: 6, manual: true,
    work: [{ ex: 'goblet_squat', target: '', sets: [[30, 12], [30, 12]] }] }];
  const dom = boot(MON, { config: CONFIG, sessions: seeded, daily: [{ date: '2026-07-24', bw: 200.4 }] });
  const w = dom.window;
  w.recomputeLifts();
  const backup = {
    config: storeOf(dom, 'config'), lifts: storeOf(dom, 'lifts'), sessions: storeOf(dom, 'sessions'),
    daily: storeOf(dom, 'daily'), weekly: storeOf(dom, 'weekly'), meta: storeOf(dom, 'meta'),
    appVersion: '1.5.0', exportDate: '2026-07-27'
  };
  const before = { sessions: backup.sessions, lifts: backup.lifts, daily: backup.daily };
  dom.window.close();

  const dom2 = boot(MON);
  dom2.window.applyRestore(JSON.stringify(backup));
  eq('sessions restored', storeOf(dom2, 'sessions'), before.sessions);
  eq('daily restored', storeOf(dom2, 'daily'), before.daily);
  eq('lifts rebuilt identically from the log', storeOf(dom2, 'lifts'), before.lifts);
  eq('manual flag survives the round-trip', storeOf(dom2, 'sessions')[0].manual, true);
  ok('restore does not inherit a stale active session', storeOf(dom2, 'active') === null);
  dom2.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 19. Stale readiness cleared on return to Home (backlog item) ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.startSession();
  w.finishStrengthSession();
  w.setRPE(6);
  w.saveSession(40);
  eq('readiness answers reset after a session', w.readinessAns, { sleep: null, sore: null, energy: null });
  const btn = w.document.getElementById('start-btn');
  ok('Start is disabled again on Home', btn.classList.contains('disabled'));
  ok('Start carries no stale state colour', !btn.classList.contains('green'));
  eq('Start label reset', btn.textContent.trim(), 'START');
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 20. Edit pre-fills the record instead of blanking it ==');
{
  const seeded = [{ date: '2026-07-24', slot: 'A', readiness: { sleep:3,sore:3,energy:3,score:9,state:'YELLOW' },
    min: 45, rpe: 6, note: 'felt heavy',
    work: [{ ex: 'goblet_squat', target: '', sets: [[35, 9], [35, 8]] }] }];
  const dom = boot(MON, { config: CONFIG, sessions: seeded });
  const w = dom.window;
  w.Nav.toManual({ editingIndex: 0 });
  await tick();
  eq('logged weight pre-filled', w.document.getElementById('wchip-0-0').textContent.trim(), '35');
  eq('logged reps pre-filled set 1', w.document.getElementById('rchip-0-0').textContent.trim(), '9');
  eq('logged reps pre-filled set 2', w.document.getElementById('rchip-0-1').textContent.trim(), '8');
  ok('pre-filled sets show as logged', w.document.getElementById('circ-0-0').classList.contains('logged'));
  eq('edit exposes the full set count, not the YELLOW-reduced one',
     w.document.querySelectorAll('.ex-card')[0].querySelectorAll('.set-row').length, 2);
  // change one rep and save; everything else must survive untouched
  w.logSet(0, 1, 35, 10);
  w.finishStrengthSession();
  w.setRPE(7);
  w.saveSession(45);
  const s = storeOf(dom, 'sessions')[0];
  eq('only the edited value changed', s.work[0].sets, [[35, 9], [35, 10]]);
  eq('date preserved through edit', s.date, '2026-07-24');
  eq('readiness preserved through edit', s.readiness.state, 'YELLOW');
  eq('still one record', storeOf(dom, 'sessions').length, 1);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 21. Editing cardio keeps its mode and duration ==');
{
  const seeded = [{ date: '2026-07-24', slot: 'C', readiness: null, min: 42, rpe: 4, note: '',
    work: [{ mode: 'rower', min: 42 }] }];
  const dom = boot(MON, { config: CONFIG, sessions: seeded });
  const w = dom.window;
  w.Nav.toManual({ editingIndex: 0 });
  await tick();
  eq('mode pre-selected, not reset to the first option',
     w.document.getElementById('cardio-mode').value, 'rower');
  w.finishCardioSession(35);
  w.setRPE(4);
  w.saveSession(42);
  const s = storeOf(dom, 'sessions')[0];
  eq('mode survives an edit', s.work[0].mode, 'rower');
  eq('duration survives an edit', s.min, 42);
  eq('no duplicate record', storeOf(dom, 'sessions').length, 1);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 22. Timer state cannot leak between sessions ==');
{
  const dom = boot(MON, { config: CONFIG });
  const w = dom.window;
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.mvsMode = true; w.startSession(); w.pickMvs('outdoor');
  w.toggleOutdoorTimer();
  w.__clockOffset = 15 * 60 * 1000;
  w.finishMvsOutdoor(); w.setRPE(4); w.saveSession(15);
  eq('first session logged 15 min', storeOf(dom, 'sessions')[0].min, 15);
  // a second outdoor session must start from zero, not inherit 15 minutes
  w.Nav.home();
  w.setReadiness('sleep', 4); w.setReadiness('sore', 4); w.setReadiness('energy', 4);
  w.mvsMode = true; w.startSession(); w.pickMvs('outdoor');
  eq('timer reset for the next session', w.outdoorTimer.elapsedSec(), 0);
  dom.window.close();
}

/* ---------------------------------------------------------------- */
console.log('\n== 23. Hygiene ==');
{
  eq('no console errors across the suite', consoleErrors, []);
  eq('zero network requests after load', netRequests, []);
  const html = HTML;
  ok('APP_VERSION bumped to 1.5.0', /const APP_VERSION = '1\.5\.0'/.test(html));
  ok('no webfonts or CDN links', !/https?:\/\/(fonts|cdn)/i.test(html));
  ok('no leftover manual-min references', !/manual-min/.test(html));
}

console.log('\n================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(' - ' + f)); }
console.log('================================\n');
process.exit(fail ? 1 : 0);

})();
