// Review checks for tasks on filbac's board that mareri moved to review, run on the live map app (/colony/mareri/).
// T-4 origin lock dropped: after placing the pin, a click elsewhere and a pin drag both move the origin without Reset;
//     a double click only zooms. T-7 map restricted to the Stockholm region: maxBounds + minZoom.
// A task whose change is not deployed yet SKIPs (with what it saw); once live, a missing behaviour is a FAIL.
// Run: npm run e2e:review   (env BASE, APP). Writes tests/e2e/review-run.json, screenshots tests/screenshots/review-*.png.
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const APP = process.env.APP || '/colony/mareri/';
const OUT = path.join(__dirname, 'review-run.json');
const SHOTS = path.join(__dirname, '..', 'screenshots');
const T_CENTRALEN = [59.3313, 18.0593];
const PARIS = [48.8566, 2.3522];
// Box we suggested in #build 499 (SW 58.9,17.2 NE 60.2,19.2) plus a little slack for viewport rounding.
const REGION = { s: 58.7, w: 16.9, n: 60.4, e: 19.5 };

const results = [];
const rec = (id, dev, status, evidence) => {
  results.push({ id, viewport: dev, status, evidence });
  console.log(`review ${status} ${id} ${dev} - ${evidence}`);
};
const gate = (live, ok) => (ok ? 'PASS' : live ? 'FAIL' : 'SKIP');

const pinLatLng = page => page.evaluate(() => {
  let ll = null; window.__e2eMap.eachLayer(l => { if (l.getLatLng && l.options && l.options.icon !== undefined && !l.getRadius) ll = l.getLatLng(); });
  return ll && [+ll.lat.toFixed(5), +ll.lng.toFixed(5)];
});
const same = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
const near = (a, b, tol) => !!a && !!b && Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;

// A visible point on bare map (not panel, marker or control), away from the pin.
const freePoint = (page, avoid) => page.evaluate(avoid => {
  const m = window.__e2eMap; const c = m.getContainer().getBoundingClientRect();
  const free = p => { const el = document.elementFromPoint(p.x, p.y); return el && !el.closest('.leaflet-control-container, .leaflet-marker-pane, .leaflet-popup-pane') && !!el.closest('.leaflet-container'); };
  for (const fy of [0.25, 0.35, 0.15, 0.45, 0.55]) for (const fx of [0.3, 0.7, 0.5, 0.2, 0.8]) {
    const q = { x: c.left + c.width * fx, y: c.top + c.height * fy };
    if (q.y < 0 || q.y > innerHeight || q.x < 0 || q.x > innerWidth || !free(q)) continue;
    if (avoid && Math.hypot(q.x - avoid.x, q.y - avoid.y) < 80) continue;
    const ll = m.containerPointToLatLng([q.x - c.left, q.y - c.top]);
    return { x: q.x, y: q.y, ll: [+ll.lat.toFixed(5), +ll.lng.toFixed(5)] };
  }
  return null;
}, avoid);

async function touchDrag(cdp, from, to, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
    await new Promise(r => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function drag(page, cdp, dev, from, to) {
  if (dev === 'phone') return touchDrag(cdp, from, to);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
}
async function tap(page, dev, p) { dev === 'phone' ? await page.touchscreen.tap(p.x, p.y) : await page.mouse.click(p.x, p.y); }
async function dbl(page, cdp, dev, p) {
  if (dev !== 'phone') return page.mouse.dblclick(p.x, p.y);
  await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(80); await page.touchscreen.tap(p.x, p.y);
}

async function t4(page, cdp, dev, live) {
  await page.evaluate(ll => window.__e2eMap.setView(ll, 13, { animate: false }), T_CENTRALEN);
  const set = await H.placePin(page, dev, T_CENTRALEN);
  await page.waitForTimeout(500);
  const p0 = await pinLatLng(page);

  // 1) click/tap elsewhere on the map -> origin moves (no Reset in between)
  const pinBox = await page.locator('.leaflet-marker-icon').first().boundingBox();
  const pinPt = pinBox && { x: pinBox.x + pinBox.width / 2, y: pinBox.y + pinBox.height / 2 };
  const target = await freePoint(page, pinPt);
  let clickEv = 'no free map point', clickOk = false;
  if (target) {
    await tap(page, dev, target); await page.waitForTimeout(700);
    const p1 = await pinLatLng(page);
    clickOk = !same(p0, p1) && near(p1, target.ll, 0.003);
    clickEv = `${dev === 'phone' ? 'tap' : 'click'} at ${target.ll} after placing ${p0}: pin ${clickOk ? 'moved to' : same(p0, p1) ? 'stayed at' : 'went to'} ${p1}`;
  }
  rec('T-4 second click moves origin', dev, gate(live, set.ok && clickOk), `placed pin ${set.ok ? 'ok' : 'FAILED'}; ${clickEv}`);

  // 2) drag the pin -> origin moves
  const m = page.locator('.leaflet-marker-icon').first();
  const bb = await m.boundingBox();
  let dragOk = false, dragEv = 'pin not found';
  if (bb) {
    const from = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
    const to = { x: from.x + 60, y: from.y + 40 };
    const before = await pinLatLng(page);
    const draggable = await m.evaluate(e => e.classList.contains('leaflet-marker-draggable'));
    await drag(page, cdp, dev, from, to); await page.waitForTimeout(600);
    const after = await pinLatLng(page);
    const out = (await page.locator('#origin-out').innerText().catch(() => '')).trim();
    dragOk = !same(before, after);
    dragEv = `drag pin +60,+40 px: ${before} -> ${after} (draggable class ${draggable}), origin text "${out}"`;
  }
  rec('T-4 drag moves origin after placement', dev, gate(live, dragOk), dragEv);

  // 3) a click after the drag still moves it (drag must not re-lock)
  const pinBox2 = await m.boundingBox().catch(() => null);
  const t2 = await freePoint(page, pinBox2 && { x: pinBox2.x + pinBox2.width / 2, y: pinBox2.y + pinBox2.height / 2 });
  let againOk = false, againEv = 'no free map point';
  if (t2) {
    const b = await pinLatLng(page);
    await tap(page, dev, t2); await page.waitForTimeout(700);
    const a = await pinLatLng(page);
    againOk = !same(a, b) && near(a, t2.ll, 0.003);
    againEv = `${dev === 'phone' ? 'tap' : 'click'} at ${t2.ll} after drag: ${b} -> ${a}`;
  }
  rec('T-4 click after drag moves origin', dev, gate(live, againOk), againEv);

  // 4) double click/tap zooms but does not move the origin
  const pinBox3 = await m.boundingBox().catch(() => null);
  const t3 = await freePoint(page, pinBox3 && { x: pinBox3.x + pinBox3.width / 2, y: pinBox3.y + pinBox3.height / 2 });
  let dblOk = false, dblEv = 'no free map point';
  if (t3) {
    const b = await pinLatLng(page); const z0 = await page.evaluate(() => window.__e2eMap.getZoom());
    await dbl(page, cdp, dev, t3); await page.waitForTimeout(900);
    const a = await pinLatLng(page); const z1 = await page.evaluate(() => window.__e2eMap.getZoom());
    dblOk = same(a, b) && z1 > z0;
    dblEv = `double ${dev === 'phone' ? 'tap' : 'click'} at ${t3.ll}: zoom ${z0} -> ${z1}, pin ${b} -> ${a}`;
  }
  // The double-click guard existed before T-4 too, so this one is judged regardless of the live gate.
  rec('T-4 double click only zooms', dev, dblOk ? 'PASS' : 'FAIL', dblEv);
  await page.screenshot({ path: path.join(SHOTS, `review-t4-${dev}.png`) });
}

async function t7(page, cdp, dev, live) {
  const opts = await page.evaluate(() => {
    const m = window.__e2eMap; const b = m.options.maxBounds;
    const mb = b && (b.getSouthWest ? b : L.latLngBounds(b));
    return { minZoom: m.getMinZoom(), optMinZoom: m.options.minZoom, viscosity: m.options.maxBoundsViscosity,
      maxBounds: mb ? [mb.getSouth(), mb.getWest(), mb.getNorth(), mb.getEast()].map(v => +v.toFixed(2)) : null };
  });
  const optsEv = `maxBounds ${opts.maxBounds ? opts.maxBounds.join(',') : 'none'}, minZoom ${opts.optMinZoom ?? 'none'}, viscosity ${opts.viscosity ?? 'none'}`;

  // Zoom out like a user: zoom-out button (or wheel) many times, then one more programmatic step below minZoom.
  const out = page.locator('.leaflet-control-zoom-out');
  for (let i = 0; i < 10; i++) {
    if (await out.evaluate(e => e.classList.contains('leaflet-disabled')).catch(() => true)) break;
    dev === 'phone' ? await out.tap() : await out.click(); await page.waitForTimeout(250);
  }
  const zBtn = await page.evaluate(() => window.__e2eMap.getZoom());
  const zMin1 = await page.evaluate(() => { const m = window.__e2eMap; m.setZoom(m.getMinZoom() - 1, { animate: false }); return m.getZoom(); });
  const zoomOk = !!opts.optMinZoom && opts.optMinZoom >= 8 && zBtn >= opts.optMinZoom && zMin1 >= opts.optMinZoom;
  rec('T-7 minZoom holds', dev, gate(live, zoomOk), `${optsEv}; zoom-out button x10 -> z${zBtn}; setZoom(minZoom-1) -> z${zMin1}`);

  // Pan towards Paris: drag the map east a lot (so the view heads west/south), then panTo Paris.
  const c = await page.evaluate(() => { const r = window.__e2eMap.getContainer().getBoundingClientRect(); return { x: r.left + r.width / 2, y: Math.max(r.top, 0) + Math.min(r.height, innerHeight) / 2 }; });
  for (let i = 0; i < 4; i++) { await drag(page, cdp, dev, { x: c.x - 120, y: c.y - 80 }, { x: c.x + 120, y: c.y + 80 }); await page.waitForTimeout(350); }
  const afterDrag = await page.evaluate(() => { const p = window.__e2eMap.getCenter(); return [+p.lat.toFixed(3), +p.lng.toFixed(3)]; });
  await page.evaluate(ll => window.__e2eMap.panTo(ll, { animate: false }), PARIS);
  await page.waitForTimeout(600);
  const v = await page.evaluate(() => { const m = window.__e2eMap; const p = m.getCenter(); const b = m.getBounds(); return { center: [+p.lat.toFixed(3), +p.lng.toFixed(3)], zoom: m.getZoom(), view: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(x => +x.toFixed(2)) }; });
  const inRegion = ([lat, lon]) => lat >= REGION.s && lat <= REGION.n && lon >= REGION.w && lon <= REGION.e;
  const panOk = inRegion(afterDrag) && inRegion(v.center);
  await page.screenshot({ path: path.join(SHOTS, `review-t7-${dev}.png`) });
  rec('T-7 cannot pan to Paris', dev, gate(live, panOk), `4 big drags SE -> centre ${afterDrag}; panTo Paris -> centre ${v.center} z${v.zoom}, view S,W,N,E ${v.view.join(',')}; expected centre within ${REGION.s}-${REGION.n} N, ${REGION.w}-${REGION.e} E`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const src = await (await fetch(H.BASE + APP + 'app.js')).text().catch(() => '');
  const browser = await H.chromium.launch();
  const liveInfo = {};
  try {
    for (const dev of ['desktop', 'phone']) {
      const { ctx, page, log } = await H.openApp(browser, APP, dev);
      const cdp = await ctx.newCDPSession(page);
      if (!(await H.hasMap(page))) { rec('setup', dev, 'FAIL', 'map instance not found'); await ctx.close(); continue; }
      const mapOpts = await page.evaluate(() => ({ maxBounds: !!window.__e2eMap.options.maxBounds, minZoom: window.__e2eMap.options.minZoom }));
      // Live = the deployed code no longer locks the origin (T-4) / the map has maxBounds or a minZoom (T-7).
      const live = { t4: !/originLocked\s*\)\s*return|lockOrigin\(true\)/.test(src), t7: mapOpts.maxBounds || mapOpts.minZoom != null };
      liveInfo[dev] = live;
      console.log(`review live ${dev}: T-4 ${live.t4} (app.js ${src.length} bytes), T-7 ${live.t7}`);
      await t4(page, cdp, dev, live.t4);
      await t7(page, cdp, dev, live.t7);
      if (log.consoleErrors.length) rec('console errors', dev, 'INFO', log.consoleErrors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  const summary = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: H.BASE, app: APP, live: liveInfo, summary, results }, null, 2));
  console.log('review summary', JSON.stringify(summary));
})().catch(e => { console.error(e); process.exit(1); });
