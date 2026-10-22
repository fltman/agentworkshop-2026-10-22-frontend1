// Live regression test of marlin's engine with the request bodies the map apps send.
// Usage: node projects/vijay-team/e2e.js [baseUrl]
const BASE = process.argv[2] || 'https://frontend1.torget.bjarby.com';
const URL_ = BASE + '/t/marlin/isochrone';
const base = {
  origin: { lat: 59.3303, lon: 18.0586 }, startTime: null, maxTravelMinutes: 30, maxWaitMinutes: 7,
  maxTransfers: 3, modes: ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'],
  walking: { accessMinutes: 10, egressMinutes: 10, transferMinutes: 5 }, bandMinutes: 5,
};
let failed = 0;

async function run(name, over, expect) {
  const t0 = Date.now();
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, ...over }) });
  const body = await r.json().catch(() => ({}));
  const ms = Date.now() - t0;
  const bands = (body.features || []).length;
  let problem = null;
  if (r.status !== expect.status) problem = 'status ' + r.status + ' expected ' + expect.status;
  else if (expect.bands && bands !== expect.bands) problem = bands + ' bands, expected ' + expect.bands;
  else if (expect.error && !(body.message && body.message_sv)) problem = 'error lacks message and message_sv';
  else if (ms > (expect.maxMs || 2000)) problem = ms + ' ms is too slow';
  if (problem) failed++;
  console.log((problem ? 'FAIL ' : 'ok   ') + name + ' (' + r.status + ', ' + ms + ' ms, ' + bands + ' bands)' + (problem ? ': ' + problem : ''));
}

(async () => {
  await run('defaults', {}, { status: 200, bands: 6 });
  await run('60 min without bus', { maxTravelMinutes: 60, modes: ['metro', 'tram', 'train', 'commuter_rail', 'boat'] }, { status: 200, bands: 12 });
  await run('Kista', { origin: { lat: 59.403, lon: 17.944 } }, { status: 200, bands: 6 });
  await run('saturday', { startTime: '2026-11-07T10:00:00+01:00' }, { status: 200, bands: 6 });
  await run('sunday', { startTime: '2026-11-08T10:00:00+01:00' }, { status: 200, bands: 6 });
  await run('120 min', { maxTravelMinutes: 120 }, { status: 200, bands: 24 });
  await run('no modes', { modes: [] }, { status: 400, error: true });
  await run('missing origin', { origin: null }, { status: 400, error: true });
  await run('pin in the sea', { origin: { lat: 59.0, lon: 19.5 } }, { status: 422, error: true });
  await run('too restrictive', { maxTravelMinutes: 5, maxWaitMinutes: 0, maxTransfers: 0, modes: ['boat'], walking: { accessMinutes: 0, egressMinutes: 0, transferMinutes: 0 } }, { status: 422, error: true });
  console.log(failed ? failed + ' FAILED' : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
