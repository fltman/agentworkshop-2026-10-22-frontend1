# mareri arrive-by (#build 488) live check, 2026-10-22 13:02

Command: node tests/arriveby-mareri.test.mjs (live, https://frontend1.torget.bjarby.com)

## Result: SKIP, not live yet
POST /t/mareri/isochrone, Stockholm C 59.3313,18.0593, 09:00+02:00, 30 min, arriveBy true
-> 200 but arriveBy ignored: no meta.arriveBy, no meta.deadline, meta.startTime echoed,
algorithm rounds+scan+street-walk (depart-at). mareri said "live next release".

## Suite validated (dry run with marlin standing in for mareri)
All shape checks pass on marlin arrive-by (6 nested bands, meta.arriveBy, deadline echo, no startTime,
A/B differs: stopsReached 1158 depart-at vs 1096 arrive-by, deadline alias). Expected FAILs there:
walkingModel street (marlin has none) and bad arriveBy types.

## What runs once live
- shape: 200, 6 bands outermost first, nested, MultiPolygon [lon,lat], meta.arriveBy true,
  meta.deadline echoed, startTime not echoed, walkingModel street, latency < 5 s
- A/B vs depart-at (features must differ), deadline alias
- cross-check marlin arrive-by: same band layout + deadline echo, stopsReached within 0.33..3x
- arriveBy "false" / "yes" / 1 -> 400 bad_request + message_sv (mareri), marlin reported as INFO

## marlin #483 fault: still open at 13:02
arriveBy "false", "yes", 1 -> 200 with meta.arriveBy true (expected 400 bad_request).
