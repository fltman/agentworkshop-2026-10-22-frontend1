#!/usr/bin/env node
// Usage: node preprocess-shapes.js <gtfs-dir> <out-dir>
// Writes <out-dir>/shapes.json.gz: simplified line geometry per route (name + mode), one line per direction.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const [gtfs, out] = process.argv.slice(2);
if (!gtfs || !out) {
  console.error('usage: node preprocess-shapes.js <gtfs-dir> <out-dir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const TOLERANCE_M = 20;

function splitCsv(line) {
  const r = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === ',' && !q) { r.push(cur); cur = ''; } else cur += ch;
  }
  r.push(cur);
  return r;
}

async function eachRow(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(gtfs, file)), crlfDelay: Infinity });
  let head = null;
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, '');
    if (!line) continue;
    const cols = splitCsv(line);
    if (!head) { head = cols; continue; }
    const row = {};
    for (let i = 0; i < head.length; i++) row[head[i]] = cols[i];
    fn(row);
  }
}

function modeOf(type, desc) {
  switch (type) {
    case '401': return 'metro';
    case '700': return 'bus';
    case '1000': return 'boat';
    case '100': return 'commuter_rail';
    case '900': return /Roslagsbanan|Saltsjöbanan/.test(desc) ? 'train' : 'tram';
    default: return 'bus';
  }
}

// Douglas-Peucker on an equirectangular projection around Stockholm, tolerance in metres.
function simplify(pts, tolM) {
  const kx = 111320 * Math.cos((59.33 * Math.PI) / 180);
  const ky = 111320;
  const P = pts.map(([lon, lat]) => [lon * kx, lat * ky]);
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    const [ax, ay] = P[a];
    const [bx, by] = P[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tolM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

(async () => {
  const routes = new Map();
  await eachRow('routes.txt', (r) => routes.set(r.route_id, { name: r.route_short_name, mode: modeOf(r.route_type, r.route_desc) }));

  // For every (route name, mode, direction) pick the shape used by the most trips.
  const counts = new Map();
  await eachRow('trips.txt', (r) => {
    const route = routes.get(r.route_id);
    if (!route || !r.shape_id) return;
    const key = `${route.mode}\t${route.name}\t${r.direction_id}`;
    if (!counts.has(key)) counts.set(key, new Map());
    const m = counts.get(key);
    m.set(r.shape_id, (m.get(r.shape_id) || 0) + 1);
  });
  const chosen = new Map();
  for (const [key, m] of counts) chosen.set(key, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  const needed = new Set(chosen.values());

  const raw = new Map();
  await eachRow('shapes.txt', (r) => {
    if (!needed.has(r.shape_id)) return;
    if (!raw.has(r.shape_id)) raw.set(r.shape_id, []);
    raw.get(r.shape_id).push([+r.shape_pt_sequence, +r.shape_pt_lon, +r.shape_pt_lat]);
  });

  const byRoute = new Map();
  for (const [key, shapeId] of chosen) {
    const pts = raw.get(shapeId);
    if (!pts || pts.length < 2) continue;
    pts.sort((a, b) => a[0] - b[0]);
    const line = simplify(pts.map((p) => [p[1], p[2]]), TOLERANCE_M).map(([lon, lat]) => [+lon.toFixed(5), +lat.toFixed(5)]);
    const [mode, name] = key.split('\t');
    const k = mode + '\t' + name;
    if (!byRoute.has(k)) byRoute.set(k, { name, mode, lines: [] });
    byRoute.get(k).lines.push(line);
  }
  const list = [...byRoute.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name, 'sv', { numeric: true }));
  const file = path.join(out, 'shapes.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ version: 1, routes: list }), { level: 9 }));
  const points = list.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.length, 0), 0);
  console.log('shapes', list.length, 'routes', points, 'points', (fs.statSync(file).size / 1e6).toFixed(2) + ' MB');
})();
