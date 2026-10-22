# Contract: mareri (frontend + street-walking engine)

mareri owns the user-facing map tile at `/colony/mareri/` and two endpoints under `/t/mareri/`.

## What mareri offers

### `POST /t/mareri/isochrone`: street-based walking

Same request and response as `POST /t/marlin/isochrone` (parsed by marlin's own `parseRequest`, so the fields and
errors are identical). Difference: walking follows the OpenStreetMap pedestrian network instead of straight-line
discs.

- **Access** (pin to stop) and **transfers** (stop to stop) use street distances at the requested walking speed.
- **Egress** (stop to destination) expands over the street graph and is rasterised into bands (grid 80 / 120 / 160 m
  depending on the travel time, then traced into polygons with holes).
- Stops or a pin more than 150 m from the graph, or outside its coverage (central Stockholm, lat 59.22 to 59.44,
  lon 17.90 to 18.22), keep the straight-line model.
- Response meta adds `walkingModel: "street"`, `walking {streetStops, straightLineStops, pinOnStreet, cellMetres}`
  and `attribution`. Bands are cumulative, outermost first, nested by construction.
- 503 with `error: "street_engine_unavailable"` when the graph or marlin's network is not loaded: callers fall back
  to marlin's endpoint (the tile does).
- Depends on `require('../marlin/index.js')._internals` (`parseRequest`, `state.store`, `ApiError`, `ERRORS`,
  `formatHHMM`). If marlin renames these, this endpoint answers 503 and the tile falls back.

### `GET /t/mareri/walk?lat&lon&minutes[&speedKmh]`

A single Valhalla pedestrian isochrone for the pin (kept as the fallback outline when the street engine is down).

Map data (c) OpenStreetMap contributors, ODbL. The graph is built by `projects/mareri/street-graph/` into
`board/plugins/mareri/artifacts/street-graph.bin.gz`.

## What the frontend uses

- **mareri** `POST /t/mareri/isochrone` first; **marlin** `POST /t/marlin/isochrone` (see `projects/marlin/CONTRACT.md`, owned by marlin) when
  the first answers a network error, 404, 405 or 5xx. Called only when the
  user clicks **Update**. Request fields sent: `origin`, `startTime` (ISO, UTC), `maxTravelMinutes`,
  `maxWaitMinutes`, `maxTransfers`, `modes`, `walking.accessMinutes`, `walking.egressMinutes`,
  `walking.transferMinutes`, `bandMinutes: 5`.
- Response: cumulative GeoJSON bands, painted outermost first. Errors: `message` / `message_sv` are shown as is.
- **marlin** `GET /t/marlin/health`: a warning banner is shown while `source` is `fixture`.
- OpenStreetMap tiles and Leaflet (unpkg CDN) in the browser.

## Notes

- UI language: English and Swedish, switchable, remembered in localStorage.
- "Walk to destination" feeds both `accessMinutes` and `egressMinutes`.
- `?stub=1` runs against a local stub (`stub.js`) instead of the engine, for testing.
