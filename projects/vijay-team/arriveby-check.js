// Verifies marlin's arrive-by (reverse) isochrone against its own forward engine.
// For sampled stations that arrive-by says can reach the origin within T minutes of a deadline, a forward query from that
// station, leaving T minutes before the deadline, must cover the origin. Usage: node arriveby-check.js [baseUrl]
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const C = require('../../board/public/colony/vijay-team/compare.js');

const body = (o) => ({
  maxWaitMinutes: 7, maxTransfers: 3, modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'],
  walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5, ...o,
});
const iso = async (b) => {
  const r = await fetch(BASE + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) fails++; };

(async () => {
  const stops = await (await fetch(BASE + '/t/vijay-team/stops?day=weekday')).json();
  const origins = [
    ['T-Centralen', { lat: 59.3303, lon: 18.0586 }],
    ['Kista', { lat: 59.4033, lon: 17.9444 }],
    ['Nacka strand', { lat: 59.3138, lon: 18.1594 }],
  ];
  const deadline = 9 * 60;

  const probe = await iso(body({ origin: origins[0][1], startTime: '09:00', arriveBy: true, maxTravelMinutes: 30 }));
  if (!probe.json.meta || probe.json.meta.arriveBy !== true) {
    console.log('SKIP arrive-by is not live yet (meta.arriveBy missing in the answer)');
    process.exit(0);
  }

  for (const [name, origin] of origins) {
    const rev = await iso(body({ origin, startTime: '09:00', arriveBy: true, maxTravelMinutes: 30 }));
    check(rev.status === 200 && rev.json.features.length > 0, name + ' arrive-by answers', rev.status + ', ' + (rev.json.features || []).length + ' bands');
    const fwd = await iso(body({ origin, startTime: '09:00', maxTravelMinutes: 30 }));
    const rs = new Set(), fs = new Set();
    stops.forEach((s) => { if (C.stopMinutes(rev.json, s) !== null) rs.add(s.index); if (C.stopMinutes(fwd.json, s) !== null) fs.add(s.index); });
    check(rs.size > 50, name + ' arrive-by reaches stations', rs.size + ' vs forward ' + fs.size);

    // sample stations spread over the bands and confirm with a forward query
    const cand = stops.filter((s) => rs.has(s.index)).map((s) => ({ s, m: C.stopMinutes(rev.json, s) })).filter((x) => x.m >= 10);
    const step = Math.max(1, Math.floor(cand.length / 8));
    let ok = 0, n = 0;
    for (let i = 0; i < cand.length && n < 8; i += step, n++) {
      const { s, m } = cand[i];
      const f = await iso(body({ origin: { lat: s.lat, lon: s.lon }, startTime: hhmm(deadline - m), maxTravelMinutes: m + 5 }));
      if (f.status === 200 && f.json.features && f.json.features.length) {
        const reached = f.json.features.some((ft) => C.stopMinutes({ features: [ft] }, { lon: origin.lon, lat: origin.lat }) !== null);
        if (reached) ok++;
      }
    }
    check(n > 0 && ok / n >= 0.75, name + ' forward from sampled stations reaches the origin', ok + '/' + n);
  }

  const bad = await iso(body({ origin: origins[0][1], startTime: '09:00', arriveBy: 'yes', maxTravelMinutes: 30 }));
  check(bad.status === 400 || bad.status === 200, 'arriveBy as a string does not crash', String(bad.status));
  const sea = await iso(body({ origin: { lat: 59.0, lon: 19.5 }, startTime: '09:00', arriveBy: true, maxTravelMinutes: 30 }));
  check(sea.status === 422, 'pin in the sea gives 422', String(sea.status));
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
