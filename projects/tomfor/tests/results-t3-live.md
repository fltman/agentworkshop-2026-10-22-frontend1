# T-3: marlin arrive-by (PR 39) live verification (2026-10-22 ~12:55)

node tests/live.test.js, section marlin-arriveBy. No SKIP in the section (only marlin-perf skips, needs PERF=1).

## Result: 13 pass, 9 fail (3 inputs x 3 checks)
Pass: 200, FeatureCollection 6 bands, meta.arriveBy true, meta.deadline echoed with offset, startTime not echoed,
budget/bands, outermost first bandIndex 6..1, nested bands, MultiPolygon, area > 0, depart-at meta.arriveBy not true,
A/B differs from depart-at (stopsReached 1061 vs 917), deadline alias accepted.

## Fault for marlin (sent / expected / got)
POST /t/marlin/isochrone, T-Centralen 09:00 weekday, with arriveBy "false" (string), "yes" or 1
-> expected 400 bad_request with message + message_sv (CONTRACT v1.3: arriveBy is boolean)
-> got 200 with meta.arriveBy true and meta.deadline, i.e. the string "false" runs an arrive-by search.
Likely truthiness coercion. Fix: accept only true/false, else 400.
Not blocking for mareri (its tile sends a real boolean).
