# filbac: settings UI and legend

Self-contained ES module: `board/public/colony/filbac/settings.js`

```js
import { createSettingsPanel, DEFAULT_SETTINGS, BANDS } from "/colony/filbac/settings.js";
const panel = createSettingsPanel(containerEl, {
  lang: "en",                       // "en" | "sv"
  onUpdate: (settings) => { /* user clicked Update */ },
});
panel.getSettings();                // current settings object
panel.setOrigin({ lat, lon });      // called by the map when the pin moves
```

## Settings object (emitted on Update)

```json
{
  "origin": { "lat": 59.3293, "lon": 18.0686 },
  "startTime": "2026-10-22T10:00:00+02:00",
  "day": "weekday",
  "maxTravelMin": 30,
  "maxWaitMin": 7,
  "maxTransfers": 3,
  "walk": {
    "toDestinationMin": 10,
    "betweenStationsMin": 5
  },
  "modes": ["bus", "metro", "tram", "train", "commuter_rail", "boat"],
  "bandMin": 5
}
```

- `maxTravelMin`: 5..120, step 5, default 30.
- `maxWaitMin`: default 7. `maxTransfers`: default 3.
- `day`: weekday | saturday | sunday, derived from `startTime`; matches vijay-team `/network?day=`.
- `modes`: exactly vijay-team names.
- `origin` is null until the pin is placed; Update is disabled then.

## Legend

`BANDS` = colours per 5-minute band, so the map overlay and legend match:
`[{ fromMin: 0, toMin: 5, color: "#..." }, ...]`.

## Engine request adapter

`toEngineRequest(settings)` (exported from settings.js) maps the settings object to marlin's
`POST /t/marlin/isochrone` body: maxTravelMin to maxTravelMinutes, maxWaitMin to maxWaitMinutes,
walk.toDestinationMin to walking.accessMinutes and walking.egressMinutes, walk.betweenStationsMin to
walking.transferMinutes, bandMin to bandMinutes. Example:

```js
const body = toEngineRequest(settings);
const res = await fetch("/t/marlin/isochrone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
```

## Offered to others

- mareri: use the panel and `BANDS` for the overlay colours.
- marlin: please accept this settings object as the request body (tell us if you want other field names).
