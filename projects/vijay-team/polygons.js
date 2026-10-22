#!/usr/bin/env node
// Usage: node projects/vijay-team/polygons.js [baseUrl]
// Shape and size checks on marlin's isochrone bands: closed rings, coordinate order, nesting, empty bands, payload size.
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';

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
const ringArea = (r) => Math.abs(r.reduce((a, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + (x1 * y2 - x2 * y1); }, 0) / 2);

const CASES = [
  { name: 'T-Centralen 30', lat: 59.3317, lon: 18.0617, min: 30 },
  { name: 'T-Centralen 120', lat: 59.3317, lon: 18.0617, min: 120 },
  { name: 'Kista 60', lat: 59.4033, lon: 17.9444, min: 60 },
  { name: 'Sodertalje 60', lat: 59.1955, lon: 17.6253, min: 60 },
  { name: 'Vaxholm 60 (island pier)', lat: 59.4020, lon: 18.3510, min: 60 },
  { name: 'T-Centralen 30 metro only', lat: 59.3317, lon: 18.0617, min: 30, modes: ['metro'] },
  { name: 'T-Centralen 30 no transfers', lat: 59.3317, lon: 18.0617, min: 30, maxTransfers: 0 },
];

(async () => {
  let faults = 0;
  const fault = (c, m) => { faults++; console.log(`FAULT ${c.name}: ${m}`); };
  for (const c of CASES) {
    const body = {
      origin: { lat: c.lat, lon: c.lon }, startTime: '09:00', maxTravelMinutes: c.min,
      maxWaitMinutes: 7, maxTransfers: c.maxTransfers ?? 3, modes: c.modes,
      walking: { speedKmh: 4.8, accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 },
    };
    const t0 = Date.now();
    const r = await fetch(BASE + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip' }, body: JSON.stringify(body) });
    const text = await r.text();
    const ms = Date.now() - t0;
    if (!r.ok) { console.log(`${c.name}: HTTP ${r.status} ${text.slice(0, 120)}`); continue; }
    const fc = JSON.parse(text);
    const feats = [...fc.features].sort((a, b) => a.properties.toMinutes - b.properties.toMinutes);
    let rings = 0;
    for (const f of feats) {
      const mp = f.geometry.coordinates;
      for (const poly of mp) {
        for (const ring of poly) {
          rings++;
          const [a, b] = [ring[0], ring[ring.length - 1]];
          if (a[0] !== b[0] || a[1] !== b[1]) { fault(c, `open ring in band ${f.properties.toMinutes}`); break; }
          if (ring.length < 4) { fault(c, `ring with fewer than 4 points in band ${f.properties.toMinutes}`); break; }
          if (!(a[0] > 16 && a[0] < 20 && a[1] > 58 && a[1] < 60.5)) { fault(c, `coordinate outside Stockholm (lon,lat order?) ${a}`); break; }
        }
      }
    }
    // Nesting: sample outer-ring vertices of each band, they must lie inside the next band.
    let nestBad = 0;
    let nestTotal = 0;
    for (let i = 0; i < feats.length - 1; i++) {
      for (const poly of feats[i].geometry.coordinates.slice(0, 60)) {
        // Pull vertices slightly towards the centroid: shared cell edges would sit exactly on the outer boundary.
        const ring = poly[0];
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        for (const [vx, vy] of ring.slice(0, 6)) {
          const x = vx + (cx - vx) * 0.1;
          const y = vy + (cy - vy) * 0.1;
          nestTotal++;
          if (!inMulti(x, y, feats[i + 1].geometry.coordinates)) nestBad++;
        }
      }
    }
    const nestPct = nestTotal ? (100 * nestBad) / nestTotal : 0;
    if (nestPct > 2) fault(c, `${nestPct.toFixed(1)}% of sampled inner-band vertices lie outside the next band (not nested)`);
    const empty = feats.filter((f) => !f.geometry.coordinates.length).map((f) => f.properties.toMinutes);
    const kb = text.length / 1024;
    if (kb > 4096) fault(c, `payload ${kb.toFixed(0)} KB uncompressed, over 4 MB`);
    if (ms > 2000) fault(c, `answer took ${ms} ms, over the 2 s goal`);
    const area = feats.length ? feats[feats.length - 1].geometry.coordinates.reduce((a, p) => a + ringArea(p[0]), 0) : 0;
    console.log(`${c.name}: ${ms} ms, ${kb.toFixed(0)} KB, ${feats.length} bands, ${rings} rings, outer area ${(area * 111.32 * 111.32 * Math.cos(59.3 * Math.PI / 180)).toFixed(0)} km2, nesting miss ${nestPct.toFixed(1)}%${empty.length ? ', empty bands up to ' + empty.join(',') : ''}`);
  }
  console.log(faults ? `FAULTS (${faults})` : 'ALL GOOD');
})();
