// node tests/destination.test.mjs - destination.js against captured mareri /journey answers plus synthetic cases.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const dir = new URL('../../../board/public/colony/tomfor/', import.meta.url);
const fx = (n) => JSON.parse(fs.readFileSync(new URL('fixtures/journey/' + n, import.meta.url), 'utf8'));

const ctx = { setTimeout, clearTimeout, AbortController };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('destination.js', dir), 'utf8').replace('(typeof window', '(typeof __x'), ctx);
const D = ctx.TomforDestination; await D.ready;
const d = (lang, j, o) => D.describeJourney(lang, j, o);

// en/sv keys identical
assert.deepStrictEqual(Object.keys(D.strings.en).sort(), Object.keys(D.strings.sv).sort());

// Real journey: walk 4 min -> metro 13 (08:44) -> walk 6 min, 13 min total, start 08:40.
const real = fx('gamlastan.json');
let r = d('en', real, { place: 'Gamla stan' });
assert.equal(r.kind, 'journey');
assert.equal(r.text, 'Gamla stan: 13 min, leave 08:40, 4 min walk then metro 13 then 6 min walk');
assert.match(r.srText, /Take metro 13 at 08:44 from T-Centralen to Gamla stan, 1 stop, 2 min\./);
assert.match(r.srText, /Wait 1 min\./); assert.match(r.srText, /Arrive 08:52, 13 min in total\.$/);
r = d('sv', real, { place: 'Gamla stan' });
assert.equal(r.text, 'Gamla stan: 13 min, åk 08:40, 4 min promenad och sedan tunnelbana 13 och sedan 6 min promenad');
assert.match(r.srText, /Ta tunnelbana 13 klockan 08:44 från T-Centralen till Gamla stan, 1 hållplats/);
assert.equal(d('en', real).text.split(':')[0], 'Your destination');
assert.equal(d('sv-SE', real).text.split(':')[0], 'Ditt resmål');

// Real walk-only journey
const walk = fx('walk-only.json');
assert.equal(d('en', walk, { place: 'Klarabergsgatan' }).text, 'Klarabergsgatan: 4 min walk, no transit needed');
assert.equal(d('sv', walk, { place: 'Klarabergsgatan' }).kind, 'walkOnly');

// Walk faster than the transit journey
r = d('en', real, { place: 'Gamla stan', walkOnlyMinutes: 12 });
assert.deepStrictEqual([r.kind, r.text], ['walkFaster', 'Gamla stan: faster to walk, 12 min']);
assert.equal(d('sv', real, { place: 'Gamla stan', walkOnlyMinutes: 20 }).kind, 'journey');

// Arrive-by: deadline from the request
r = d('en', real, { place: 'Gamla stan', request: { arriveBy: true, startTime: '2026-10-22T07:00:00Z' } });
assert.equal(r.text, 'Gamla stan: leave by 08:40 to arrive 09:00, 4 min walk then metro 13 then 6 min walk');
assert.equal(d('sv', real, { place: 'Slussen', arriveBy: true, deadline: '09:15' }).text.slice(0, 51), 'Slussen: åk senast 08:40 för att vara framme 09:15,');

// Synthetic: ISO times, bus without line, two rides, sub-minute walk legs dropped from the sentence
const syn = { startTime: '2026-10-22T06:30:00Z', arriveTime: '2026-10-22T06:58:00Z', totalMinutes: 27.6, legs: [
  { type: 'walk', minutes: 0.2, to: { name: 'Odenplan' } },
  { type: 'ride', mode: 'commuter_rail', line: '41', from: { name: 'Odenplan' }, to: { name: 'Stockholm City' }, depart: '2026-10-22T06:35:00Z', arrive: '06:38', minutes: 3, stops: 1, waitMinutes: 5 },
  { type: 'ride', mode: 'bus', line: null, from: { name: 'Stockholm City' }, to: { name: 'Slussen' }, depart: '06:45', arrive: '06:55', minutes: 10, stops: 4 },
  { type: 'walk', minutes: 3, to: { lat: 1, lon: 2 } }] };
assert.equal(d('en', syn, { place: 'Slussen' }).text, 'Slussen: 28 min, leave 08:35, commuter rail 41 then bus then 3 min walk');
assert.equal(d('sv', syn, { place: 'Slussen' }).text, 'Slussen: 28 min, åk 08:35, pendeltåg 41 och sedan buss och sedan 3 min promenad');
assert.match(d('en', syn, { place: 'Slussen' }).srText, /Walk 3 min to Slussen\. Arrive 08:58/);

// Real 404 not_reachable
const nr = { status: 404, ...fx('not-reachable.json') };
r = d('en', nr, { place: 'Södertälje', request: { maxTravelMinutes: 30 } });
assert.deepStrictEqual([r.kind, r.text], ['outOfReach', 'Södertälje is not within 30 min. Try a longer travel time or more transport types.']);
r = d('sv', nr, { place: 'Södertälje', maxTravelMinutes: 30, nearest: { name: 'Flemingsberg', minutes: 28 } });
assert.equal(r.text, 'Södertälje nås inte inom 30 min. Närmast du kommer är Flemingsberg (28 min). Prova en längre restid eller fler trafikslag.');
assert.equal(d('sv', nr).text.startsWith('Ingen resa hit inom tidsgränsen.'), true);

// Errors without errors.js: 5xx -> unavailable, 400 -> engine message, nothing -> unavailable
assert.equal(d('en', { status: 503, error: 'street_engine_unavailable', message: 'x' }).text, D.strings.en['dest.unavailable']);
assert.equal(d('sv', { status: 400, error: 'bad_request', message_sv: 'target.lat och target.lon krävs.' }).text, 'target.lat och target.lon krävs.');
assert.equal(d('en', null).kind, 'unavailable');
// With errors.js: codes go through errorMessage
D.use(await import(new URL('errors.js', dir)));
r = d('sv', { status: 422, error: 'no_stops_near_origin' });
assert.ok(r.text.length > 20 && r.kind === 'error', r.text);
assert.equal(d('en', { status: 500, error: 'internal' }).kind, 'unavailable');

// fetchJourney: body = request + target, origin override, error bodies rejected with status
let sent;
const fakeFetch = (status, body) => (url, init) => { sent = { url, body: JSON.parse(init.body) }; return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }); };
const j = await D.fetchJourney({ origin: { lat: 1, lon: 1 }, maxTravelMinutes: 30 }, { lat: '59.3', lon: '18.07' }, { fetch: fakeFetch(200, real), origin: { lat: 59.33, lon: 18.06 } });
assert.equal(j.totalMinutes, 13);
assert.deepStrictEqual(sent, { url: '/t/mareri/journey', body: { origin: { lat: 59.33, lon: 18.06 }, maxTravelMinutes: 30, target: { lat: 59.3, lon: 18.07 } } });
await assert.rejects(D.fetchJourney({}, { lat: 0, lon: 0 }, { fetch: fakeFetch(404, fx('not-reachable.json')) }), (e) => e.status === 404 && e.error === 'not_reachable');
assert.deepStrictEqual({ ...D.parseLatLon(' 59.325, 18.071 ') }, { label: '59.325, 18.071', lat: 59.325, lon: 18.071 });
assert.equal(D.parseLatLon('Gamla stan'), null);

for (const l of ['en', 'sv']) console.log(l, '|', d(l, real, { place: 'Gamla stan' }).text);
console.log('OK destination.js');
