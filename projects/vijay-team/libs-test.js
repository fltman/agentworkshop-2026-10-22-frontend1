// Tests the browser libraries (bands, diff, scenarios, housing) against live marlin and our stops.
// Usage: node libs-test.js [baseUrl]
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const dir = '../../board/public/colony/vijay-team/';
const Bands = require(dir + 'bands.js');
const Diff = require(dir + 'diff.js');
const Scen = require(dir + 'scenarios.js');
const Hous = require(dir + 'housing.js');
const C = require(dir + 'compare.js');

const base = {
  origin: { lat: 59.3303, lon: 18.0586 }, startTime: '08:00', maxTravelMinutes: 30, maxWaitMinutes: 7, maxTransfers: 3,
  modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'], walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5,
};
const iso = async (b) => (await fetch(BASE + '/t/marlin/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) fails++; };
const set = (fc, stops) => new Set(stops.filter((s) => C.stopMinutes(fc, s) !== null).map((s) => s.index));

(async () => {
  const stops = await (await fetch(BASE + '/t/vijay-team/stops?day=weekday')).json();

  // bands: slicing a 60 min answer must match a direct 30 min query
  const cache = Bands.cache(iso, 60);
  const big = await cache.get(base);
  const same = cache.get(base) === cache.get({ ...base, maxTravelMinutes: 10 });
  check(same, 'bands cache reuses one request per origin and settings');
  const sliced = set(Bands.cut(big, 30), stops);
  const direct = set(await iso(base), stops);
  const diffN = [...direct].filter((i) => !sliced.has(i)).length + [...sliced].filter((i) => !direct.has(i)).length;
  check(diffN <= direct.size * 0.01, 'sliced 60 -> 30 equals a direct 30 min answer within 1%', `${sliced.size} vs ${direct.size}, ${diffN} differ`);
  check(Bands.cut(big, 15).features.every((f) => f.properties.toMinutes <= 15) && Bands.cut(big, 15).meta.maxTravelMinutes === 15, 'cut keeps only bands up to the maximum');

  // diff: morning vs late evening, and weekday vs Sunday
  const night = await iso({ ...base, startTime: '23:00' });
  const morning = await iso(base);
  let t = Date.now();
  const d = Diff.stations(morning, night, stops);
  const g = Diff.grid(morning, night);
  check(d.lost.length > d.gained.length, 'night loses more stations than it gains vs morning', `lost ${d.lost.length}, gained ${d.gained.length}, slower ${d.slower.length}`);
  check(g.gainedKm2 + g.lostKm2 > 0 && g.cellM >= 500 && g.cells.length < 40000, 'grid diff has cells', `${g.cells.length} cells of ${g.cellM} m, lost ${g.lostKm2} km2, gained ${g.gainedKm2} km2, ${Date.now() - t} ms`);
  const sun = await iso({ ...base, day: 'sunday' });
  const ds = Diff.stations(morning, sun, stops);
  check(ds.lost.length + ds.slower.length > 0, 'Sunday is worse than weekday morning', `lost ${ds.lost.length}, slower ${ds.slower.length}`);
  check(Diff.stations(morning, morning, stops).lost.length === 0 && Diff.grid(morning, morning).cells.length === 0, 'identical answers give an empty diff');

  // round trip: a stay shrinks the workable set, and every listed place fits the window
  const rt0 = await C.roundTrip(iso, { ...base, maxTravelMinutes: 60 }, stops, { start: '17:00', returnBy: '19:00' });
  const rt30 = await C.roundTrip(iso, { ...base, maxTravelMinutes: 60 }, stops, { start: '17:00', returnBy: '19:00', stayMinutes: 30 });
  check(rt0.both.length > rt30.both.length && rt30.tooTight.length > 0, 'round trip: a 30 min stay removes places', `${rt0.both.length} -> ${rt30.both.length}`);
  check(rt30.both.every((r) => r.minutesOut + r.minutesBack + 30 <= rt30.windowMinutes), 'round trip: every listed place fits out + stay + back in the window');

  // scenarios
  const s = Scen.save('Home to work', { origin: base.origin, body: base, note: 'test' });
  check(Scen.list().length === 1 && Scen.get(s.id).name === 'Home to work', 'scenario saved and listed');
  check(Scen.rename(s.id, 'Home') && Scen.get(s.id).name === 'Home', 'scenario renamed');
  const exported = Scen.exportJSON();
  Scen.remove(s.id);
  check(Scen.list().length === 0 && Scen.importJSON(exported) === 1 && Scen.importJSON(exported) === 0, 'export, remove, import restores once and ignores duplicates');
  let threw = false;
  try { Scen.save('', { origin: base.origin, body: base }); } catch (e) { threw = true; }
  check(threw, 'invalid scenario is rejected');

  // housing (synthetic fixture generated from random stations, NOT real prices)
  const pick = stops.filter((_, i) => i % 40 === 0).slice(0, 100);
  const csv = 'lat,lon,price,label\n' + pick.map((p, i) => `${p.lat},${p.lon},${2000000 + i * 25000},${p.name.replace(/,/g, ' ')}`).join('\n');
  const homes = Hous.fromCSV(csv);
  const rows = Hous.analyze(homes, morning);
  const cheap = Hous.cheapestWithin(rows, 30, 5);
  check(homes.length === pick.length && rows.some((r) => r.minutes !== null), 'housing CSV parsed and matched to bands', `${homes.length} homes, ${rows.filter((r) => r.minutes !== null).length} in reach`);
  check(cheap.every((r, i) => r.minutes <= 30 && (i === 0 || cheap[i - 1].price <= r.price)), 'cheapestWithin is sorted and within the limit');
  check(Hous.byBand(rows).every((b) => b.count > 0 && b.medianPrice > 0), 'byBand medians computed');
  let bad = false;
  try { Hous.fromCSV('a,b\n1,2'); } catch (e) { bad = true; }
  check(bad, 'CSV without lat/lon/price is rejected');

  // permalink: round trip, validation, exports
  const P = require(dir + 'permalink.js');
  const dec = P.decode(P.url('https://x/y', { ...base, arriveBy: true }).split('#')[1]);
  check(dec && dec.origin.lat === 59.3303 && dec.startTime === '08:00' && dec.maxTravelMinutes === 30 && dec.arriveBy === true && dec.walking.accessMinutes === 10 && dec.modes.length === 6, 'permalink round trip keeps the search');
  check(P.decode('o=999,18') === null && P.decode('') === null, 'permalink rejects a missing or invalid origin');
  const hostile = P.decode('o=59.3,18.0&m=99999&modes=bus,<script>&a=1,2');
  check(hostile.maxTravelMinutes === undefined && hostile.walking === undefined && hostile.modes.join() === 'bus', 'permalink drops out-of-range and unknown values');
  const pcsv = P.stationsCSV(morning, stops).split('\n');
  check(pcsv.length > 100 && pcsv[0] === 'name,lat,lon,minutes', 'stations CSV export', `${pcsv.length - 1} rows`);

  // timelapse: frames over the day, area changes
  const T = require(dir + 'timelapse.js');
  check(T.times('05:00', '07:00', 30).join() === '05:00,05:30,06:00,06:30,07:00', 'timelapse time steps');
  const tl = await T.frames(iso, { ...base, maxTravelMinutes: 20 }, { from: '05:00', to: '23:00', stepMinutes: 120 });
  const ser = T.series(tl, stops);
  check(tl.length === 10 && tl.every((f, i) => f && f.time === T.times('05:00', '23:00', 120)[i]), 'timelapse frames come back in order', ser.map((x) => x.time + ':' + x.stations).join(' '));
  check(Math.max(...ser.map((x) => x.stations)) > Math.min(...ser.map((x) => x.stations)), 'reachable area varies through the day');

  // last way home: T-Centralen to Kista-ish point, result must verify
  const L = require(dir + 'lasthome.js');
  const home = { lat: 59.4032, lon: 17.9444 };
  const lh = await L.find(iso, { ...base, maxTravelMinutes: 60 }, { home, after: '18:00', latest: '23:59' });
  check(lh.lastStart !== null, 'last way home found', `${lh.lastStart}, ${lh.minutes} min, ${lh.calls} calls`);
  if (lh.lastStart) {
    const [h, m] = lh.lastStart.split(':').map(Number);
    const later = `${String(Math.floor((h * 60 + m + 1) / 60)).padStart(2, '0')}:${String((h * 60 + m + 1) % 60).padStart(2, '0')}`;
    const ok = C.stopMinutes(await iso({ ...base, maxTravelMinutes: 60, startTime: lh.lastStart }), home) !== null;
    const next = (h * 60 + m + 1) > 1439 || C.stopMinutes(await iso({ ...base, maxTravelMinutes: 60, startTime: later }), home) === null;
    check(ok && next, 'leaving at lastStart works and one minute later does not');
  }

  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
