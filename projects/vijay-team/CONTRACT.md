# vijay-team: transit data layer (v1)

Source: SL GTFS (feed 2026-10-21) preprocessed offline by `projects/vijay-team/preprocess.js` into
`board/plugins/vijay-team/artifacts/network-<day>.json.gz`. No request ever calls Trafiklab.

## HTTP (mounted at `/t/vijay-team/`)

| Endpoint | Returns |
|---|---|
| `GET /network?day=weekday\|saturday\|sunday` | the compact network below (gzip JSON, `content-encoding: gzip`). Default: today's day type |
| `GET /stops?day=&bbox=minLon,minLat,maxLon,maxLat&modes=metro,bus` | JSON array of stops (with `index`), filtered |
| `GET /nearby?lat=&lon=&radius=800&modes=&day=` | stations within `radius` metres (max 3000), nearest first, max 50: `[{ index, id, name, modes, distM, walkSec }]`. `walkSec` is straight-line at 1.3 m/s. 400 if lat/lon are missing, empty or out of range (lat first). Any endpoint with an unknown `day` answers 400 |
| `GET /connections?day=` | connections for RAPTOR/CSA (gzip JSON, ~3-4 MB), format below |
| `GET /departures?stop=&time=HH:MM&day=&limit=10&modes=` | next departures from a station (`stop` = index or id from `/stops` or `/nearby`; `time` defaults to now in Stockholm; `limit` max 50): `{ stop, day, from, departures: [{ dep, depSec, route, mode, to, toIndex }] }`. 400 for an unknown stop or a bad time |
| `GET /service?stop=&day=` | first and last departure per mode at a station, departures per hour (24 buckets) and `serviceAfterMidnight`; `last` above 24:00 wraps (`lastSec` keeps the raw value, e.g. 90024 = 01:00 next day) |
| `GET /frequency?from=07:00&to=09:00&day=` | every station with service in the window: `{ stops: [{ index, departures, avgHeadwayMin }] }` for a service-quality layer. 400 if `to` is not after `from` |
| `GET /fragility?day=&minTopShare=0.8` | single-line dependence per station: `{ stations, singleLine, stops: [{ index, routes, departures, topShare, topRoute, topMode, singleLine }] }`. `singleLine` stations lose all service if that one route is disrupted; `minTopShare` keeps stations where the busiest route carries at least that share. 400 if not a number |
| `/meta` `feed` key | `{ version, publisher, validFrom, validTo }`: the timetable only covers `validFrom` to `validTo`; warn users who pick a date outside it |
| `GET /routes?modes=` | `[{ name, mode, lines, days }]`: every route with line geometry; `days` lists the day types with service (empty = no trips in the feed) |
| `GET /shape/<mode>/<name>` | GeoJSON Feature, `MultiLineString` (one line per direction, `[lon, lat]`, simplified to about 20 m). 404 if unknown. Example: `/shape/metro/10` |
| `GET /meta` | per day type: `{ date, generated, stopCount, tripCount }` |

Each day type is one representative day (Tue / Sat / Sun), about 35k / 23k / 22k trips, about 1-2 MB gzipped.

## Modes

`bus`, `metro`, `tram`, `train` (Roslagsbanan, Saltsjöbanan), `commuter_rail` (Pendeltåg), `boat`.

## Network format

```json
{
  "version": 1, "dayType": "weekday", "date": "20261103", "generated": "ISO time",
  "stops": [{ "id": "9021001001051000", "name": "T-Centralen", "lat": 59.33166, "lon": 18.06169, "modes": ["metro"] }],
  "trips": [{ "route": "10", "mode": "metro", "stops": [243, 244, 250], "times": [30000, 30120, 30300] }],
  "transfers": [{ "from": 243, "to": 301, "walkSec": 180 }]
}
```

- Stops are stations (platforms merged). In `trips[].stops` and `transfers` a stop is its **index** in `stops`.
- `times[i]` is the departure in seconds after midnight at `stops[i]` (can exceed 86400 after midnight).
- `transfers` are directed walking links (GTFS transfers plus any station within 300 m at 1.3 m/s).
- Only the first time you board and each later stop matter: ride from `stops[i]` to `stops[j]`, j > i, leaving at `times[i]` and arriving at `times[j]`.

## Connections format (`/connections`, also the file `board/plugins/vijay-team/artifacts/connections-<day>.json.gz`)

Columnar arrays of equal length, one entry per hop between consecutive stops of a trip, sorted by departure stop, then `dep`:

```json
{ "version": 1, "dayType": "weekday", "date": "20261103", "stopCount": 6038,
  "routes": [{ "name": "10", "mode": "metro" }],
  "offsets": [0, 12, 40],
  "from": [0], "to": [5], "dep": [30000], "arr": [30120], "route": [0], "trip": [17] }
```

- Connections departing stop `s` are indices `offsets[s]` to `offsets[s+1]-1`, already sorted by `dep`.
- `from`/`to` are indices into the `stops` list of `/network`. `route` indexes `routes`. Same `trip` value on consecutive hops means no change needed.
- Walking links: `transfers` in `/network`. The calendar is already resolved into the day type.

## Changes

Only vijay-team changes this contract. Changes are announced in `#build` first.

## Browser scripts (load with a script tag from /colony/vijay-team/)

| Script | Global | What it gives |
|---|---|---|
| `lines-layer.js` | `VijayLines.attach(map)` | toggleable transit-line overlay |
| `isochrone-summary.js` | `VijaySummary` | `summarize(fc, stops)` stations per band and mode, `describe(rows, 'sv'/'en')` screen-reader sentence, `areas(fc)` km2 per band, gain per minute, effective speed |
| `compare.js` | `VijayCompare` | `meeting(a, b, stops)`, `commonAll(fcs, stops)` best place to live for N pins, `unlock(iso, body, stops)` which limit blocks most places, `roundTrip(iso, body, stops, {start, returnBy, stayMinutes})` places you can reach and get back from, `sample()` + `reliability()` for reliable commute |
| `service-layer.js` | `VijayService.attach(map)` | stations coloured by headway; `setWindow(from, to)`, `setDay(day)`, `setVisible(bool)`; grey = no service |
| `bands.js` | `VijayBands` | `cache(iso, 120).get(body)` one request per origin and settings, `cut(fc, minutes)` slices a cached answer locally: a max-time slider with no rerun (60 to 30 min matched a direct query exactly) |
| `diff.js` | `VijayDiff` | `stations(fcA, fcB, stops)` gained, lost, faster, slower; `grid()` and `attach(map, fcA, fcB)` green/red difference map for two times, days or settings |
| `timelapse.js` | `VijayTimelapse` | `frames(iso, body, {from, to, stepMinutes})` one answer per time of day (3 engine calls at a time), `play(frames, draw, {fps})` animation, `series(frames, stops)` station count per time |
| `lasthome.js` | `VijayLastHome` | `find(iso, body, {home, after, latest})` latest departure that still reaches `home` within the time limit (`lastStart`, `minutes`), about 6-10 engine calls |
| `permalink.js` | `VijayPermalink` | `encode/decode/url/fromLocation` shareable search links (validated, unknown values dropped), `geojson(fc)`, `stationsCSV(fc, stops)`, `download()` |
| `scenarios.js` | `VijayScenarios` | save, list, rename, remove, export and import favourite origins and settings in the browser (localStorage, nothing leaves the device) |
| `housing.js` | `VijayHousing` | rank your own home-price points (CSV lat,lon,price,label) by travel time: `cheapestWithin`, `byBand`. No price data is shipped |
