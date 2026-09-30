# WOS app test suite

Headless verification for `index.html`. Requires Node + `jsdom`.

```
npm install jsdom        # from the repo root; local only, not committed
cd test
node wos-test.js
node test-v200.js
node test-v160.js
```

Config and backup fixtures are read from Joel's OneDrive workout folder
(`.../Cowork/workout/state/`). Point elsewhere with `WOS_DIR=<workout folder>`.
`WOS_HTML` and `WOS_CONFIG` (wos-test only) still override single files.

Baseline (2026-09-30, app v2.0.0): everything passes. Any failure is real.

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
