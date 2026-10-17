# WOS app test suite

Headless verification for `index.html`. Requires Node + `jsdom`.

```
npm install jsdom        # from the repo root; local only, not committed
cd test
node wos-test.js
node test-v200.js
node test-v160.js
node test-v210.js
node test-v220.js
```

Config and backup fixtures are read from Joel's OneDrive workout folder
(`.../Cowork/workout/state/`). Point elsewhere with `WOS_DIR=<workout folder>`.
`WOS_HTML` and `WOS_CONFIG` (wos-test only) still override single files.

Baseline (2026-10-16, app v2.2.0): everything passes. Any failure is real.

- `test-v220.js`: 166 pass / 0 fail. Same fixture as v210, clock pinned to
  Wed 2026-09-30 (EMOM day) and Wed 2026-10-07 (an empty week back, for past
  EMOMs). Covers log a past EMOM (fences, defaults, saved record, edit from
  History, first-of-week rule), overnight EMOM + Resume card, the EMOM-done
  walk steps, and the new EMOM timer (clock math, Back/Skip/Pause, 90 s sleep,
  live-only sounds via an `emomSound` stub, Stop → End it, Drop, YELLOW,
  wake lock via a fake API, resume and 2.1.0 `active` conversion).

- `test-v210.js`: 82 pass / 0 fail. Fixture is `wos-backup.json` cut at
  2026-09-29, clock pinned to Wed 2026-09-30 / Thu 2026-10-01. Covers the picker,
  `offPlan`, EMOM of the week, weight→reps pad, EMOM done + walk, finisher vest,
  live-only sounds, and Finish → Back. Its EMOM checks were ported to the v2.2
  timer (same intent; the v2.1 beeps were replaced by the PE sounds).

- `wos-test.js`: 164 pass / 0 fail. Sets are logged with `logSetAs`, which
  sets the weight/reps chips and then taps log, because `logSet` reads the chips.
- `test-v200.js`: 17 pass / 0 fail. Pinned to Monday 2026-08-17 (an EMOM day
  under the 2026-08-31 schedule).
- `test-v160.js`: 26 pass / 0 fail. Its 2026-07-31 fixture is rebuilt from
  `wos-backup.json` (records up to that date) plus `block-1-config.json`.

The older files only check that `APP_VERSION` is set; each build's own
`test-vXYZ.js` checks the exact version.

`wos-test.js` covers the v1.5.x adherence and typed-duration rules, v1.5.0
autosave/resume, exit guards, manual entry, edit/delete replay, and the v1.4.0
regression set (readiness, YELLOW set-drop, RED to recovery, MVS tiers, double
progression, wall-clock timers across device sleep, backup round-trip).

Things this cannot check, because there is no phone in the loop: Android
back-button and `beforeunload` in home-screen app mode, and on-device
vibrate/beep. Those stay a manual on-device pass.
