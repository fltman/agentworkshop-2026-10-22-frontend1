# tomfor walk-mode.js: walk-only mode for the group map

Owner: team tomfor (walk-mode owner: jonny-walker). Only tomfor changes this file; changes are announced in `#build` first.
For: mareri (`/colony/mareri/`, the one group map). Built on filbac's gateway walk mode (PR 30, `projects/filbac/GATEWAY.md`)
and mareri's `GET /t/mareri/walk`.

## Load it: one script tag

```html
<script src="/colony/tomfor/mareri-adapter.js"></script> <!-- optional: wording + errorText -->
<script src="/colony/tomfor/walk-mode.js"></script>
```

Classic script, no build step, no dependencies. Exposes `window.TomforWalk`.

## API

| call | what |
|---|---|
| `TomforWalk.fetchWalkBands({lat, lon, maxMinutes=30, stepMinutes=5, speedKmh=4.8}, opts?)` | Promise of a FeatureCollection in marlin's band format with `meta.walkOnly: true` |
| `TomforWalk.addWalkChip(container, onToggle(on), {on, lang, className}?)` | appends a `<button data-mode="walk" aria-pressed>` chip; returns it (`.refresh()` re-renders the label after a language switch) |
| `TomforWalk.legendText(lang, fc)` | `{title, note, result, estimated}`: strings `legend.walkOnly`, `legend.walkOnly.note`, `result.walkOnly`; `estimated` is `legend.walkEstimated` when any band has `estimated: true`, else `null` |
| `TomforWalk.errorText(lang, err)` | one sentence plus fix for a rejected `fetchWalkBands` (via `TomforMareri.errorText` when loaded) |

`opts`: `base` (default same origin), `fetch`, `timeoutMs` (20000), `gateway: false` (skip the gateway),
`repairSeam: false` (keep the gateway's raw estimate bands).

### What fetchWalkBands does

1. `POST /t/filbac/api/isochrone` with `{origin:{lat,lon}, modes:[], maxTravelMinutes, bandMinutes, walking:{speedKmh}}`.
   A 200 with `meta.walkOnly: true` is used as-is (`meta.via: "gateway"`).
2. Otherwise (gateway without walk mode, or down) it builds the same bands itself: `GET /t/mareri/walk?lat&lon&minutes&speedKmh`
   per band up to 30 min, straight-line estimate (speed / 1.3) beyond, same wrapping as the gateway (`meta.via: "tomfor-fallback"`).
3. **Seam repair**: a straight-line band beyond 30 min can be smaller than the 30-min street band (Stockholm centre:
   street 30 min reaches 2.21 km, the 31-min estimate only 1.91 km). Each `estimate` band is grown to at least
   the last street band's reach scaled by minutes, so bands nest. Repaired bands get `properties.seamRepaired: true`
   and `meta.seamRepaired: true`.
   **Since filbac PR 36 (verified live 2026-10-22) the gateway fixes this itself**: estimate bands are discs reaching past
   the farthest point of the 30-min street band, monotone (centre 31 min: reach 1.91 -> 2.30 km, 30-in-31 vertices
   outside 24.6 % -> 0 %). On gateway answers the repair is a no-op safety net and `seamRepaired` stays unset; it only
   triggers on the `tomfor-fallback` path or an older gateway. If any street band fails, the gateway returns all bands
   as estimates.
4. **Estimated bands** (2026-10-22): every band gets `properties.estimated: true|false`. True when `source` is
   `"estimate"` (straight line, not along streets); bands without a `source` count as estimated when `toMinutes > 30`.
   `meta.streetMaxMinutes: 30` and `meta.estimatedFromMinutes` (lowest `fromMinutes` of an estimated band, `null` if none).
   Draw estimated bands dashed and show `legend.walkEstimated` ("Beyond 30 min: estimate, not along streets").
   Why: mareri `/walk` caps at 30 min (400 beyond), so the gateway draws discs from 31 min. The reach is right
   (35/30 = 1.18x) but the area jumps 2.2-2.6x instead of the 1.36x walking speed predicts, because the 30-min street
   polygon fills only 55-62 % of its circle (tests/results-walk-beyond-30.md).

### Band format (same as marlin / gateway)

- Cumulative, outermost first: `features[0].properties.toMinutes === maxMinutes`, last band has `fromMinutes: 0`,
  `features[i].fromMinutes === features[i+1].toMinutes`. Draw in array order.
- `properties`: `fromMinutes, toMinutes, from_min, to_min, bandIndex, stops: 0, mode: "walk", source: "street"|"estimate", estimated: boolean`.
- `meta`: `walkOnly: true, modes: ["walk"], maxTravelMinutes, bandMinutes, speedKmh, source: street|estimate|mixed, cumulativeBands: true, via, streetMaxMinutes: 30, estimatedFromMinutes`.
- At most 24 bands (`bandMinutes` is widened if needed). `maxMinutes` 5..120, `stepMinutes` 1..30.

### Errors

Rejects with an `Error` whose `.code` is an `errors.js` code:

| code | when | strings key |
|---|---|---|
| `bad_request` | origin outside the Stockholm region, minutes out of range (checked before any request) | `error.bad_request` |
| `origin_not_walkable` | mareri says 422 `origin_not_walkable` (`/walkable` pre-check or gateway pass-through: water, >80 m from a street) or `no_walkable_network` (`/walk`: no network, e.g. sea at 58.8,17.6). Also when the gateway answers only estimate bands up to 30 min and one mareri `/walk` probe says 422. No estimate circles are drawn. | `error.origin_not_walkable(.fix)` |
| `walk_unavailable` | gateway has no walk answer and every mareri `/walk` call failed | `error.walk_unavailable(.fix)` |
| `timeout` | gateway timed out and the fallback failed too | `error.timeout` |
| `offline` | `navigator.onLine === false` | `error.offline` |

### Strings

Chip label: `I18N[lang]['mode.walk']` (merged by `mareri-adapter.js`), then `TomforStrings.t` if present, then built-in
EN/SV (same text as `strings.js`). Keys used: `mode.walk`, `legend.walkOnly`, `legend.walkOnly.note`, `legend.walkEstimated`, `result.walkOnly`,
`error.walk_unavailable`, `error.walk_unavailable.fix`, `error.origin_not_walkable`, `error.origin_not_walkable.fix`.

### Not walkable origins (mareri PR 41/42, 2026-10-22)

`fetchWalkBands` first calls `GET /t/mareri/walkable?lat=&lon=` (skip with `opts.checkWalkable: false`); a 422 there
rejects at once. Any other answer, or mareri down, carries on. errors.js maps both mareri codes to
`error.origin_not_walkable`; a bare 422 without a code still means `too_restrictive`. WalkError carries
`engineMessage` / `engineMessageSv` with mareri's own text.

Live check 2026-10-22: 58.8,17.6 and 60.45,19.45 now 422 (nesting fault gone); 59.3235,18.06 (Riddarfjärden)
/walkable 422. Still open: 59.8,19.0 is walkable but 25 min is 10.4 % outside 30 min (Valhalla generalisation, mareri
calls it upstream). filbac's gateway turns mareri's 422 into 200 estimate bands (58.8,17.6) and does not check
/walkable (59.3235,18.06 gives street bands from the water), so walk-mode.js detects both itself.

## Example

```js
const chip = TomforWalk.addWalkChip(document.querySelector('.modes'), (on) => { walkOnly = on; update(); });
async function update() {
  if (!walkOnly) return drawTransit();
  try {
    const fc = await TomforWalk.fetchWalkBands({ lat: pin.lat, lon: pin.lng, maxMinutes: 30, stepMinutes: 5 });
    drawBands(fc); // same renderer as transit bands
    legend.textContent = TomforWalk.legendText(lang, fc).result;
  } catch (err) {
    showError(TomforWalk.errorText(lang, err));
  }
}
```

Response (shortened, live gateway, centre, 31 min / 10 min bands):

```json
{"type":"FeatureCollection",
 "meta":{"walkOnly":true,"modes":["walk"],"maxTravelMinutes":31,"bandMinutes":10,"source":"mixed","via":"gateway"},
 "features":[
  {"properties":{"fromMinutes":30,"toMinutes":31,"mode":"walk","source":"estimate"},"geometry":{"type":"MultiPolygon"}},
  {"properties":{"fromMinutes":20,"toMinutes":30,"mode":"walk","source":"street"},"geometry":{"type":"Polygon"}},
  {"properties":{"fromMinutes":10,"toMinutes":20,"mode":"walk","source":"street"},"geometry":{"type":"Polygon"}},
  {"properties":{"fromMinutes":0,"toMinutes":10,"mode":"walk","source":"street"},"geometry":{"type":"Polygon"}}]}
```

## Tests and fixtures

- `node tests/walk-mode.test.mjs`: offline, replays `tests/fixtures/walk/` (nesting, 30-min seam, outermost first,
  cumulative, `meta.walkOnly`, fallback, errors, chip). `--live` runs the same invariants against the live gateway.
- `tests/fixtures/walk/capture.mjs` re-captures `live-capture.json` (gateway + mareri `/walk` per band).
  `capture-pre-pr36-gateway.json` is the gateway before filbac PR 36 (broken 30-min seam), used to test the safety net.
  `capture-prewalk-gateway.json` is the gateway before PR 30 (modes `[]` gave 400), used for the fallback tests.
  `bands-<case>.json` are ready-made walk FeatureCollections for offline UI tests.
- Nesting tolerance: 2 % of an inner band's vertices may fall outside the next band (mareri's 25 and 30 min polygons
  differ by 2 of 102 vertices).
