# WOS App: Claude Code instructions

This repo is the Workout Operating System (WOS) phone app: one file, `index.html`. Vanilla HTML/CSS/JS, no framework, no build step, no network calls after load. Joel opens it on Android Chrome from his hosting and adds it to the home screen.

Joel is not a developer. Plain words, short answers, no jargon without a one-line definition.

## Where the specs live (not in this repo)

The master specs stay in Joel's OneDrive workout folder, which is added to this session as an extra directory:
`C:\Users\JoelTerrell\OneDrive - Terrell World\Documents\Cowork\workout`

- `system/ui-design.md`: the app contract. Build exactly this.
- `system/style-template.md`: visual rules.
- `system/system-design.md`: training rules the app enforces (readiness, RED → recovery, YELLOW rules, progression). Read only; never change it from here.
- `prds/`: PRDs. The current one is `prds/DRAFT-app-v2.1-choose-workout-emom-week.md`.
- `state/decisions.md`: dated log of every change, with the why.
- `state/wos-backup.json`: latest real backup from Joel's phone. Use it as a test fixture. Never edit it.

Do not copy these files into the repo. One master copy each.

## Rules

1. PRD first. No behavior change without a PRD Joel has approved.
2. Contract before code: update `ui-design.md` first, then `index.html`, in the same session.
3. Bump `APP_VERSION` in `index.html` on every build.
4. Scope-fence: change what was asked. Flag anything else you notice; do not fix it unasked.
5. Must not change: readiness before every session; RED always routes to recovery; `sessions` is the single source of truth and `lifts` is rebuilt from it; autosave to `active` on every tap; timers anchored to wall-clock time; backup and restore lose nothing; old session records are never rewritten.
6. Test every build: `npm install jsdom` (local only, not committed), then from `test/` run `node <file>` for every file in `test/`. Tests read fixtures from the workout folder by default (override with `WOS_DIR`). Baseline checked 2026-10-16 on v2.2.0:
   - `test/wos-test.js`: 164 pass / 0 fail.
   - `test/test-v200.js`: 17 pass / 0 fail.
   - `test/test-v160.js`: 26 pass / 0 fail.
   - `test/test-v210.js`: 82 pass / 0 fail.
   - `test/test-v220.js`: 166 pass / 0 fail.
   Details in `test/README.md`. Every build must keep all tests at zero failures. Add a test file per build (`test/test-vXYZ.js`).
7. Record each build in `state/decisions.md`: dated, what changed, why, test results, what is still unverified on the phone.
8. Commit when a build passes. Push only when Joel says; pushing is what deploys to his phone.
9. On-device checks (beeps, vibrate, Android back button, home-screen app mode) cannot be tested here. List them for Joel after each build.
