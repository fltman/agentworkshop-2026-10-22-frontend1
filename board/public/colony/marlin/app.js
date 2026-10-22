'use strict';

/**
 * marlin isochrone tile.
 *
 * A thin client over /t/marlin/: it owns no routing logic, it only shows what
 * the engine returns. mareri owns the group's real frontend; this tile exists so
 * the engine can be seen, poked and reported against while we build.
 */

const API = '/t/marlin';
const STOCKHOLM = [59.3326, 18.0649];
const MODE_LABELS = {
  bus: 'Bus',
  metro: 'Metro',
  tram: 'Tram',
  train: 'Train',
  commuter_rail: 'Commuter rail',
  boat: 'Boat',
};

const el = (id) => document.getElementById(id);
const statusEl = el('status');

const map = L.map('map', { zoomControl: true }).setView(STOCKHOLM, 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let overlay = L.layerGroup().addTo(map);
const marker = L.marker(STOCKHOLM, { draggable: true }).addTo(map);
marker.bindTooltip('Drag me, or tap the map', { direction: 'top' });

map.on('click', (e) => {
  marker.setLatLng(e.latlng);
  update();
});
marker.on('dragend', update);

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
}

/* ---- settings ---------------------------------------------------------- */

const sliders = [
  ['maxTravel', 'travelOut', (v) => v + ' min'],
  ['maxWait', 'waitOut', (v) => v + ' min'],
  ['maxTransfers', 'transferOut', (v) => v],
  ['accessMinutes', 'accessOut', (v) => v + ' min'],
  ['egressMinutes', 'egressOut', (v) => v + ' min'],
  ['transferMinutes', 'transferWalkOut', (v) => v + ' min'],
];

for (const [input, output, format] of sliders) {
  const i = el(input);
  const o = el(output);
  const sync = () => { o.textContent = format(i.value); };
  i.addEventListener('input', sync);
  sync();
}

const now = new Date();
el('startTime').value =
  String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

el('toggle').addEventListener('click', () => {
  const panel = el('panel');
  const collapsed = panel.classList.toggle('collapsed');
  el('toggle').setAttribute('aria-expanded', String(!collapsed));
});

function selectedModes() {
  return Array.from(document.querySelectorAll('#modes input:checked')).map((i) => i.value);
}

async function loadModes() {
  const fieldset = el('modes');
  let modes = Object.keys(MODE_LABELS);
  try {
    const res = await fetch(API + '/modes');
    const data = await res.json();
    if (Array.isArray(data.modes) && data.modes.length) modes = data.modes;
  } catch {
    // Offer everything rather than nothing: the engine rejects what it cannot do.
  }
  for (const mode of modes) {
    const label = document.createElement('label');
    label.className = 'mode';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = mode;
    input.checked = true;
    const span = document.createElement('span');
    // textContent, never innerHTML: the mode list comes off the wire.
    span.textContent = MODE_LABELS[mode] || mode;
    label.append(input, span);
    fieldset.append(label);
  }
}

/* ---- the one call ------------------------------------------------------ */

let inFlight = null;

async function update(event) {
  if (event) event.preventDefault();
  const modes = selectedModes();
  if (modes.length === 0) {
    setStatus('Pick at least one transport type.', true);
    return;
  }

  const { lat, lng } = marker.getLatLng();
  const body = {
    origin: { lat, lon: lng },
    startTime: el('startTime').value || undefined,
    maxTravelMinutes: Number(el('maxTravel').value),
    maxWaitMinutes: Number(el('maxWait').value),
    maxTransfers: Number(el('maxTransfers').value),
    modes,
    walking: {
      accessMinutes: Number(el('accessMinutes').value),
      egressMinutes: Number(el('egressMinutes').value),
      transferMinutes: Number(el('transferMinutes').value),
    },
    bandMinutes: 5,
  };

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;

  el('update').disabled = true;
  setStatus('Calculating…');
  const started = performance.now();

  try {
    const res = await fetch(API + '/isochrone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.message || 'The request failed.', true);
      overlay.clearLayers();
      el('legend').hidden = true;
      return;
    }

    draw(data);
    const ms = Math.round(performance.now() - started);
    setStatus(
      data.meta.stopsReached + ' stops reached · ' + data.meta.computedMs + ' ms engine · ' +
      ms + ' ms total · ' + data.meta.source);
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('Could not reach the isochrone engine.', true);
  } finally {
    if (inFlight === controller) inFlight = null;
    el('update').disabled = false;
  }
}

function draw(collection) {
  overlay.clearLayers();
  // The engine returns cumulative bands, outermost first, so painting in array
  // order lets the nearer bands cover the farther ones.
  for (const feature of collection.features) {
    if (!feature.geometry.coordinates.length) continue;
    L.geoJSON(feature, {
      style: {
        color: feature.properties.color,
        fillColor: feature.properties.color,
        fillOpacity: 0.55,
        weight: 0,
      },
      interactive: false,
    }).addTo(overlay);
  }
  marker.bringToFront?.();
  drawLegend(collection.features);
}

function drawLegend(features) {
  const legend = el('legend');
  legend.textContent = '';
  const title = document.createElement('strong');
  title.textContent = 'Minutes from the pin';
  legend.append(title);

  for (const f of features.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'row';
    const swatch = document.createElement('i');
    swatch.style.background = f.properties.color;
    const text = document.createElement('span');
    text.textContent = f.properties.fromMinutes + '–' + f.properties.toMinutes;
    row.append(swatch, text);
    legend.append(row);
  }
  legend.hidden = false;
}

el('panel').addEventListener('submit', update);

(async function start() {
  await loadModes();
  try {
    const health = await (await fetch(API + '/health')).json();
    if (!health.networkLoaded) {
      setStatus('The transit network is not loaded yet.', true);
      return;
    }
    if (health.source === 'fixture') {
      setStatus('Running on synthetic test data — real SL data not loaded yet.');
    }
  } catch {
    setStatus('Could not reach the isochrone engine.', true);
    return;
  }
  update();
})();
