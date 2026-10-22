#!/usr/bin/env node
// Reference reachability check. Usage: node projects/vijay-team/crosscheck.js [baseUrl] [--limit-stops]
// Computes earliest arrival at every station from a few origins with a plain round-based scan over our own
// connections, then checks that marlin's isochrone polygons cover every station we find reachable.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://frontend1.torget.bjarby.com';
const DIR = path.join(__dirname, '..', '..', 'board', 'plugins', 'vijay-team', 'artifacts');
const read = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, n + '.json.gz'))));

const net = read('network-weekday');
const c = read('connections-weekday');
const N = net.stops.length;
const order = Uint32Array.from({ length: c.from.length }, (_, i) => i).sort((a, b) => c.dep[a] - c.dep[b]);
const TRIPS = c.trip.reduce((m, x) => (x > m ? x : m), 0) + 1;
const walkFrom = Array.from({ length: N }, () => []);
for (const t of net.transfers) walkFrom[t.from].push(t);

function reach({ lat, lon, startSec, maxTravel, maxWait, maxTransfers, accessMin, transferMin, speed }) {
  const INF = 1e9;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let prev = new Array(N).fill(INF);
  net.stops.forEach((s, i) => {
    const d = Math.hypot((s.lat - lat) * 111320, (s.lon - lon) * 111320 * cosLat);
    const sec = d / speed;
    if (sec <= accessMin * 60) prev[i] = startSec + sec;
  });
  const best = prev.slice();
  const limit = startSec + maxTravel * 60;
  for (let k = 1; k <= maxTransfers + 1; k++) {
    const cur = prev.slice();
    const onTrip = new Uint8Array(TRIPS);
    for (const i of order) {
      if (c.dep[i] > limit) break;
      const f = c.from[i];
      let ok = onTrip[c.trip[i]] === 1;
      if (!ok && prev[f] <= c.dep[i]) ok = k === 1 || c.dep[i] - prev[f] <= maxWait * 60;
      if (!ok) continue;
      onTrip[c.trip[i]] = 1;
      if (c.arr[i] < cur[c.to[i]]) cur[c.to[i]] = c.arr[i];
    }
    for (let s = 0; s < N; s++) {
      if (cur[s] >= INF) continue;
      for (const w of walkFrom[s]) {
        if (w.walkSec <= transferMin * 60 && cur[s] + w.walkSec < cur[w.to]) cur[w.to] = cur[s] + w.walkSec;
      }
    }
    for (let s = 0; s < N; s++) if (cur[s] < best[s]) best[s] = cur[s];
    prev = cur;
  }
  const out = [];
  best.forEach((t, i) => { if (t <= limit) out.push({ i, min: (t - startSec) / 60 }); });
  return out;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inMulti = (x, y, mp) => mp.some((poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h)));

const ORIGINS = [
  { name: 'T-Centralen', lat: 59.3317, lon: 18.0617 },
  { name: 'Kista', lat: 59.4033, lon: 17.9444 },
  { name: 'Nacka strand', lat: 59.3126, lon: 18.1626 },
];

(async () => {
  let failures = 0;
  for (const o of ORIGINS) {
    for (const maxTravel of [30, 60]) {
      const p = { lat: o.lat, lon: o.lon, startSec: 9 * 3600, maxTravel, maxWait: 7, maxTransfers: 3, accessMin: 10, transferMin: 5, speed: 4.8 / 3.6 };
      // Stations reached in the last minute have no time left for egress, so a polygon may legitimately miss them.
      const mine = reach(p).filter((x) => x.min <= maxTravel - 1);
      const body = {
        origin: { lat: o.lat, lon: o.lon },
        startTime: '09:00',
        maxTravelMinutes: maxTravel,
        maxWaitMinutes: 7,
        maxTransfers: 3,
        walking: { speedKmh: 4.8, accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 },
      };
      const r = await fetch(BASE + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { console.log(`${o.name} ${maxTravel}min: marlin HTTP ${r.status}`); failures++; continue; }
      const fc = await r.json();
      const bands = [...fc.features].sort((a, b) => a.properties.toMinutes - b.properties.toMinutes);
      let missing = 0;
      const examples = [];
      for (const s of mine) {
        const st = net.stops[s.i];
        const band = bands[bands.length - 1];
        const ok = band && inMulti(st.lon, st.lat, band.geometry.coordinates);
        if (!ok) { missing++; if (examples.length < 3) examples.push(`${st.name} (${s.min.toFixed(0)} min)`); }
      }
      const pct = mine.length ? (100 * (mine.length - missing)) / mine.length : 100;
      const flag = pct < 95 ? 'DIFF' : 'ok';
      if (flag === 'DIFF') failures++;
      console.log(`${flag} ${o.name} ${maxTravel}min: we reach ${mine.length} stations, marlin covers ${pct.toFixed(1)}% (marlin source ${fc.meta.source}, stopsReached ${fc.meta.stopsReached})${examples.length ? ' e.g. ' + examples.join(', ') : ''}`);
    }
  }
  console.log(failures ? `DIFFERENCES (${failures})` : 'ALL CONSISTENT');
})();
