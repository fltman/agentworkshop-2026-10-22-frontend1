#!/usr/bin/env node
// Usage: node preprocess.js <gtfs-dir> <out-dir>
// Builds one compact network per day type (weekday, saturday, sunday) from an unzipped SL GTFS feed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const [gtfs, out] = process.argv.slice(2);
if (!gtfs || !out) {
  console.error('usage: node preprocess.js <gtfs-dir> <out-dir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

function splitCsv(line) {
  const r = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { r.push(cur); cur = ''; } else cur += c;
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

const hms = (s) => {
  const [h, m, x] = s.split(':').map(Number);
  return h * 3600 + m * 60 + x;
};

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

const dayTypes = { weekday: 2, saturday: 6, sunday: 0 }; // representative JS weekday (Tue, Sat, Sun)
const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  const routes = new Map();
  await eachRow('routes.txt', (r) => routes.set(r.route_id, { name: r.route_short_name, mode: modeOf(r.route_type, r.route_desc) }));

  const stopRows = new Map();
  await eachRow('stops.txt', (r) => stopRows.set(r.stop_id, r));
  const station = (id) => {
    const s = stopRows.get(id);
    return s && s.parent_station ? s.parent_station : id;
  };

  const calendar = [];
  await eachRow('calendar.txt', (r) => calendar.push(r));
  const exceptions = new Map();
  await eachRow('calendar_dates.txt', (r) => {
    const k = r.date;
    if (!exceptions.has(k)) exceptions.set(k, []);
    exceptions.get(k).push(r);
  });
  const dates = calendar.flatMap((c) => [c.start_date, c.end_date]).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  const tripsRaw = new Map();
  const wanted = {};
  const servicesFor = {};
  // Representative dates: first matching weekday at least 7 days after today and within the feed.
  const today = new Date();
  for (const [type, wd] of Object.entries(dayTypes)) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));
    while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1);
    if (ymd(d) > last) { d.setTime(Date.parse(first.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'))); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); }
    const date = ymd(d);
    const active = new Set();
    for (const c of calendar) {
      if (c.start_date <= date && date <= c.end_date && c[dayNames[wd]] === '1') active.add(c.service_id);
    }
    for (const e of exceptions.get(date) || []) {
      if (e.exception_type === '1') active.add(e.service_id);
      else active.delete(e.service_id);
    }
    servicesFor[type] = { date, active };
  }

  await eachRow('trips.txt', (r) => {
    const types = Object.keys(dayTypes).filter((t) => servicesFor[t].active.has(r.service_id));
    if (types.length) tripsRaw.set(r.trip_id, { route: r.route_id, types, stops: [], times: [] });
  });

  await eachRow('stop_times.txt', (r) => {
    const t = tripsRaw.get(r.trip_id);
    if (!t) return;
    if (r.pickup_type === '1' && r.drop_off_type === '1') return;
    t.stops.push(station(r.stop_id));
    t.times.push(hms(r.departure_time || r.arrival_time));
  });

  // Station table, only stations that are served.
  const used = new Set();
  for (const t of tripsRaw.values()) for (const s of t.stops) used.add(s);
  const stationIds = [...used].sort();
  const idx = new Map(stationIds.map((id, i) => [id, i]));
  const stationModes = stationIds.map(() => new Set());
  const stations = stationIds.map((id) => {
    const s = stopRows.get(id);
    return { id, name: s.stop_name, lat: +(+s.stop_lat).toFixed(5), lon: +(+s.stop_lon).toFixed(5) };
  });

  // Walking transfers: GTFS transfers (station level) plus anything within 300 m.
  const walk = new Map();
  const addWalk = (a, b, sec) => {
    if (a === b) return;
    const k = a + ':' + b;
    if (!walk.has(k) || walk.get(k) > sec) walk.set(k, sec);
  };
  await eachRow('transfers.txt', (r) => {
    const a = idx.get(station(r.from_stop_id));
    const b = idx.get(station(r.to_stop_id));
    if (a === undefined || b === undefined || r.from_trip_id) return;
    addWalk(a, b, Math.max(60, +r.min_transfer_time || 120));
  });
  const grid = new Map();
  const cell = (lat, lon) => Math.floor(lat / 0.003) + ',' + Math.floor(lon / 0.006);
  stations.forEach((s, i) => {
    const k = cell(s.lat, s.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const rad = Math.PI / 180;
  stations.forEach((s, i) => {
    const cy = Math.floor(s.lat / 0.003);
    const cx = Math.floor(s.lon / 0.006);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(cy + dy + ',' + (cx + dx)) || []) {
          if (j === i) continue;
          const o = stations[j];
          const dLat = (o.lat - s.lat) * 111320;
          const dLon = (o.lon - s.lon) * 111320 * Math.cos(s.lat * rad);
          const dist = Math.hypot(dLat, dLon);
          if (dist <= 300) addWalk(i, j, Math.round(dist / 1.3));
        }
      }
    }
  });
  const transfers = [...walk].map(([k, sec]) => {
    const [a, b] = k.split(':').map(Number);
    return [a, b, sec];
  });

  for (const type of Object.keys(dayTypes)) {
    const trips = [];
    const modes = stationModes.map(() => new Set());
    for (const t of tripsRaw.values()) {
      if (!t.types.includes(type) || t.stops.length < 2) continue;
      const route = routes.get(t.route);
      const sIdx = t.stops.map((s) => idx.get(s));
      sIdx.forEach((i) => modes[i].add(route.mode));
      trips.push({ route: route.name, mode: route.mode, stops: sIdx, times: t.times });
    }
    const net = {
      version: 1,
      dayType: type,
      date: servicesFor[type].date,
      generated: new Date().toISOString(),
      stops: stations.map((s, i) => ({ ...s, modes: [...modes[i]] })),
      trips,
      transfers: transfers.map(([from, to, walkSec]) => ({ from, to, walkSec })),
    };
    const file = path.join(out, `network-${type}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(net), { level: 9 }));
    console.log(type, servicesFor[type].date, 'trips', trips.length, 'stops', stations.length, 'transfers', transfers.length, (fs.statSync(file).size / 1e6).toFixed(1) + ' MB');
  }
})();
