// Walk-mode tests for board/public/colony/tomfor/walk-mode.js.
// node tests/walk-mode.test.mjs          -> offline, replays tests/fixtures/walk/live-capture.json
// node tests/walk-mode.test.mjs --live   -> same invariants against the live gateway and mareri /walk
// Invariants: outermost first, cumulative edges, meta.walkOnly, source street <= 30 min / estimate beyond,
// nesting (every band contains the next inner band), including the 30-min seam.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const LIVE = process.argv.includes('--live');
const BASE = process.env.BASE || 'https://frontend1.torget.bjarby.com';
const here = new URL('./', import.meta.url);
const src = fs.readFileSync(new URL('../../../board/public/colony/tomfor/walk-mode.js', here), 'utf8');
// live-capture.json: gateway with walk mode (PR 30 live). capture-prewalk-gateway.json: gateway before PR 30 (modes [] -> 400).
const cap = JSON.parse(fs.readFileSync(new URL('fixtures/walk/live-capture.json', here), 'utf8'));
const prewalk = JSON.parse(fs.readFileSync(new URL('fixtures/walk/capture-prewalk-gateway.json', here), 'utf8'));
// capture-pre-pr36-gateway.json: gateway before filbac PR 36 (31-min estimate band smaller than the 30-min street band).
const prePr36 = JSON.parse(fs.readFileSync(new URL('fixtures/walk/capture-pre-pr36-gateway.json', here), 'utf8'));
const { CASES } = { CASES: [
  { name: 'center-30x5', lat: 59.3326, lon: 18.0649, maxMinutes: 30, stepMinutes: 5 },
  { name: 'center-45x15', lat: 59.3326, lon: 18.0649, maxMinutes: 45, stepMinutes: 15 },
  { name: 'seam-29', lat: 59.3326, lon: 18.0649, maxMinutes: 29, stepMinutes: 10 },
  { name: 'seam-31', lat: 59.3326, lon: 18.0649, maxMinutes: 31, stepMinutes: 10 },
  { name: 'sodertalje-20x10', lat: 59.1955, lon: 17.6253, maxMinutes: 20, stepMinutes: 10 },
  // Live since mareri PR 41: 60.45,19.45 has no walkable network, /walk answers 422 (the fixture predates that).
  { name: 'bbox-edge-10x5', lat: 60.45, lon: 19.45, maxMinutes: 10, stepMinutes: 5, liveNotWalkable: true },
] };

function load(extra = {}) {
  const ctx = Object.assign({ setTimeout, clearTimeout, AbortController, URL }, extra);
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace('(typeof window', '(typeof __none'), ctx);
  return ctx.TomforWalk;
}

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : JSON.parse(JSON.stringify(body))),
});

// mareri's 422 bodies (live 2026-10-22, PR 41/42).
const NOT_WALKABLE = { error: 'origin_not_walkable', message: 'This point is not on land you can walk from (water or no street nearby). Move the pin.',
  message_sv: 'Den här punkten går inte att gå från (vatten eller ingen gata i närheten). Flytta nålen.' };
const NO_NETWORK = { error: 'no_walkable_network', message: 'No walkable street network at this point.', message_sv: 'Inget gångbart gatunät vid den här punkten.' };

// Fake gateway + mareri replaying the captures. gateway: 'capture' | 'prewalk' | 'down' | 'not_walkable' | FeatureCollection.
// mareri: 'capture' | 'down' | 'no_network' (/walk 422). walkable: 'ok' | 'water' (/walkable 422) | 'down'.
// /walkable calls are logged in `walkable` (array), not in `calls`.
function fakeFetch({ gateway = 'prewalk', mareri = 'capture', walkable = 'ok', calls = [], walkableCalls = [] } = {}) {
  return async (url, init = {}) => {
    if (url.includes('/t/mareri/walkable')) {
      walkableCalls.push(url);
      if (walkable === 'down') throw new TypeError('fetch failed');
      return walkable === 'water' ? res(422, NOT_WALKABLE) : res(200, { walkable: true });
    }
    calls.push(url);
    if (url.endsWith('/t/filbac/api/isochrone')) {
      if (gateway === 'down') throw new TypeError('fetch failed');
      if (gateway === 'not_walkable') return res(422, NOT_WALKABLE);
      if (typeof gateway === 'object') return res(200, gateway);
      const b = JSON.parse(init.body);
      const c = CASES.find((c) => c.lat === b.origin.lat && c.lon === b.origin.lon && c.maxMinutes === b.maxTravelMinutes);
      const g = (gateway === 'prewalk' ? prewalk : cap).gateway[c ? c.name : 'bad-origin'];
      return res(g.status, g.body);
    }
    if (url.includes('/t/mareri/walk')) {
      if (mareri === 'down') return res(502, { error: 'upstream_unavailable' });
      if (mareri === 'no_network') return res(422, NO_NETWORK);
      const m = cap.mareri[url.slice(url.indexOf('/t/mareri/walk'))];
      if (!m) return res(404, { error: 'not_in_fixture', url });
      return res(m.status, m.body);
    }
    return res(404, {});
  };
}

// --- geometry helpers ---
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inGeom = (pt, g) => rings(g).some((r) => inRing(pt, r));
// Share of the inner band's vertices that fall outside the outer band.
function outsideShare(inner, outer) {
  const pts = rings(inner).flat();
  return pts.filter((p) => !inGeom(p, outer)).length / pts.length;
}

let failed = 0, passed = 0;
const findings = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}

// Checks every invariant on one walk-only FeatureCollection. tol: allowed share of inner vertices outside outer
// (mareri's street polygons for neighbouring minutes differ by a vertex or two, e.g. 2 of 102 at 25 in 30 min).
function checkBands(fc, c, { tol = 0.02, label = c.name, raw = false } = {}) {
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.meta.walkOnly, true, 'meta.walkOnly');
  assert.equal(fc.meta.maxTravelMinutes, c.maxMinutes);
  assert.deepEqual([...fc.meta.modes], ['walk']);
  const f = fc.features;
  assert(f.length >= 1);
  const to = f.map((x) => x.properties.toMinutes);
  assert.deepEqual(to, [...to].sort((a, b) => b - a), 'outermost first: ' + to);
  assert.equal(to[0], c.maxMinutes, 'outermost band ends at maxMinutes');
  assert.equal(f[f.length - 1].properties.fromMinutes, 0, 'innermost band starts at 0');
  for (let i = 0; i < f.length - 1; i++) {
    assert.equal(f[i].properties.fromMinutes, f[i + 1].properties.toMinutes, 'cumulative edges');
  }
  for (const x of f) {
    const p = x.properties;
    assert.equal(p.mode, 'walk');
    assert.equal(p.to_min, p.toMinutes); assert.equal(p.from_min, p.fromMinutes);
    if (p.toMinutes > 30) assert.equal(p.source, 'estimate', 'beyond 30 min is an estimate');
    else assert(['street', 'estimate'].includes(p.source));
    // properties.estimated is added by walk-mode.js, raw gateway answers only carry source.
    if (!raw) assert.equal(p.estimated, p.source === 'estimate', 'estimated flag follows source');
    assert(x.geometry && /Polygon$/.test(x.geometry.type));
  }
  for (let i = 0; i < f.length - 1; i++) {
    const share = outsideShare(f[i + 1].geometry, f[i].geometry);
    const pair = f[i + 1].properties.toMinutes + ' in ' + f[i].properties.toMinutes;
    if (share > tol) throw new Error(label + ': band ' + pair + ' min not nested, ' + (share * 100).toFixed(1) + '% of vertices outside');
  }
}

if (!LIVE) {
  const W = load();

  for (const c of CASES) {
    await test('fallback bands from mareri fixtures: ' + c.name, async () => {
      const calls = [];
      const fc = await W.fetchWalkBands(c, { fetch: fakeFetch({ calls }) });
      assert.equal(fc.meta.via, 'tomfor-fallback');
      assert(calls[0].endsWith('/t/filbac/api/isochrone'), 'tries the gateway first');
      checkBands(fc, c);
      fs.writeFileSync(new URL('fixtures/walk/bands-' + c.name + '.json', here), JSON.stringify(fc));
    });
  }

  await test('30-min seam: 31-min estimate band contains the 30-min street band (repaired)', async () => {
    const c = CASES.find((x) => x.name === 'seam-31');
    const fc = await W.fetchWalkBands(c, { fetch: fakeFetch() });
    const [b31, b30] = fc.features;
    assert.equal(b31.properties.source, 'estimate'); assert.equal(b30.properties.source, 'street');
    assert.equal(b31.properties.seamRepaired, true);
    assert.equal(outsideShare(b30.geometry, b31.geometry), 0);
  });

  await test('30-min seam without repair (gateway algorithm) is NOT nested: gateway fault', async () => {
    const c = CASES.find((x) => x.name === 'seam-31');
    const fc = await W.fetchWalkBands(c, { fetch: fakeFetch(), repairSeam: false });
    const share = outsideShare(fc.features[1].geometry, fc.features[0].geometry);
    assert(share > 0.02, 'expected the unrepaired seam to break nesting, got ' + share);
    findings.push('fallback seam unrepaired: 31-min straight-line band leaves ' + (share * 100).toFixed(0) + '% of the 30-min street band outside');
  });

  await test('bands beyond the street limit are estimated:true, with a legend note in EN and SV', async () => {
    const fc = await W.fetchWalkBands(CASES.find((x) => x.name === 'seam-31'), { fetch: fakeFetch() });
    const [outer, ...inner] = fc.features;
    assert.equal(outer.properties.estimated, true); assert(inner.every((f) => f.properties.estimated === false));
    assert.equal(fc.meta.estimatedFromMinutes, outer.properties.fromMinutes); assert.equal(fc.meta.streetMaxMinutes, 30);
    assert.equal(W.legendText('en', fc).estimated, 'Beyond 30 min: estimate, not along streets');
    assert.equal(W.legendText('sv', fc).estimated, 'Efter 30 min: uppskattning, inte längs gatorna');
    const bare = W.markEstimated({ features: [{ properties: { fromMinutes: 30, toMinutes: 35 } }, { properties: { fromMinutes: 0, toMinutes: 30 } }] });
    assert.deepEqual(bare.features.map((f) => f.properties.estimated), [true, false], 'no source: minutes > 30');
    const all = await W.fetchWalkBands(CASES.find((x) => x.name === 'seam-29'), { fetch: fakeFetch() });
    assert.equal(all.meta.estimatedFromMinutes, null); assert.equal(W.legendText('en', all).estimated, null);
  });

  await test('29 min stays all street, no seam repair', async () => {
    const fc = await W.fetchWalkBands(CASES.find((x) => x.name === 'seam-29'), { fetch: fakeFetch() });
    assert(fc.features.every((f) => f.properties.source === 'street'));
    assert(!fc.meta.seamRepaired);
  });

  await test('uses the gateway answer when it has walk mode', async () => {
    const c = CASES[1];
    const gw = await W.fetchWalkBands(c, { fetch: fakeFetch(), repairSeam: false });
    delete gw.meta.via;
    const calls = [];
    const fc = await W.fetchWalkBands(c, { fetch: fakeFetch({ gateway: gw, calls }) });
    assert.equal(fc.meta.via, 'gateway');
    assert.equal(calls.length, 1, 'no mareri calls');
    checkBands(fc, c);
  });

  for (const c of CASES) {
    await test('captured gateway walk bands (seam repaired): ' + c.name, async () => {
      const calls = [];
      const fc = await W.fetchWalkBands(c, { fetch: fakeFetch({ gateway: 'capture', calls }) });
      assert.equal(fc.meta.via, 'gateway'); assert.equal(calls.length, 1);
      checkBands(fc, c);
    });
  }

  await test('captured gateway seam-31 raw (after filbac PR 36): nested, seam repair is a no-op', async () => {
    const raw = cap.gateway['seam-31'].body;
    assert.equal(outsideShare(raw.features[1].geometry, raw.features[0].geometry), 0);
    const fc = await W.fetchWalkBands(CASES.find((x) => x.name === 'seam-31'), { fetch: fakeFetch({ gateway: 'capture' }) });
    assert(!fc.meta.seamRepaired, 'repair should not trigger on the fixed gateway');
  });

  await test('pre-PR 36 gateway seam-31: safety net still repairs the old fault', async () => {
    const raw = prePr36.gateway['seam-31'].body;
    const share = outsideShare(raw.features[1].geometry, raw.features[0].geometry);
    assert(share > 0.02, 'old fixture should show the fault, share ' + share);
    const fc = await W.fetchWalkBands(CASES.find((x) => x.name === 'seam-31'), { fetch: fakeFetch({ gateway: raw }) });
    assert.equal(fc.meta.seamRepaired, true);
    assert.equal(outsideShare(fc.features[1].geometry, fc.features[0].geometry), 0);
  });

  await test('gateway down -> mareri fallback', async () => {
    const fc = await W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'down' }) });
    assert.equal(fc.meta.via, 'tomfor-fallback'); checkBands(fc, CASES[0]);
  });

  await test('gateway and mareri down -> walk_unavailable with EN/SV text', async () => {
    await assert.rejects(W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'down', mareri: 'down' }) }), (e) => {
      assert.equal(e.code, 'walk_unavailable');
      assert.match(W.errorText('en', e), /walking area could not be calculated.*transport type/);
      assert.match(W.errorText('sv', e), /Gångområdet kunde inte beräknas.*trafikslag/);
      return true;
    });
  });

  const notWalkable = (e) => {
    assert.equal(e.code, 'origin_not_walkable');
    assert.match(W.errorText('en', e), /cannot walk from this point.*Move the pin/);
    assert.match(W.errorText('sv', e), /Det går inte att gå från den här punkten.*Flytta nålen/);
    return true;
  };

  await test('/walkable 422 origin_not_walkable -> origin_not_walkable, no band requests', async () => {
    const calls = [], walkableCalls = [];
    await assert.rejects(W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'capture', walkable: 'water', calls, walkableCalls }) }), notWalkable);
    assert.equal(walkableCalls.length, 1); assert.equal(calls.length, 0);
  });

  await test('/walkable down -> carries on to the gateway', async () => {
    const fc = await W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'capture', walkable: 'down' }) });
    assert.equal(fc.meta.via, 'gateway');
  });

  await test('gateway passes 422 through -> origin_not_walkable, no mareri fallback', async () => {
    const calls = [];
    await assert.rejects(W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'not_walkable', calls }) }), notWalkable);
    assert.equal(calls.length, 1);
  });

  await test('fallback: mareri /walk 422 no_walkable_network -> origin_not_walkable, not estimate circles', async () => {
    await assert.rejects(W.fetchWalkBands(CASES[0], { fetch: fakeFetch({ gateway: 'down', mareri: 'no_network' }) }), notWalkable);
  });

  await test('gateway estimate-only bands (it swallowed the 422) + /walk 422 -> origin_not_walkable', async () => {
    const c = CASES[0];
    const est = await W.fetchWalkBands(c, { fetch: fakeFetch({ gateway: 'down', mareri: 'down' }), repairSeam: false }).catch(() => null);
    const gw = est || JSON.parse(JSON.stringify(cap.gateway['center-30x5'].body));
    gw.features.forEach((f) => { f.properties.source = 'estimate'; }); gw.meta.source = 'estimate'; delete gw.meta.via;
    const calls = [];
    await assert.rejects(W.fetchWalkBands(c, { fetch: fakeFetch({ gateway: gw, mareri: 'no_network', calls }) }), notWalkable);
    assert.equal(calls.length, 2, 'gateway + one /walk probe');
    // Same estimate-only answer but mareri /walk is fine: keep the gateway bands.
    const fc = await W.fetchWalkBands(c, { fetch: fakeFetch({ gateway: gw }) });
    assert.equal(fc.meta.via, 'gateway');
  });

  await test('errors.js maps origin_not_walkable and no_walkable_network to error.origin_not_walkable', async () => {
    const E = await import(new URL('../../../board/public/colony/tomfor/errors.js', here));
    for (const body of [NOT_WALKABLE, NO_NETWORK]) {
      assert.equal(E.classify({ status: 422, ...body }), 'origin_not_walkable');
      assert.match(E.errorMessage('sv', { status: 422, ...body }).message, /Flytta nålen/);
    }
    assert.equal(E.classify({ status: 422 }), 'too_restrictive', 'a bare 422 still means too restrictive');
  });

  await test('bad origin -> bad_request before any request', async () => {
    const calls = [];
    await assert.rejects(W.fetchWalkBands({ lat: 10, lon: 10 }, { fetch: fakeFetch({ calls }) }), { code: 'bad_request' });
    assert.equal(calls.length, 0);
  });

  await test('band count capped at 24 like the gateway', async () => {
    const e = W._edges({ lat: 59.33, lon: 18.06, maxMinutes: 120, stepMinutes: 1 });
    assert.equal(e.length, 24); assert.equal(e[e.length - 1], 120);
  });

  await test('errorText uses TomforMareri.errorText when loaded', async () => {
    const W2 = load({ TomforMareri: { errorText: (l, err) => 'adapter:' + l + ':' + err.code } });
    assert.equal(W2.errorText('sv', { code: 'walk_unavailable' }), 'adapter:sv:walk_unavailable');
  });

  await test('addWalkChip: label from I18N, aria-pressed toggles, onToggle called', async () => {
    const mkEl = () => {
      const el = { attrs: {}, children: [], listeners: {}, textContent: '', title: '',
        setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
        addEventListener(t, fn) { this.listeners[t] = fn; }, appendChild(c) { this.children.push(c); } };
      return el;
    };
    const doc = { createElement: mkEl, documentElement: { lang: 'sv' } };
    const W3 = load({ document: doc, I18N: { sv: { 'mode.walk': 'Gång' } } });
    const box = mkEl(); box.ownerDocument = doc;
    const seen = [];
    const b = W3.addWalkChip(box, (on) => seen.push(on));
    assert.equal(box.children[0], b); assert.equal(b.textContent, 'Gång');
    assert.equal(b.getAttribute('aria-pressed'), 'false');
    b.listeners.click(); assert.equal(b.getAttribute('aria-pressed'), 'true'); assert.deepEqual(seen, [true]);
    assert.match(b.title, /längs gatorna/);
    assert.equal(W3.legendText('en', { meta: { maxTravelMinutes: 20 } }).result,
      'All transport types are off, so the map shows only how far you can walk in 20 min.');
  });
} else {
  const W = load({ fetch });
  for (const c of CASES) {
    await test('live ' + c.name, async () => {
      if (c.liveNotWalkable) {
        await assert.rejects(W.fetchWalkBands(c, { base: BASE, fetch }), { code: 'origin_not_walkable' });
        return;
      }
      const t0 = Date.now();
      const fc = await W.fetchWalkBands(c, { base: BASE, fetch });
      console.log('      via', fc.meta.via, 'source', fc.meta.source, 'seamRepaired', !!fc.meta.seamRepaired, Date.now() - t0 + 'ms');
      if (fc.meta.via !== 'gateway') findings.push(c.name + ': gateway walk mode not live, used mareri fallback');
      checkBands(fc, c);
    });
  }
  // 58.8,17.6: sea outside the street graph (/walk 422 no_walkable_network). 59.3235,18.06: Riddarfjärden, inside the
  // graph (/walkable 422 origin_not_walkable). Both were the nesting fault in #build 427.
  for (const [lat, lon] of [[58.8, 17.6], [59.3235, 18.06]]) {
    await test('live not walkable ' + lat + ',' + lon + ' -> origin_not_walkable', async () => {
      await assert.rejects(W.fetchWalkBands({ lat, lon, maxMinutes: 30, stepMinutes: 10 }, { base: BASE, fetch }), { code: 'origin_not_walkable' });
    });
  }
  await test('live gateway raw (no repair): nesting incl. 30-min seam', async () => {
    const c = CASES.find((x) => x.name === 'seam-31');
    const r = await fetch(BASE + '/t/filbac/api/isochrone', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: { lat: c.lat, lon: c.lon }, modes: [], maxTravelMinutes: c.maxMinutes, bandMinutes: c.stepMinutes }) });
    const j = await r.json();
    if (!W.isWalkBands(j)) { findings.push('gateway modes [] -> ' + r.status + ' ' + (j.message || j.error)); return; }
    try { checkBands(j, c, { label: 'gateway raw', raw: true }); } catch (e) { findings.push('FAULT ' + e.message); }
  });
}

for (const f of findings) console.log('FINDING', f);
console.log((LIVE ? 'live' : 'fixtures') + ': ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
