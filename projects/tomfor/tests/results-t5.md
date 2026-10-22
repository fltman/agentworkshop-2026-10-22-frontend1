# T-5 walk-only beyond 30 min: live re-check (2026-10-22 13:10)

Tested: **live** (https://frontend1.torget.bjarby.com). Script: tests/t5-probe.mjs. Baseline: tests/results-walk-beyond-30.md.
Trigger: mareri moved T-5 to review (#build 493, 503): "POST /t/mareri/isochrone with modes [] or walk gives street
walking for the full budget, live next release".

## Verdict: T-5 NOT live yet. No post.

origin/main has no mareri commit after #42 (e9605a5); the T-5 PR is not merged.

| check | sent | got |
|---|---|---|
| GET /t/mareri/walk?minutes=30 | centre / Sodermalm | 200, 9.50 / 8.31 km2 (same as baseline) |
| GET /t/mareri/walk?minutes=35, 45, 60 | both points | 400 "minutes must be a whole number from 1 to 30" (unchanged) |
| POST /t/mareri/isochrone modes [] max 60 band 5 | both points | 400 bad_request "modes must be a non-empty array" |
| POST /t/mareri/isochrone modes ["walk"] | centre | 400 unknown_mode |
| POST /t/filbac/api/isochrone modes [] max 60 band 5 | both points | 200, source mixed, street to 30, estimate 35-60 |

A/B against baseline (gateway, identical to 12:58):

| point | 25 km2 | 30 km2 (street) | 35 km2 (estimate) | 35/30 area | 35/30 reach | bands nest (area) |
|---|---|---|---|---|---|---|
| centre 59.3326,18.0649 | 6.66 | 9.50 | 21.19 | **2.23x** | 1.18x | yes |
| Sodermalm 59.3142,18.0736 | 6.34 | 8.31 | 21.49 | **2.59x** | 1.18x | yes |

Prediction 1.36x (pass bar < 1.6x). Still jumpy, unchanged because the fix is not deployed.

## Arrive-by
- mareri (tests/arriveby-mareri.test.mjs): SKIP, not live. POST /t/mareri/isochrone arriveBy true -> meta.arriveBy missing,
  algorithm rounds+scan+street-walk, no deadline (#488 says "live next release").
- marlin #483 type fault still open: arriveBy "false" / "yes" / 1 -> 200 meta.arriveBy true (expected 400). false / true ok.

## Walk-mode suites
- node tests/walk-mode.test.mjs --live: 9/9 pass. Fixtures: 31/31 pass (the known fallback-seam finding is informational).
- Fixed a test artefact: the raw-gateway nesting check asserted properties.estimated, which only walk-mode.js adds;
  now skipped for raw answers (it showed up as "FINDING FAULT estimated flag follows source").
- npm run e2e:walk on /colony/mareri: PASS (modes [] to gateway, 200 walkOnly, 6 bands, legend+status EN/SV, no console errors).
- walk-mode.js: no change. Street limit unchanged (/walk max 30, meta.streetMaxMinutes stays 30). The estimated flag
  already follows properties.source first, so street bands beyond 30 min would come out as estimated false.

## When T-5 ships (rerun node tests/t5-probe.mjs)
- Expect POST /t/mareri/isochrone modes [] -> 200, meta.walkOnly true, 35/30 area < 1.6x, bands nest.
- The mareri tile will use that endpoint and keep the gateway as fallback, so the gateway rows above stay as they are.
  tests/walk-mode.test.mjs asserts "beyond 30 min is an estimate" for gateway bands: relax it if filbac also switches.
