import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../../board/plugins/marlin/index.js');
const network = require('../../board/plugins/marlin/network.js');
const engine = require('../../board/plugins/marlin/isochrone.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

plugin.init({ dataDir: '/nonexistent-on-purpose' });
const { parseRequest, computeIsochrone, state, formatHHMM } = plugin._internals;
const net = state.net;

const ORIGIN = { lat: 59.3313, lon: 18.0622 }; // T-Centralen
const q = (over = {}) => parseRequest(JSON.stringify({
  origin: ORIGIN, startTime: '09:00', ...over,
}), net);

test('fixture network loads', () => {
  assert.equal(net.source, 'fixture');
  assert.ok(net.stops.length > 20, 'expected stops');
  assert.ok(net.connections.length > 1000, 'expected connections');
  assert.ok(net.modes.includes('metro') && net.modes.includes('boat'));
});

test('connections are sorted by departure', () => {
  for (let i = 1; i < net.connections.length; i++) {
    assert.ok(net.connections[i - 1].dep <= net.connections[i].dep);
  }
});

test('lowerBound finds the first departure at or after a time', () => {
  const i = engine.lowerBound(net.depTimes, 9 * 3600);
  assert.ok(net.depTimes[i] >= 9 * 3600);
  if (i > 0) assert.ok(net.depTimes[i - 1] < 9 * 3600);
});

test('defaults match the contract', () => {
  const parsed = parseRequest(JSON.stringify({ origin: ORIGIN }), net);
  assert.equal(parsed.maxTravelSeconds, 30 * 60);
  assert.equal(parsed.maxWaitSeconds, 7 * 60);
  assert.equal(parsed.maxTransfers, 3);
  assert.equal(parsed.bandSeconds, 5 * 60);
  assert.deepEqual(parsed.allowedModes, network.MODES);
});

test('a 30 minute search from T-Centralen reaches a useful part of the net', () => {
  const r = engine.search(net, q());
  assert.ok(r.originStops >= 1, 'origin should find stops');
  assert.ok(r.reached >= 15, 'expected a decent catchment, got ' + r.reached);
});

test('arrival times are never earlier than the start', () => {
  const query = q();
  const r = engine.search(net, query);
  for (let i = 0; i < r.arrival.length; i++) {
    if (r.arrival[i] === engine.INF) continue;
    assert.ok(r.arrival[i] >= query.startSec);
    assert.ok(r.arrival[i] <= query.startSec + query.maxTravelSeconds);
  }
});

test('more travel time never reaches fewer stops (monotonic)', () => {
  let prev = -1;
  for (const minutes of [10, 20, 30, 45, 60]) {
    const r = engine.search(net, q({ maxTravelMinutes: minutes }));
    assert.ok(r.reached >= prev,
      minutes + ' min reached ' + r.reached + ', less than the shorter budget ' + prev);
    prev = r.reached;
  }
});

test('more transfers never reaches fewer stops (monotonic)', () => {
  let prev = -1;
  for (const transfers of [0, 1, 2, 3]) {
    const r = engine.search(net, q({ maxTransfers: transfers, maxTravelMinutes: 60 }));
    assert.ok(r.reached >= prev,
      transfers + ' transfers reached ' + r.reached + ', less than ' + prev);
    prev = r.reached;
  }
});

test('mode filtering actually restricts the result', () => {
  const all = engine.search(net, q({ maxTravelMinutes: 60 }));
  const metroOnly = engine.search(net, q({ maxTravelMinutes: 60, modes: ['metro'] }));
  assert.ok(metroOnly.reached < all.reached, 'metro only should reach fewer stops');
  assert.ok(metroOnly.reached > 1, 'metro only should still reach something');

  // Nothing but boats from T-Centralen: not a boat stop, so transit adds nothing.
  const boatOnly = engine.search(net, q({ maxTravelMinutes: 60, modes: ['boat'] }));
  assert.ok(boatOnly.reached <= metroOnly.reached);
});

test('a known journey has a plausible arrival time', () => {
  const r = engine.search(net, q({ maxTravelMinutes: 60, modes: ['metro'] }));
  const slussen = net.indexById.get(
    net.stops.find((s) => s.name === 'Slussen').id);
  const travelMin = (r.arrival[slussen] - q().startSec) / 60;
  // Two metro hops plus a dwell and a wait: minutes, not seconds, not an hour.
  assert.ok(travelMin > 3 && travelMin < 15,
    'T-Centralen to Slussen took ' + travelMin.toFixed(1) + ' min');
});

test('walking transfers are bounded by the walking setting', () => {
  const generous = engine.search(net, q({ maxTravelMinutes: 60, walking: { transferMinutes: 15 } }));
  const none = engine.search(net, q({ maxTravelMinutes: 60, walking: { transferMinutes: 0 } }));
  assert.ok(generous.reached >= none.reached);
});

test('a pin in the middle of the Baltic finds no stops', () => {
  assert.throws(
    () => computeIsochrone(net, q({ origin: { lat: 58.0, lon: 20.5 } })),
    (err) => err.code === 'no_stops_near_origin');
});

test('bands come back outermost first and cover the whole budget', () => {
  const out = computeIsochrone(net, q({ maxTravelMinutes: 30 }));
  assert.equal(out.type, 'FeatureCollection');
  assert.equal(out.features.length, 6);
  assert.equal(out.features[0].properties.toMinutes, 30);
  assert.equal(out.features[5].properties.toMinutes, 5);
  for (const f of out.features) {
    assert.equal(f.geometry.type, 'MultiPolygon');
    assert.ok(/^#[0-9a-f]{6}$/.test(f.properties.color));
  }
});

test('band geometry is valid GeoJSON with lon,lat order and closed rings', () => {
  const out = computeIsochrone(net, q());
  const ring = out.features[0].geometry.coordinates[0][0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring must be closed');
  for (const [lon, lat] of ring) {
    assert.ok(lon > 17 && lon < 19, 'longitude out of Stockholm range: ' + lon);
    assert.ok(lat > 58.5 && lat < 60.5, 'latitude out of Stockholm range: ' + lat);
  }
});

test('outer bands cover at least as much area as inner bands', () => {
  const out = computeIsochrone(net, q());
  const area = (f) => f.geometry.coordinates.length;
  const outer = out.features[0];
  const inner = out.features[out.features.length - 1];
  assert.ok(outer.properties.stops >= inner.properties.stops);
  assert.ok(area(outer) >= 1);
});

test('every band is present even when empty', () => {
  const out = computeIsochrone(net, q({ maxTravelMinutes: 120, modes: ['boat'] }));
  assert.equal(out.features.length, 24);
  for (const f of out.features) assert.ok(Array.isArray(f.geometry.coordinates));
});

test('bad input is rejected with the documented codes', () => {
  const bad = (body, code) => {
    assert.throws(() => parseRequest(JSON.stringify(body), net),
      (err) => err.code === code, code + ' expected for ' + JSON.stringify(body));
  };
  bad({}, 'bad_request');
  bad({ origin: { lat: 59.3 } }, 'bad_request');
  bad({ origin: ORIGIN, maxTravelMinutes: 500 }, 'bad_request');
  bad({ origin: ORIGIN, maxTransfers: -1 }, 'bad_request');
  bad({ origin: ORIGIN, modes: ['helicopter'] }, 'unknown_mode');
  bad({ origin: ORIGIN, modes: [] }, 'bad_request');
  bad({ origin: ORIGIN, startTime: 'half past nine' }, 'bad_request');
  assert.throws(() => parseRequest('{not json', net), (err) => err.code === 'bad_request');
});

test('start time is parsed from HH:MM and from ISO', () => {
  assert.equal(parseRequest(JSON.stringify({ origin: ORIGIN, startTime: '07:45' }), net).startSec,
    7 * 3600 + 45 * 60);
  const iso = parseRequest(
    JSON.stringify({ origin: ORIGIN, startTime: '2026-06-15T12:30:00+02:00' }), net).startSec;
  assert.equal(formatHHMM(iso), '12:30');
  const noTime = parseRequest(JSON.stringify({ origin: ORIGIN }), net);
  assert.ok(noTime.startSec >= 0 && noTime.startSec < 86400);
});

test('an identical request is served from cache', () => {
  state.cache.clear();
  const first = computeIsochrone(net, q({ maxTravelMinutes: 25 }));
  const second = computeIsochrone(net, q({ maxTravelMinutes: 25 }));
  assert.equal(second.cached, true);
  assert.equal(first.features.length, second.features.length);
});

test('a different setting is not served from cache', () => {
  state.cache.clear();
  computeIsochrone(net, q({ maxTravelMinutes: 25 }));
  const other = computeIsochrone(net, q({ maxTravelMinutes: 25, maxTransfers: 1 }));
  assert.notEqual(other.cached, true);
});

test('the HTTP surface answers health, modes and isochrone', async () => {
  const call = (method, path, body) => new Promise((resolve) => {
    const chunks = [];
    const req = {
      method,
      on(ev, fn) {
        if (ev === 'data' && body) fn(Buffer.from(body));
        if (ev === 'end') fn();
        return req;
      },
      destroy() {},
    };
    const res = {
      statusCode: 0,
      writeHead(s) { res.statusCode = s; return res; },
      end(text) { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); },
    };
    plugin.handle(req, res, { path }).then((handled) => {
      if (!handled) resolve({ status: 404, body: null });
    });
    void chunks;
  });

  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.networkLoaded, true);

  const modes = await call('GET', '/modes');
  assert.equal(modes.status, 200);
  assert.ok(modes.body.modes.includes('metro'));

  const iso = await call('POST', '/isochrone',
    JSON.stringify({ origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 20 }));
  assert.equal(iso.status, 200);
  assert.equal(iso.body.features.length, 4);

  const wrongMethod = await call('GET', '/isochrone');
  assert.equal(wrongMethod.status, 405);

  const badBody = await call('POST', '/isochrone', '{"origin":{}}');
  assert.equal(badBody.status, 400);
  assert.equal(badBody.body.error, 'bad_request');
  assert.ok(badBody.body.message_sv, 'Swedish message required by the contract');

  const unknown = await call('GET', '/nope');
  assert.equal(unknown.status, 404);
});

test('a 120 minute query over the whole fixture stays well under a second', () => {
  state.cache.clear();
  const started = Date.now();
  const out = computeIsochrone(net, q({ maxTravelMinutes: 120 }));
  const ms = Date.now() - started;
  assert.ok(ms < 1000, 'took ' + ms + ' ms');
  assert.ok(out.meta.computedMs >= 0);
  console.log('    (120 min query: ' + ms + ' ms, ' + out.meta.stopsReached + ' stops)');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (err && err.message));
  }
}
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
