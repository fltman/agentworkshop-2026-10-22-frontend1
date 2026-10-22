# Review check: T-1, T-4, T-7 on live /colony/mareri/ (2026-10-22 13:10)

Browser: headless Chromium (Playwright), desktop 1280x800 and phone 390x844 (touch).
Repro: `npm run e2e:review` (T-4, T-7; json tests/e2e/review-run.json) and `npm run e2e:pr26` (T-1; tests/e2e/pr26-run.json).

**Verdict: none of the three changes is live yet.** mareri PR 46 (arrive-by + T-1/T-4/T-7 fixes per #build 493/505/510)
is still open; live app.js still has `originLocked` and no `maxBounds`. No board posts made; rerun after the next release.

| Task | Live? | Result | Evidence |
|------|-------|--------|----------|
| T-4 origin lock dropped | no | SKIP x3 per viewport | second click/tap, pin drag (marker has no draggable class) and click-after-drag all leave the pin at 59.33126,18.05929 |
| T-4 double click only zooms | (already true) | PASS desktop + phone | zoom 13 -> 14, pin unchanged |
| T-7 Stockholm maxBounds/minZoom | no | SKIP x2 per viewport | maxBounds none, minZoom none; zoom-out button x10 -> z4; panTo Paris -> centre 48.865,2.373 |
| T-1 role=alert | no | FAIL (pending deploy) | #status is role=status polite |
| T-1 44px targets (phone) | no | FAIL (pending deploy) | pin 36x44, range slider 356x36 |
| T-1 share link language | no | FAIL (pending deploy) | hash has no lang key, fresh page opens EN |
| (extra, not a T-1 fault) focus ring | - | FAIL | input#start-time has no outline/box-shadow on Tab |

pr26 totals: 5 pass, 4 fail (same as the T-1 report, results-t1-live.md).

## What the new checks do (tests/e2e/review.js)
- T-4: place pin at T-Centralen, then click/tap a free map spot -> pin must move there (within 0.003 deg) without Reset;
  drag the pin +60,+40 px -> must move; click again after the drag -> must move; double click/tap -> zoom +1, pin unchanged.
- T-7: read map.options (maxBounds, minZoom >= 8), press zoom-out x10 and setZoom(minZoom-1) -> zoom stays >= minZoom;
  4 large drags plus panTo(Paris) -> centre must stay in 58.7-60.4 N, 16.9-19.5 E.
- Live gate: T-4 = app.js no longer locks the origin; T-7 = map has maxBounds or minZoom. Not live -> SKIP with observations.

acceptance.js still uses the Reset workaround in movePin (kept until T-4 is live).
