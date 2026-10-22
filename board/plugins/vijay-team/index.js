const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, 'data');
const DAY_TYPES = ['weekday', 'saturday', 'sunday'];
const cache = {};

function load(type) {
  if (!cache[type]) {
    const gz = fs.readFileSync(path.join(DATA, `network-${type}.json.gz`));
    cache[type] = { gz, net: JSON.parse(zlib.gunzipSync(gz)) };
  }
  return cache[type];
}

function dayTypeOf(q) {
  if (q.get('day') && DAY_TYPES.includes(q.get('day'))) return q.get('day');
  const d = new Date().getDay();
  return d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

module.exports = {
  init() {
    DAY_TYPES.forEach(load);
  },
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    const p = ctx.path.replace(/^\/+|\/+$/g, '');

    if (p === 'network') {
      const { gz } = load(dayTypeOf(q));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600' });
      res.end(gz);
      return true;
    }
    if (p === 'meta') {
      const out = {};
      for (const t of DAY_TYPES) {
        const { net } = load(t);
        out[t] = { date: net.date, generated: net.generated, stopCount: net.stops.length, tripCount: net.trips.length };
      }
      return json(res, 200, out);
    }
    if (p === 'stops') {
      const { net } = load(dayTypeOf(q));
      let list = net.stops.map((s, i) => ({ index: i, ...s }));
      const bbox = (q.get('bbox') || '').split(',').map(Number);
      if (bbox.length === 4 && bbox.every(Number.isFinite)) {
        const [minLon, minLat, maxLon, maxLat] = bbox;
        list = list.filter((s) => s.lon >= minLon && s.lon <= maxLon && s.lat >= minLat && s.lat <= maxLat);
      }
      const modes = (q.get('modes') || '').split(',').filter(Boolean);
      if (modes.length) list = list.filter((s) => s.modes.some((m) => modes.includes(m)));
      return json(res, 200, list);
    }
    return false;
  },
};
