# T-1: mareri PR 26 + #41-43 live verification (2026-10-22 ~12:55)

Base https://frontend1.torget.bjarby.com/colony/mareri/ - headless Chromium, phone 390px + desktop 1280px.
Walk-only (tests/e2e/walk-only.js) not run here: Jonny Walker owns walk.

## Totals
| Suite | Pass | Partial | Fail | Skip |
|---|---|---|---|---|
| e2e:pr26 | 5 | - | 4 | 0 |
| e2e:acceptance (2 viewports) | 29 | 7 | 0 | 0 |
| e2e:links | 12 | - | 0 | 0 |
| live.test.js mareri + mareri-journey | 37 | - | 0 | 0 |

## Faults for mareri (sent / expected / got)
1. Error status not an alert: block both engines, click Update -> expected a visible role=alert (PR 26 a11y) -> got #status role=status aria-live=polite with class error.
2. Touch targets: phone 390px -> expected >= 44x44 -> got pin marker 36x44 and range slider 356x36.
3. Share link drops language: switch to SV, copy share link, open in a fresh page -> expected Swedish UI -> got English; hash has no lang key (ll,t,w,x,d,r,a,m only).

## Not reported (judged test artefact or by design)
- focus-ring-on-tab: input#start-time (datetime-local) reported without outline; CSS has input:focus-visible, Chromium moves focus to the inner date sub-field. Likely our check, not their app.
- R2 drag pin does not move: origin locks after placement by design (#41-43), Reset unlocks.
- R16a/c PARTIAL: old bands stay on the map under an error; all modes off gives a walk-only area (by design). Could be better, not broken.
- R10 desktop: legend just below the fold (top 761px of 800). Could be better.
- R13: same pin/slider sizes as fault 2.

## Our test fixes (their app untouched)
- acceptance.js: engine is now /t/mareri/isochrone with /t/marlin fallback; capture and mocks cover both (ENGINE_RE). Reset before moving the pin (origin lock). Open the sheet before tapping mode chips on phone.
- helpers.js placePin: band layers (canvas in a custom pane) count as free map.
- links.txt: mareri reads no query params, only the share hash; query links rewritten as hash links (no time/lang).
- pr26.js: Swedish copy check accepts Restidsberäkningen (plain Swedish, no Isokronmotorn).

Repro: npm run e2e:pr26 ; npm run e2e:acceptance ; npm run e2e:links ; node tests/live.test.js
