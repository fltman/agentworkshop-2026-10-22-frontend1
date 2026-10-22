// marlin CONTRACT v1.4 (PR 48, #build 520): excludeRoutes / excludeStops disruption what-if on POST /t/marlin/isochrone.
// vijay-team #build 521: after-midnight tail (GTFS 24:00+ carried into the next morning) -> 00:30 / 03:00 queries.
// Run: node tests/disruption.test.mjs [baseUrl]. Each part SKIPs on its own when it is not live; exit 1 only on FAIL.
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const L = '/t/marlin/isochrone';
const T = '2026-10-22T09:00:00+02:00';
let fails = 0;

const check = (name, cond, detail) => {
  if (cond) console.log('PASS', name);
  else { fails++; console.log('FAIL', name, detail === undefined ? '' : '-> ' + detail); }
};
const short = (v) => JSON.stringify(v)?.slice(0, 200);

async function call(body) {
  const t = Date.now();
  const res = await fetch(BASE + L, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t };
}
const stops = (r) => r.json?.meta?.stopsReached;
// Outer (cumulative) band disc count: a geometry proxy for reachable area.
const discs = (r) => (r.json?.features?.[0]?.geometry?.coordinates || []).length;

// Skarpnäck is the end of metro 17 and served by no other metro line, so closing 17 must cost reach.
const SKARPNACK = { lat: 59.2669, lon: 18.1333 };
const ODENPLAN = { lat: 59.3430, lon: 18.0497 };
const CENTRAL = { lat: 59.3309, lon: 18.0592 }; // T-Centralen

/* ---------- part 1: marlin excludeRoutes / excludeStops ---------- */
console.log('== marlin excludeRoutes / excludeStops (v1.4) ==');
const base = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30 });
const ex = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeRoutes: ['17'] });
const live = ex.status === 200 && ex.json?.meta?.excludedRoutes !== undefined;
if (!live) {
  console.log('SKIP disruption not live: excludeRoutes ignored, no meta.excludedRoutes.',
    `status ${ex.status}, stops base ${stops(base)} vs excl ${stops(ex)}, meta keys: ${Object.keys(ex.json?.meta || {}).join(',')}`);
} else {
  check('base 200', base.status === 200, base.status);
  check('meta.excludedRoutes echo {requested:1, matched:1}',
    ex.json.meta.excludedRoutes.requested === 1 && ex.json.meta.excludedRoutes.matched === 1, short(ex.json.meta.excludedRoutes));
  check('no meta.excludedStops when not sent', ex.json.meta.excludedStops === undefined, short(ex.json.meta.excludedStops));
  const pct = (100 * (stops(base) - stops(ex)) / stops(base)).toFixed(1);
  console.log(`INFO Skarpnäck 09:00 30 min: stops ${stops(base)} -> ${stops(ex)} (-${pct} %), outer discs ${discs(base)} -> ${discs(ex)}`);
  check('A/B: closing metro 17 shrinks stopsReached from Skarpnäck', stops(ex) < stops(base), `${stops(base)} -> ${stops(ex)}`);
  check('A/B: closing metro 17 cuts at least 10 % of stops', stops(ex) <= 0.9 * stops(base), `-${pct} %`);
  check('A/B: outer band never grows', discs(ex) <= discs(base), `${discs(base)} -> ${discs(ex)}`);

  // Unknown route name: contract says silently ignored, matched 0, result identical to baseline.
  const unk = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeRoutes: ['NoSuchLine999'] });
  check('unknown route -> 200 (no-op, not 400)', unk.status === 200, `${unk.status} ${short(unk.json)}`);
  check('unknown route -> meta.excludedRoutes {requested:1, matched:0}',
    unk.json?.meta?.excludedRoutes?.requested === 1 && unk.json?.meta?.excludedRoutes?.matched === 0, short(unk.json?.meta?.excludedRoutes));
  check('unknown route -> same stopsReached as baseline', stops(unk) === stops(base), `${stops(base)} vs ${stops(unk)}`);

  const mixed = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeRoutes: ['17', 'NoSuchLine999'] });
  check('mixed list -> {requested:2, matched:1}, same stops as 17 alone',
    mixed.json?.meta?.excludedRoutes?.requested === 2 && mixed.json?.meta?.excludedRoutes?.matched === 1 && stops(mixed) === stops(ex),
    `${short(mixed.json?.meta?.excludedRoutes)} stops ${stops(mixed)}`);

  // Over-limit: contract says max 50 each. 51 entries must be a 400, not a silent cut to 50.
  const many = Array.from({ length: 51 }, (_, i) => 'X' + i);
  const over = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeRoutes: many });
  check('excludeRoutes with 51 names -> 400 bad_request', over.status === 400 && over.json?.kind === 'bad_request',
    `${over.status} excludedRoutes ${short(over.json?.meta?.excludedRoutes)}`);
  const overS = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeStops: many });
  check('excludeStops with 51 entries -> 400 bad_request', overS.status === 400 && overS.json?.kind === 'bad_request',
    `${overS.status} excludedStops ${short(overS.json?.meta?.excludedStops)}`);
  const notArr = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, excludeRoutes: '17' });
  check('excludeRoutes as a string -> 400', notArr.status === 400, `${notArr.status}`);

  // excludeStops by name: close Odenplan from a pin at Odenplan.
  const ob = await call({ origin: ODENPLAN, startTime: T, maxTravelMinutes: 30 });
  const os = await call({ origin: ODENPLAN, startTime: T, maxTravelMinutes: 30, excludeStops: ['Odenplan'] });
  console.log(`INFO Odenplan 09:00 30 min, excludeStops Odenplan: stops ${stops(ob)} -> ${stops(os)}, echo ${short(os.json?.meta?.excludedStops)}`);
  check('excludeStops by name echoes matched >= 1', os.json?.meta?.excludedStops?.matched >= 1, short(os.json?.meta?.excludedStops));
  check('excludeStops Odenplan shrinks reach from Odenplan', stops(os) < stops(ob), `${stops(ob)} -> ${stops(os)}`);

  // Combined with arriveBy.
  const abB = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, arriveBy: true });
  const abE = await call({ origin: SKARPNACK, startTime: T, maxTravelMinutes: 30, arriveBy: true, excludeRoutes: ['17'] });
  console.log(`INFO arriveBy Skarpnäck deadline 09:00: stops ${stops(abB)} -> ${stops(abE)}`);
  check('arriveBy + excludeRoutes: meta.arriveBy true and echo', abE.json?.meta?.arriveBy === true && abE.json?.meta?.excludedRoutes?.matched === 1,
    short(abE.json?.meta));
  check('arriveBy + excludeRoutes: fewer stops than arriveBy alone', stops(abE) < stops(abB), `${stops(abB)} -> ${stops(abE)}`);
}

/* ---------- part 2: vijay-team after-midnight tail ---------- */
// Threshold: before the fix 00:30 and 03:00 at T-Centralen gave 27 stations (walk-reachable only). With the
// 24:00+ tail carried over, 00:30 still has last metros + night buses, so >= 150 (vijay-team says hundreds);
// 03:00 on a weekday has only night buses, so >= 60 (more than twice the broken 27). 09:00 is the sanity reference.
console.log('\n== vijay-team after-midnight tail (marlin, T-Centralen, 30 min) ==');
const NIGHT = [['00:30', 150], ['03:00', 60]];
const day = await call({ origin: CENTRAL, startTime: T, maxTravelMinutes: 30 });
const nights = [];
for (const [hhmm, min] of NIGHT) nights.push([hhmm, min, await call({ origin: CENTRAL, startTime: `2026-10-22T${hhmm}:00+02:00`, maxTravelMinutes: 30 })]);
console.log('INFO stopsReached:', `09:00 ${stops(day)},`, nights.map(([h, , r]) => `${h} ${stops(r)}`).join(', '));
if (nights.every(([, , r]) => stops(r) <= 30)) {
  console.log('SKIP after-midnight tail not live: night queries still at the broken ~27 level.');
} else {
  for (const [hhmm, min, r] of nights) {
    check(`${hhmm} 200`, r.status === 200, r.status);
    check(`${hhmm} stopsReached >= ${min}`, stops(r) >= min, stops(r));
    check(`${hhmm} below daytime (night is thinner)`, stops(r) < stops(day), `${stops(r)} vs ${stops(day)}`);
  }
}

console.log(`\n${fails} failure(s)`);
process.exit(fails ? 1 : 0);
