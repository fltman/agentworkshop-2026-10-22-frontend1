// mareri #build 488: POST /t/mareri/isochrone with arriveBy:true (marlin CONTRACT v1.3 shape, meta.deadline),
// street-based reverse scan. Cross-checked against marlin arrive-by for the same request.
// Run: node tests/arriveby-mareri.test.mjs [baseUrl]. Exit 0 with SKIP when arriveBy is not live (flag ignored).
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const M = '/t/mareri/isochrone', L = '/t/marlin/isochrone';
const DEADLINE = '2026-10-22T09:00:00+02:00';
let fails = 0;

const check = (name, cond, detail) => {
  if (cond) console.log('PASS', name);
  else { fails++; console.log('FAIL', name, detail === undefined ? '' : '-> ' + detail); }
};
const short = (v) => JSON.stringify(v)?.slice(0, 200);

async function call(path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t };
}

const base = { origin: { lat: 59.3313, lon: 18.0593 }, startTime: DEADLINE, maxTravelMinutes: 30 };
const bands = (r) => (r.json?.features || []).map((x) => x.properties.stops);
const sig = (r) => JSON.stringify((r.json?.features || []).map((x) => [x.properties.stops, x.geometry?.coordinates]));

const ab = await call(M, { ...base, arriveBy: true });
if (ab.status === 404) { console.log('SKIP mareri /isochrone 404'); process.exit(0); }
if (ab.status === 200 && ab.json?.meta?.arriveBy !== true) {
  console.log('SKIP mareri arrive-by not live (meta.arriveBy missing, flag ignored). algorithm:', ab.json?.meta?.algorithm,
    '| meta.startTime', ab.json?.meta?.startTime, '| deadline', ab.json?.meta?.deadline);
  process.exit(0);
}

console.log('== mareri arrive-by ==');
check('arriveBy 200', ab.status === 200, `${ab.status} ${short(ab.json ?? ab.text)}`);
if (ab.status !== 200) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log('INFO latency ms:', ab.ms, '| algorithm:', ab.json.meta.algorithm, '| walkingModel:', ab.json.meta.walkingModel);
const j = ab.json, f = j.features || [];
check('FeatureCollection, 6 bands', j.type === 'FeatureCollection' && f.length === 6, `${j.type} ${f.length}`);
check('latency < 5000ms', ab.ms < 5000, ab.ms);
check('meta.arriveBy true', j.meta.arriveBy === true, short(j.meta.arriveBy));
check('meta.deadline echoed with offset', j.meta.deadline === DEADLINE, short(j.meta.deadline));
check('meta.startTime not echoed (marlin v1.3 shape)', j.meta.startTime === undefined, short(j.meta.startTime));
check('meta budget/bands', j.meta.maxTravelMinutes === 30 && j.meta.bandMinutes === 5 && j.meta.cumulativeBands === true, short(j.meta));
check('bands outermost first, bandIndex 6..1', f.every((x, i) => x.properties.toMinutes === 30 - i * 5 && x.properties.fromMinutes === 25 - i * 5 && x.properties.bandIndex === 6 - i), short(f.map((x) => [x.properties.fromMinutes, x.properties.toMinutes])));
check('bands nested (stops non-increasing inward)', f.every((x, i) => i === 0 || (x.properties.stops ?? 0) <= (f[i - 1].properties.stops ?? 0)), short(bands(ab)));
check('geometry MultiPolygon [lon,lat]', f.every((x) => x.geometry?.type === 'MultiPolygon') && (() => { const c = f[0]?.geometry.coordinates[0]?.[0]?.[0]; return !c || (c[0] > 17 && c[0] < 19.5 && c[1] > 58.5 && c[1] < 60.5); })(), short(f[0]?.geometry?.type));
check('outermost band has area', (f[0]?.geometry?.coordinates?.length ?? 0) > 0, 'empty');
check('meta.walkingModel street', j.meta.walkingModel === 'street', short(j.meta.walkingModel));

// A/B: same request depart-at vs arrive-by must move a metric.
const fw = await call(M, base);
check('A/B depart-at meta.arriveBy not true', fw.json?.meta?.arriveBy !== true, short(fw.json?.meta?.arriveBy));
check('A/B arrive-by differs from depart-at', sig(ab) !== sig(fw), 'identical features: arriveBy ignored?');
console.log('INFO A/B stopsReached depart-at', fw.json?.meta?.stopsReached, 'arrive-by', j.meta.stopsReached, '| bands fw', short(bands(fw)), 'ab', short(bands(ab)));

const dl = await call(M, { origin: base.origin, deadline: DEADLINE, maxTravelMinutes: 30, arriveBy: true });
check('deadline alias accepted and echoed', dl.status === 200 && dl.json?.meta?.deadline === DEADLINE, `${dl.status} ${short(dl.json?.meta ?? dl.text)}`);

// Cross-check marlin (straight-line walking) for the same request: same shape, similar order of magnitude.
console.log('\n== cross-check marlin arrive-by ==');
const ml = await call(L, { ...base, arriveBy: true });
check('marlin arriveBy 200 + meta.arriveBy', ml.status === 200 && ml.json?.meta?.arriveBy === true, `${ml.status} ${short(ml.json?.meta ?? ml.text)}`);
if (ml.status === 200) {
  const keys = (r) => (r.json?.features || []).map((x) => [x.properties.fromMinutes, x.properties.toMinutes, x.properties.bandIndex]);
  check('same band layout as marlin', JSON.stringify(keys(ab)) === JSON.stringify(keys(ml)), `${short(keys(ab))} vs ${short(keys(ml))}`);
  check('same deadline echo as marlin', ml.json.meta.deadline === j.meta.deadline, `${ml.json.meta.deadline} vs ${j.meta.deadline}`);
  const a = j.meta.stopsReached, b = ml.json.meta.stopsReached, ratio = a / b;
  check('stopsReached same order of magnitude (0.33..3x marlin)', ratio >= 0.33 && ratio <= 3, `mareri ${a} marlin ${b} ratio ${ratio.toFixed(2)}`);
  console.log('INFO stopsReached mareri', a, 'marlin', b, 'ratio', ratio.toFixed(2), '| bands mareri', short(bands(ab)), 'marlin', short(bands(ml)));
}

// Contract: arriveBy is boolean. Same fault reported to marlin in #build 483.
console.log('\n== bad arriveBy types ==');
for (const [path, who] of [[M, 'mareri'], [L, 'marlin']]) {
  for (const v of ['false', 'yes', 1]) {
    const r = await call(path, { ...base, arriveBy: v });
    const ok = r.status === 400 && r.json?.error === 'bad_request' && !!r.json?.message && !!r.json?.message_sv;
    if (who === 'mareri') check(`mareri arriveBy ${JSON.stringify(v)} -> 400 bad_request + message_sv`, ok, `${r.status} ${short(r.json?.meta?.arriveBy ?? r.json)}`);
    else console.log(`INFO marlin arriveBy ${JSON.stringify(v)} -> ${r.status}${ok ? ' (fixed since #483)' : ' (still open from #483)'} meta.arriveBy=${r.json?.meta?.arriveBy}`);
  }
}

console.log(`\n${fails} failure(s)`);
process.exit(fails ? 1 : 0);
