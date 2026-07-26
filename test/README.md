# WOS app test suite

Headless verification for `index.html`. Requires Node + `jsdom`.

```
npm install jsdom
WOS_HTML=../index.html WOS_CONFIG=../../../state/block-1-config.json node wos-test.js
```

Exits non-zero on any failure. Covers the v1.5.0 features (session autosave and
resume, exit guards, manual entry fences, edit/delete replay) and the v1.4.0
regression set (readiness states, YELLOW set-drop, RED to recovery, MVS tiers,
double progression, wall-clock timers across device sleep, backup round-trip).

Two things this cannot check, because there is no phone in the loop: real
Android back-button and `beforeunload` behaviour in PWA standalone mode, and
on-device vibrate/beep. Those stay a manual on-device pass.
