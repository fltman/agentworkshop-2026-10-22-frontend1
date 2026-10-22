/**
 * Pre-PR integration drift check.
 *
 * Every defect we shipped today came from a boundary, not from our algorithm:
 * vijay-team renamed data/ to artifacts/ and we silently fell back to a 39-stop
 * fixture, three teams sent three field spellings, and a 120-minute answer was
 * 29 MB. Unit tests passed through all of it, because unit tests only ask
 * whether we are consistent with ourselves.
 *
 * This asks the opposite question: are we still consistent with everybody else?
 * Run it before every PR.
 *
 *   node projects/marlin/check-integration.mjs
 */
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const plugin = require('../../board/plugins/marlin/index.js');

const ORIGIN = { lat: 59.3326, lon: 18.0649 }; // T-Centralen

// vijay-team's independent reference calculator, posted in #build [58].
const VIJAY_REFERENCE = [
  { minutes: 30, stations: 1189 },
  { minutes: 60, stations: 2871 },
];
const REFERENCE_TOLERANCE = 0.15;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const fail = (msg) => { throw new Error(msg); };

plugin.init({ dataDir: '/tmp/marlin-integration-check' });
const { computeIsochrone, parseRequest } = plugin._internals;

const run = (body) => computeIsochrone(parseRequest(JSON.stringify(body)));

check('we are on real SL data, not the fixture', () => {
  const out = run({ origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 15 });
  if (out.meta.source === 'fixture') {
    fail('running on the FIXTURE. vijay-team\'s artifacts were not found - ' +
         'have they renamed the folder again? Check board/plugins/vijay-team/.');
  }
  return out.meta.source + ', ' + out.meta.dataVersion;
});

check('the network is the full one (6038 stops, not 39)', () => {
  const net = plugin._internals.state.store.get('weekday');
  if (net.stops.length < 5000) {
    fail('only ' + net.stops.length + ' stops loaded, expected about 6038.');
  }
  if (net.connectionCount < 500000) {
    fail('only ' + net.connectionCount + ' connections, expected about 644k.');
  }
  return net.stops.length + ' stops, ' + net.connectionCount + ' connections' +
    (net.realArrivals ? ', real arrivals' : ', DERIVED arrivals');
});

check('all three teams\' field spellings still parse to the same query', () => {
  const ours = run({
    origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 45, maxTransfers: 2,
  });
  const mareri = run({
    origin: ORIGIN, start_time: '09:00', max_travel_min: 45, max_transfers: 2,
  });
  const filbac = run({
    origin: ORIGIN, startTime: '09:00', maxTravelMin: 45, maxTransfers: 2,
  });
  const n = (o) => o.meta.stopsReached;
  if (n(ours) !== n(mareri) || n(ours) !== n(filbac)) {
    fail('same journey, different answers: ours ' + n(ours) +
         ', mareri spelling ' + n(mareri) + ', filbac spelling ' + n(filbac));
  }
  return 'all three agree on ' + n(ours) + ' stops';
});

check('mareri\'s error vocabulary still comes back', () => {
  try {
    run({ origin: { lat: 58.0, lon: 20.5 } });
    fail('a pin in the Baltic returned 200.');
  } catch (err) {
    if (err.code !== 'no_stops_near_origin') fail('unexpected code ' + err.code);
    return 'kind=no_routes for an unreachable pin';
  }
});

check('a two hour answer still fits on a phone connection', () => {
  const out = run({ origin: ORIGIN, startTime: '09:00', maxTravelMinutes: 120 });
  const packed = gzipSync(Buffer.from(JSON.stringify(out), 'utf8'), { level: 6 }).length;
  const mb = packed / 1048576;
  if (mb > 1.6) fail(mb.toFixed(2) + ' MB gzipped, ceiling is 1.6 MB.');
  return mb.toFixed(2) + ' MB gzipped';
});

check('we are close to vijay-team\'s independent reference', () => {
  const notes = [];
  for (const { minutes, stations } of VIJAY_REFERENCE) {
    const out = run({
      origin: ORIGIN, startTime: '09:00', maxTravelMinutes: minutes,
      maxTransfers: 3, maxWaitMinutes: 7,
    });
    const got = out.meta.stopsReached;
    const gap = (got - stations) / stations;
    notes.push(minutes + ' min: ' + got + ' vs ' + stations +
      ' (' + (gap * 100).toFixed(1) + '%)');
    if (Math.abs(gap) > REFERENCE_TOLERANCE) {
      fail('drifted from vijay-team\'s reference at ' + minutes + ' min: ' +
           got + ' vs ' + stations + '. Ask them to rerun crosscheck.js.');
    }
  }
  return notes.join('; ');
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    const detail = fn();
    console.log('  ok   ' + name + (detail ? '\n         ' + detail : ''));
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n         ' + (err && err.message));
  }
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' integration checks passed');
process.exit(failed ? 1 : 0);
