# Walk-only beyond 30 min: the 30 -> 35 min jump (2026-10-22 12:58)

Live: POST https://frontend1.torget.bjarby.com/t/filbac/api/isochrone, modes [], maxTravelMinutes 60, bandMinutes 5.
Script: tests/walk-beyond-30.mjs (area = shoelace on local equirectangular projection, reach = farthest vertex from origin).
Root cause: GET /t/mareri/walk?minutes=35 (45, 60) -> 400 "minutes must be a whole number from 1 to 30", so the gateway
uses mareri street polygons up to 30 min (source "street") and straight-line discs beyond (source "estimate"). Since
filbac PR 36 those discs reach past the farthest 30-min street point.

| point | 25 min km2 / km | 30 min km2 / km (street) | 35 min km2 / km (estimate) | 35/30 area | 35/30 reach |
|---|---|---|---|---|---|
| centre 59.3326,18.0649 | 6.66 / 1.84 | 9.50 / 2.21 | 21.19 / 2.60 | **2.23x** | 1.18x |
| Sodermalm 59.3142,18.0736 | 6.34 / 1.88 | 8.31 / 2.22 | 21.49 / 2.62 | **2.59x** | 1.18x |

Walking speed predicts 35/30 = 1.17x reach and 1.36x area. Street steps 25 -> 30 are 1.31-1.43x area, 1.18-1.20x reach.

Reading: the reach is right (1.18x). The jump is in the *shape*: the 30-min street polygon fills only 55-62 % of its
circumscribed circle (9.50 / (pi * 2.21^2) = 0.62; 8.31 / (pi * 2.22^2) = 0.54), the 35-min disc fills 100 %. So the 30 -> 35
band (the ring the user sees) is 11.7-13.2 km2, about 4-5x the 25 -> 30 ring (2.8-2.0 km2). Beyond 35 it is smooth again
(discs grow ~1.13-1.3x per step).

Fix options (in order):
1. mareri raises /walk max to 60 (or 120) if the street graph covers it, or accepts walk-only on POST /t/mareri/isochrone.
2. filbac scales the 30-min street polygon around the origin by t/30 instead of a disc: 35 min would be ~12.9 / 11.3 km2
   (1.36x), same shape.
3. mareri draws bands with source "estimate" dashed, with legend.walkEstimated (tomfor strings.js / mareri-adapter.js).

tomfor: walk-mode.js marks those bands properties.estimated = true (from properties.source "estimate", else toMinutes > 30).
