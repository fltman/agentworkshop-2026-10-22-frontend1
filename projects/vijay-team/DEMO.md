# Demo checklist: Isochronous Public Transport Map for Stockholm

Status checked live on 2026-10-22 10:26. Re-check before the demo. Owner in brackets.

| Requirement | Status | Evidence |
|---|---|---|
| Map of Stockholm with OSM tiles, pan and zoom | Partly | filbac tile `/colony/filbac/` is live with a Leaflet map; mareri tile `/colony/mareri/` is still 404. Our own station explorer map exists (vijay-team) but it is not the product (mareri, filbac) |
| Origin pin, movable | Missing | no live tile with a pin yet (mareri, filbac) |
| Start time, default now | Partly | settings panel has start time, default null (filbac) |
| Max travel time 5 to 120 step 5, default 30 | Partly | in the settings panel (filbac); engine accepts 5..120 but also accepted 33 (marlin, fault reported by tomfor) |
| Max waiting time, default 7 | Done (UI) | settings panel (filbac); engine takes `maxWaitMinutes` (marlin) |
| Walking times (to destination, between stations) | Partly | settings panel has both (filbac); engine uses straight-line walking (marlin) |
| Transport types | Partly | mode names agreed (vijay-team); selection in UI not verified |
| Max connections, default 3 | Done (UI) | settings panel (filbac) |
| Update button triggers calculation | Missing | no live end-to-end path yet |
| 5-minute colour bands | Partly | engine returns bands on real data in 13 to 330 ms (marlin); overlay on the map not yet verified |
| Results within a couple of seconds | Unknown | real data: 13 to 330 ms per query, 120 min answer is 1.09 MB gzipped (marlin, perf-analyst) |
| Trafiklab not called per request | Done | all data is preprocessed from the GTFS zip, no Trafiklab call at request time (vijay-team) |
| Mobile and desktop usable | Unknown | no live product tile to test (mobile-ux-tester) |
| Clean modern UI | Unknown | same |
| English and Swedish | Partly | strings pack and error catalog (tomfor, PR 7), settings panel EN/SV (filbac) |
| Clear error messages (API failure, no routes, too restrictive) | Partly | engine errors carry `message` and `message_sv` (marlin); catalog by tomfor; not seen end to end |

## Biggest blockers right now

1. ~~marlin on fixture~~ Fixed: marlin runs on real GTFS (6038 stops, 644,804 connections). Open: T-Centralen 60 min polygon misses 3 far stops (93.9% coverage).
2. **Map app not yet verified end to end.** filbac's tile is live; mareri's is 404. Test Update, bands and errors on filbac's tile.
3. **Engine accepts `maxTravelMinutes: 33`** where the contract says multiples of 5 (found by tomfor).

## Demo script (3 minutes), once the map app is live

1. Open the app on a phone-sized window. Show the map of Stockholm, zoom in on T-Centralen.
2. Place the pin on T-Centralen. Show defaults: now, 30 min, 7 min wait, 3 connections.
3. Press Update. Bands appear within seconds, 5 minutes each.
4. Change max travel to 60 min and untick bus. Update. The area changes shape.
5. Move the pin to Kista. Update.
6. Switch to Swedish. Choose very restrictive settings: the clear error message appears.
7. Show our station explorer (`/colony/vijay-team/`) as the data behind it: 6,038 stations, 645k weekday connections, no Trafiklab calls.
