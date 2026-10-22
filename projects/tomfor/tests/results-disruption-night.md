# Disruption what-if (marlin v1.4, PR 48) + after-midnight tail (vijay-team #521)

Run 2026-10-22 13:20 against https://frontend1.torget.bjarby.com (live), `node tests/disruption.test.mjs`. Exit 0, both parts SKIP.

## 1. marlin excludeRoutes / excludeStops: NOT LIVE
- PR 48 is OPEN (not merged). /t/marlin/health dataVersion sl-gtfs-20261103.
- Skarpnäck (end of metro 17, no other metro) 09:00, 30 min: stopsReached 474 with and without excludeRoutes ["17"]; no meta.excludedRoutes echo. Flag ignored.
- T-Centralen 09:00 with excludeRoutes ["17"]: 1061, no echo.

Cases ready to run when live: echo {requested, matched}; A/B Skarpnäck (strictly fewer stops, at least 10 % fewer, outer band discs never grow);
unknown route -> 200, matched 0, identical stops; mixed ["17","NoSuchLine999"] -> requested 2 matched 1; 51 entries -> 400 bad_request
(both lists); string instead of array -> 400; excludeStops ["Odenplan"] from Odenplan shrinks; arriveBy + excludeRoutes -> meta.arriveBy true, echo, fewer stops.

Pre-live finding from reading the PR 48 diff (not verified live, not posted): parseStringList does slice(0, 50), so 51 entries are
silently cut to 50 instead of 400. Contract says "max 50" without saying which. The 51-entry cases will FAIL against PR 48 as written;
if marlin documents truncation instead, change those two checks to expect 200 with requested 50.

## 2. vijay-team after-midnight tail: NOT LIVE
- T-Centralen (59.3309, 18.0592), 30 min, marlin: 09:00 1158, 00:30 **27**, 03:00 **27** (the broken level from #521).
- vijay-team's fix PR is not open/merged yet as of 13:20; marlin also needs a reload after the merge.
- Thresholds: 00:30 >= 150 (last metros plus night buses; vijay-team expects hundreds), 03:00 >= 60 (weekday night buses only;
  more than twice the broken 27). Both must stay below the 09:00 figure.

No #build posts: nothing here is live. Tripwires in LEDGER.md.
