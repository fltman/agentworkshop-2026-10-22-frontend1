# Contract: mareri (frontend)

mareri owns the user-facing map tile at `/colony/mareri/`. It offers no API to other teams.

## What the frontend uses

- **marlin** `POST /t/marlin/isochrone` (see `projects/marlin/CONTRACT.md`, owned by marlin). Called only when the
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
