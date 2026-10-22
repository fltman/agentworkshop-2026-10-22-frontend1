'use strict';

/**
 * mareri - street-network walking areas for the isochrone tile.
 *
 * Mounted on /t/mareri/.
 *
 *   GET /t/mareri/walk?lat=59.33&lon=18.06&minutes=10[&speedKmh=4.8]
 *     -> GeoJSON Feature (Polygon/MultiPolygon): where you really can walk to in
 *        that time along streets and paths (OSM data, Valhalla pedestrian
 *        routing), not a straight-line circle.
 *
 * Errors: {error, message, message_sv} with status 400 / 502 / 504.
 */

const VALHALLA = 'https://valhalla1.openstreetmap.de/isochrone';
const USER_AGENT = 'agentworkshop-mareri-isochrone-tile/1.0 (workshop demo)';
const TIMEOUT_MS = 12000;
const CACHE_LIMIT = 200;
const MIN_INTERVAL_MS = 250;

const cache = new Map();
let nextSlot = 0;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function fail(res, status, error, message, messageSv) {
  send(res, status, { error, message, message_sv: messageSv });
}

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

function upstreamError(msg) {
  const e = new Error(msg);
  e.upstream = true;
  return e;
}

async function walkArea(lat, lon, minutes, speedKmh) {
  const key = [lat.toFixed(4), lon.toFixed(4), minutes, speedKmh].join('|');
  if (cache.has(key)) return cache.get(key);

  // Be polite to the public router: at most one call per MIN_INTERVAL_MS.
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));

  const query = {
    locations: [{ lat, lon }],
    costing: 'pedestrian',
    costing_options: { pedestrian: { walking_speed: speedKmh } },
    contours: [{ time: minutes }],
    polygons: true,
    denoise: 0.3,
    generalize: 20,
  };
  const url = VALHALLA + '?json=' + encodeURIComponent(JSON.stringify(query));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw upstreamError('router HTTP ' + r.status);
  const data = await r.json();
  const feat = data && data.features && data.features[0];
  if (!feat || !feat.geometry) throw upstreamError('router returned no area');

  const out = {
    type: 'Feature',
    properties: { minutes, speedKmh, source: 'osm-valhalla-pedestrian' },
    geometry: feat.geometry,
  };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

module.exports = {
  async handle(req, res, ctx) {
    if (req.method !== 'GET' || ctx.path !== '/walk') return false;
    const q = new URL(req.url, 'http://x').searchParams;

    const lat = num(q.get('lat'));
    const lon = num(q.get('lon'));
    const minutes = num(q.get('minutes'));
    const speedKmh = q.get('speedKmh') === null ? 4.8 : num(q.get('speedKmh'));

    if (!(lat >= 58.5 && lat <= 60.5 && lon >= 17 && lon <= 19.5)) {
      fail(res, 400, 'bad_request', 'lat/lon must be a point in the Stockholm region.', 'lat/lon måste vara en punkt i Stockholmsregionen.');
      return true;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      fail(res, 400, 'bad_request', 'minutes must be a whole number from 1 to 30.', 'minutes måste vara ett heltal från 1 till 30.');
      return true;
    }
    if (!(speedKmh >= 1 && speedKmh <= 10)) {
      fail(res, 400, 'bad_request', 'speedKmh must be between 1 and 10.', 'speedKmh måste vara mellan 1 och 10.');
      return true;
    }

    try {
      send(res, 200, await walkArea(lat, lon, minutes, speedKmh));
    } catch (err) {
      if (err.name === 'AbortError') {
        fail(res, 504, 'timeout', 'The street router took too long.', 'Ruttjänsten svarade för långsamt.');
      } else {
        console.error('[mareri]', err && err.message);
        fail(res, 502, 'router_unavailable', 'The street router is unavailable.', 'Ruttjänsten är inte tillgänglig.');
      }
    }
    return true;
  },
};
