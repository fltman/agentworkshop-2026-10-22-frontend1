# marlin — isochrone engine contract

What team marlin offers the group: a backend that turns an origin, a start time and a set
of travel constraints into time-banded reachable areas for Stockholm public transport.

Base URL: `/t/marlin/` (same origin as The Square and as the colony tiles, so no CORS).

Owner: team marlin. Only marlin changes this file. Changes are announced in `#build`
before they ship.

Status: **v1, implemented.** Runs on a synthetic fixture until vijay-team's preprocessed
network is in place; the API shape does not change when the real data arrives.

---

## 1. POST /t/marlin/isochrone

The one call the frontend needs. Everything is optional except `origin`.

### Request

```json
{
  "origin":            { "lat": 59.3326, "lon": 18.0649 },
  "startTime":         "2026-10-22T09:00:00+02:00",
  "maxTravelMinutes":  30,
  "maxWaitMinutes":    7,
  "maxTransfers":      3,
  "modes":             ["bus", "metro", "tram", "train", "commuter_rail", "boat"],
  "walking": {
    "speedKmh":        4.8,
    "accessMinutes":   10,
    "egressMinutes":   10,
    "transferMinutes": 5
  },
  "bandMinutes":       5
}
```

| field | type | default | meaning |
|---|---|---|---|
| `origin.lat` / `origin.lon` | number | **required** | where the user put the pin, WGS84 |
| `startTime` | ISO 8601 string, or `"HH:MM"` | now, Europe/Stockholm | when the journey starts |
| `maxTravelMinutes` | 5…120, multiple of 5 | 30 | total travel-time budget |
| `maxWaitMinutes` | 0…60 | 7 | longest wait allowed at a transfer. The *first* boarding after walking from the pin is deliberately not limited: otherwise a pin next to a half-hourly line would look unreachable |
| `maxTransfers` | 0…8 | 3 | maximum number of connections |
| `modes` | array of mode names | all | allowed transport types |
| `walking.speedKmh` | 1…10 | 4.8 | walking speed used for access, egress and transfers |
| `walking.accessMinutes` | 0…30 | 10 | longest walk from the pin to the first stop |
| `walking.egressMinutes` | 0…30 | 10 | longest walk from the last stop to the destination area |
| `walking.transferMinutes` | 0…30 | 5 | longest walk when a transfer needs walking |
| `bandMinutes` | 1…30 | 5 | width of one colour band |

Mode names are exactly the ones vijay-team uses:
`bus`, `metro`, `tram`, `train`, `commuter_rail`, `boat`.
Unknown mode names are rejected with 400 rather than silently ignored.

### Response 200

A GeoJSON `FeatureCollection`. One `Feature` per band, **ordered outermost band first**,
so a frontend can paint them in array order and let the nearer bands cover the farther ones.

```json
{
  "type": "FeatureCollection",
  "meta": {
    "origin":        { "lat": 59.3326, "lon": 18.0649 },
    "startTime":     "2026-10-22T09:00:00+02:00",
    "bandMinutes":   5,
    "maxTravelMinutes": 30,
    "stopsReached":  412,
    "computedMs":    184,
    "dataVersion":   "sl-gtfs-2026-10-21",
    "source":        "fixture",
    "algorithm":     "rounds+scan",
    "cumulativeBands": true
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "fromMinutes": 25,
        "toMinutes":   30,
        "bandIndex":   5,
        "color":       "#2c7bb6",
        "stops":       88
      },
      "geometry": { "type": "MultiPolygon", "coordinates": [ [ [ [18.07, 59.33], "…" ] ] ] }
    }
  ]
}
```

- `features[i].properties.fromMinutes` / `toMinutes` are the band edges in minutes from
  the origin. With `bandMinutes: 5` and `maxTravelMinutes: 30` there are six bands:
  0–5, 5–10, 10–15, 15–20, 20–25, 25–30.
- **Bands are cumulative** (`meta.cumulativeBands: true`): the geometry of the 25–30 band
  is everything reachable within 30 minutes, not a ring. That is why they arrive
  outermost first. Paint them in array order with a solid fill and the nearer bands cover
  the farther ones, which gives exactly the ring picture without any polygon union.
  `properties.bandIndex` goes 1 (innermost) upwards, so a palette can be indexed directly.
- `color` is a suggestion, not an order. The frontend may use its own palette.
- Coordinates are `[lon, lat]`, as GeoJSON requires. Note the order.
- A band with no reachable area is still present, with an empty `coordinates` array.
  The frontend never has to handle a missing band.

### Errors

Every error is JSON with the same shape, and an HTTP status that means something:

```json
{ "error": "no_stops_near_origin",
  "message": "No stop within a 10 minute walk of the pin.",
  "message_sv": "Ingen hållplats inom 10 minuters gångavstånd från nålen." }
```

| status | `error` | when |
|---|---|---|
| 400 | `bad_request` | malformed JSON, missing origin, number out of range |
| 400 | `unknown_mode` | a mode name that is not in the list above |
| 422 | `no_stops_near_origin` | nothing reachable on foot from the pin |
| 422 | `nothing_reachable` | stops found, but no departure fits the constraints |
| 503 | `network_not_loaded` | the preprocessed network is not in place yet |
| 500 | `internal` | anything else |

Both `message` (English) and `message_sv` (Swedish) are always present, so the frontend
can show either language without mapping error codes itself.

---

## 2. GET /t/marlin/health

Cheap liveness and readiness check. Never fails.

```json
{ "ok": true,
  "networkLoaded": true,
  "dataVersion": "sl-gtfs-2026-10-21",
  "stops": 14233,
  "connections": 2841902,
  "source": "fixture" }
```

`source` is `"fixture"` while we run on synthetic test data and `"gtfs"` once vijay-team's
real artifacts are loaded. The frontend can show a warning banner on `"fixture"`.

---

## 3. GET /t/marlin/modes

The modes this deployment actually has data for, so the frontend can grey out the rest
instead of offering a filter that returns nothing.

```json
{ "modes": ["bus", "metro", "tram", "commuter_rail"] }
```

---

## What marlin needs from vijay-team

We read **files**, once, at startup. A user request never reaches vijay-team's service.
Drop the artifacts in the plugin data directory under `network/`:

| file | contents |
|---|---|
| `meta.json` | `{ "dataVersion": "sl-gtfs-2026-10-21", "timezone": "Europe/Stockholm" }` |
| `stops.json` | `[{ "id": "9001", "name": "T-Centralen", "lat": 59.33, "lon": 18.06, "modes": ["metro","bus"] }]` |
| `connections.json` | `[{ "from": "9001", "to": "9002", "dep": 32400, "arr": 32580, "route": "17", "mode": "metro", "trip": "t1", "service": "wd" }]` |
| `transfers.json` | `[{ "from": "9001", "to": "9003", "seconds": 180 }]` |
| `calendar.json` | `{ "wd": { "days": [1,2,3,4,5] }, "sa": { "days": [6] } }` |

- `dep` and `arr` are **seconds after midnight**, service-day based, so a value above
  86400 is a trip after midnight. We handle that.
- `connections.json` does not have to be sorted; we sort and index it at startup.
- A JSON Lines variant (`connections.jsonl`, one object per line) is accepted too and is
  easier on memory for the big file. We try `.jsonl` first, then `.json`.

If a file is missing we start anyway, answer `health` with `networkLoaded: false` and
return 503 from `/isochrone` with a clear message. Nothing crashes.

---

## Example

```bash
curl -s -X POST https://<board>/t/marlin/isochrone \
  -H 'content-type: application/json' \
  -d '{"origin":{"lat":59.3326,"lon":18.0649},"maxTravelMinutes":30}'
```
