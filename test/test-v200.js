/* WOS v2.0 verification (jsdom).
   Covers the v2.0 additions: schema migration, workouts library, exercise links,
   notes, warmup-in-session + steps schema, and the native kettlebell EMOM
   session type (schedule 'K' routing, rotation, YELLOW rounds, finish record).
   Run:  node test-v200.js
   (reads ../index.html and <WOS_DIR>/state/block-2-config.json) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Specs live in Joel's OneDrive workout folder, not this repo. Override with WOS_DIR.
const WOS_DIR = process.env.WOS_DIR || 'C:/Users/JoelTerrell/OneDrive - Terrell World/Documents/Cowork/workout';
const HTML = fs.readFileSync(process.env.WOS_HTML || path.join(__dirname, '../index.html'), 'utf8');
const _raw = JSON.parse(fs.readFileSync(path.join(WOS_DIR, 'state/block-2-config.json'), 'utf8'));
const CFG = _raw.config || _raw;   // block-2-config is now a raw config (no wrapper)
// A Monday. Since 2026-08-31 the block-2 schedule runs EMOM ('K') Mon/Wed/Fri;
// Tuesday is now strength, which is why the old Tuesday date crashed finishEmomSession.
const fixed = new Date('2026-08-17T12:00:00').getTime();

let pass = 0, fail = 0; const F = [];
function ok(n, c, d){ if(c){ pass++; console.log('  PASS  '+n); } else { fail++; F.push(n+(d!==undefined?(' :: got '+JSON.stringify(d)):'')); console.log('  FAIL  '+n+(d!==undefined?(' :: got '+JSON.stringify(d)):'')); } }

const dom = new JSDOM(HTML, { runScripts:'dangerously', url:'https://wos.local/', pretendToBeVisual:true,
  beforeParse(w){ const RD=w.Date; class FD extends RD{ constructor(...a){ if(!a.length) super(fixed); else super(...a);} static now(){ return fixed; } } w.Date=FD; w.confirm=()=>true; w.alert=()=>{}; w.prompt=()=>'https://example.com/v'; w.navigator.vibrate=()=>true; } });
const w = dom.window;

const code = `
  var out = {};
  store.set('config', ${JSON.stringify(CFG)}); recomputeLifts(); migrateV20();
  var cfg = store.get('config');
  out.url = cfg.workouts.A[0].url;                 // migration seeds null
  out.emomLen = cfg.emom.workouts.length;
  out.lib = renderWorkouts();
  out.det = renderWorkoutDetail({id:'E:E1'});
  out.home = renderHome();                          // Tuesday -> EMOM label
  out.nextE = nextEmomId();
  // notes
  document.getElementById('app').innerHTML = renderNotes();
  document.getElementById('note-input').value = 'test note';
  addNote(); out.notes1 = (store.get('notes')||[]).length;
  var nid = (store.get('notes')||[])[0].id; deleteNote(nid); out.notes0 = (store.get('notes')||[]).length;
  // link edit persists to config
  editVideo('goblet_squat'); out.editedUrl = locateEx(store.get('config'),'goblet_squat').url;
  // EMOM flow via the real Start path
  readinessAns = {sleep:5, sore:5, energy:5};
  startSession();
  out.kind = sessionState && sessionState.variant && sessionState.variant.kind;
  out.rounds = sessionState && sessionState.emom ? sessionState.emom.rounds : null;
  finishEmomSession();
  out.finishSlot = finishDraft && finishDraft.slot;
  out.finishEmomId = finishDraft && finishDraft.emomId;
  // YELLOW EMOM drops to 2 rounds
  sessionState = null;
  readinessAns = {sleep:3, sore:3, energy:3};       // score 9 -> YELLOW
  startSession();
  out.yState = sessionState.variant.readiness.state;
  out.yRounds = sessionState.emom.rounds;
  window.__res = JSON.stringify(out);
`;
w.eval(code);
const o = JSON.parse(w.__res);

console.log('\n== v2.0 features ==');
ok('migration seeds exercise url = null', o.url === null, o.url);
ok('EMOM config preserved (4 workouts)', o.emomLen === 4, o.emomLen);
ok('workouts library lists Workout A', /Workout A/.test(o.lib));
ok('workouts library lists Kettlebell EMOM 1', /Kettlebell EMOM 1/.test(o.lib));
ok('workout detail lists a move', /Halo into rotational swing/.test(o.det));
ok('workout detail exposes video buttons', /openVideo/.test(o.det));
ok('workout detail shows History', /History/.test(o.det));
ok('Home on a K day shows EMOM label', /Kettlebell EMOM/.test(o.home));
ok('EMOM rotation starts at E1', o.nextE === 'E1', o.nextE);
ok('note add then delete', o.notes1 === 1 && o.notes0 === 0, [o.notes1, o.notes0]);
ok('edited video link persists to config', o.editedUrl === 'https://example.com/v', o.editedUrl);
ok('K day routes to EMOM session', o.kind === 'EMOM', o.kind);
ok('GREEN EMOM = 3 rounds', o.rounds === 3, o.rounds);
ok('EMOM finish logs slot EMOM', o.finishSlot === 'EMOM', o.finishSlot);
ok('EMOM finish carries emomId', o.finishEmomId === 'E1', o.finishEmomId);
ok('YELLOW readiness computed', o.yState === 'YELLOW', o.yState);
ok('YELLOW EMOM drops to 2 rounds', o.yRounds === 2, o.yRounds);

console.log('\nv2.0: ' + pass + ' pass, ' + fail + ' fail');
if(fail){ console.log(F.join('\n')); process.exit(1); }
