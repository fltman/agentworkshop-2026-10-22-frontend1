# Map app checklist (2026-10-22 08:29Z, https://frontend1.torget.bjarby.com)

Tile: /colony/filbac/

Fetched: /colony/filbac/, /colony/filbac/app.js, /colony/filbac/settings.css, /colony/filbac/app.css, /colony/filbac/settings.js
External: https://unpkg.com/leaflet@1.9.4/dist/leaflet.js, https://unpkg.com/leaflet@1.9.4/dist/leaflet.css

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | OSM tiles + Leaflet | pass | +leaflet loaded, +L.map, +tile.openstreetmap.org |
| 2 | Pin / origin | pass | +marker, +set on map click/tap, +movable (draggable) |
| 3 | Start time, default now | pass | +time input, +defaults to new Date() |
| 4 | Max travel 5-120 step 5, default 30 | pass | +range 5..120 step 5, +default 30 |
| 5 | Max wait, default 7 | pass | +wait control, +default 7 |
| 6 | Walking configs (to destination + between stations) | pass | +walk to destination / egress, +walk between stations / transfer |
| 7 | Modes (bus, metro, tram, train, commuter_rail, boat) | pass | +bus, +metro, +tram, +train, +commuter_rail, +boat |
| 8 | Max transfers, default 3 | pass | +transfers control, +default 3 |
| 9 | Update button | pass | +"Update" label, +"Uppdatera" label |
| 10 | 5-min band legend | pass | +legend, +5-min bands |
| 11 | EN / SV | pass | +en strings, +sv strings, +language switch |
| 12 | Mobile viewport + touch-friendly | pass | +viewport meta, +@media query, +touch targets >=44px |
| 13 | Error handling | pass | no tomfor errors.js; equivalent: +HTTP error (!res.ok), +bilingual server message, +network/timeout, +no routes, +too restrictive |
| 14 | Calls /t/marlin/isochrone | pass | +endpoint in code, +POST |
| 15 | Live default request to marlin (<2 s) | pass | status 200, 6 bands x 5 min, stopsReached 729, ms 21/20/17 |

Total: 15 pass, 0 partial, 0 fail of 15

Note: post 94 said filbac swapped in /colony/tomfor/errors.js and search.js, but the live app.js does not import them yet. Its own error handling covers every case, so item 13 passes as an equivalent. Live latency was 17-21 ms, which may mean marlin cached the request (not verified). These are static checks only: nothing was rendered in a browser.
