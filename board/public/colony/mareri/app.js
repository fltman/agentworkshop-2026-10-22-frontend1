(function () {
  'use strict';

  var ENGINE_URL = '/t/marlin/isochrone';
  var TIMEOUT_MS = 20000;
  var MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];
  var STOCKHOLM = [59.3293, 18.0686];
  var params = new URLSearchParams(location.search);

  var lang = localStorage.getItem('lang') ||
    ((navigator.language || '').toLowerCase().indexOf('sv') === 0 ? 'sv' : 'en');

  function t(key, vars) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }

  var $ = function (id) { return document.getElementById(id); };

  // ---- Map ----
  var map = L.map('map', { zoomControl: true }).setView(STOCKHOLM, 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var pin = L.marker(STOCKHOLM, { draggable: true, autoPan: true }).addTo(map);
  // Solid-filled cumulative bands are made translucent as one layer, so they don't blend with each other.
  map.createPane('iso').style.opacity = '0.55';
  var overlay = null;

  function showOrigin() {
    var p = pin.getLatLng();
    $('origin-out').textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
  }
  pin.on('drag', showOrigin);
  map.on('click', function (e) { pin.setLatLng(e.latlng); showOrigin(); });
  showOrigin();

  // ---- Form setup ----
  var maxTravel = $('max-travel');
  for (var m = 5; m <= 120; m += 5) {
    var o = document.createElement('option');
    o.value = String(m);
    o.textContent = m + ' min';
    if (m === 30) o.selected = true;
    maxTravel.appendChild(o);
  }

  var modesBox = $('modes');
  MODES.forEach(function (mode) {
    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = mode;
    cb.checked = true;
    var span = document.createElement('span');
    span.setAttribute('data-i18n', 'mode.' + mode);
    label.appendChild(cb);
    label.appendChild(span);
    modesBox.appendChild(label);
  });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowLocalValue() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  $('start-time').value = nowLocalValue();

  // ---- i18n ----
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
    });
    if (lastBands) renderLegend(lastBands);
  }
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      localStorage.setItem('lang', lang);
      applyLang();
    });
  });

  // ---- Mobile sheet ----
  var panel = $('panel');
  var toggle = $('sheet-toggle');
  toggle.addEventListener('click', function () {
    var collapsed = panel.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  // ---- Status ----
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = isError ? 'error' : '';
  }

  // ---- Overlay rendering ----
  var lastBands = null;

  // Green (near) -> yellow -> red -> purple (far)
  function bandColor(i, n) {
    var f = n <= 1 ? 0 : i / (n - 1);
    var hue = 130 - f * 190; // 130 -> -60
    if (hue < 0) hue += 360;
    return 'hsl(' + Math.round(hue) + ', 80%, 48%)';
  }

  function renderLegend(bands) {
    var box = $('legend');
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = t('legend');
    var items = document.createElement('div');
    items.className = 'legend-items';
    bands.forEach(function (b, i) {
      var item = document.createElement('span');
      item.className = 'legend-item';
      var sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = bandColor(i, bands.length);
      var label = document.createElement('span');
      label.textContent = b.from + '–' + b.to;
      item.appendChild(sw);
      item.appendChild(label);
      items.appendChild(item);
    });
    box.appendChild(title);
    box.appendChild(items);
    box.hidden = false;
  }

  function hasArea(g) {
    return !!(g && g.coordinates && g.coordinates.length);
  }

  function renderIsochrones(fc) {
    var feats = (fc && fc.features) || [];
    var bands = feats.map(function (f) {
      var p = f.properties || {};
      return { from: p.fromMinutes, to: p.toMinutes, feature: f };
    }).filter(function (b) {
      return typeof b.from === 'number' && typeof b.to === 'number';
    }).sort(function (a, b) { return a.from - b.from; });

    if (overlay) { map.removeLayer(overlay); overlay = null; }
    var drawn = bands.filter(function (b) { return hasArea(b.feature.geometry); });
    if (!drawn.length) { lastBands = null; $('legend').hidden = true; return false; }

    var group = L.featureGroup();
    // Bands are cumulative: paint the outermost first so nearer bands cover it.
    bands.slice().reverse().forEach(function (b) {
      if (!hasArea(b.feature.geometry)) return;
      L.geoJSON(b.feature, {
        pane: 'iso',
        interactive: false,
        style: {
          stroke: false,
          fillColor: bandColor(bands.indexOf(b), bands.length),
          fillOpacity: 1
        }
      }).addTo(group);
    });
    overlay = group.addTo(map);
    lastBands = bands;
    renderLegend(bands);
    var bounds = group.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    return true;
  }

  // ---- Request ----
  function intVal(id) { return parseInt($(id).value, 10); }

  function readSettings() {
    var modes = Array.prototype.slice.call(modesBox.querySelectorAll('input:checked'))
      .map(function (cb) { return cb.value; });
    if (!modes.length) throw new Error(t('err.noModes'));

    var start = new Date($('start-time').value);
    if (isNaN(start.getTime())) throw new Error(t('err.badTime'));

    var checks = [
      ['max-wait', 0, 60, t('maxWait')],
      ['max-transfers', 0, 8, t('maxTransfers')],
      ['walk-dest', 0, 30, t('walkDest')],
      ['walk-transfer', 0, 30, t('walkTransfer')]
    ];
    checks.forEach(function (c) {
      var v = intVal(c[0]);
      if (isNaN(v) || v < c[1] || v > c[2]) throw new Error(t('err.badNumber', { field: c[3] }));
    });

    var p = pin.getLatLng();
    return {
      origin: { lat: p.lat, lon: p.lng },
      startTime: start.toISOString(),
      maxTravelMinutes: intVal('max-travel'),
      maxWaitMinutes: intVal('max-wait'),
      maxTransfers: intVal('max-transfers'),
      modes: modes,
      walking: {
        accessMinutes: intVal('walk-dest'),
        egressMinutes: intVal('walk-dest'),
        transferMinutes: intVal('walk-transfer')
      },
      bandMinutes: 5
    };
  }

  function errorMessage(err) {
    if (err.name === 'AbortError') return t('err.timeout');
    if (err.engineMessage) return lang === 'sv' && err.engineMessageSv ? err.engineMessageSv : err.engineMessage;
    if (err.status === 404 || err.status === 502 || err.status === 503) return t('err.unavailable');
    if (err.isNetwork) return t('err.network');
    return t('err.unknown', { detail: err.message || err.status || '?' });
  }

  var inflight = null;

  async function callEngine(body) {
    if (params.get('stub') === '1' && window.StubEngine) return window.StubEngine(body);
    if (inflight) inflight.abort();
    var ctrl = new AbortController();
    inflight = ctrl;
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var res;
    try {
      res = await fetch(ENGINE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      if (e.name !== 'AbortError') e.isNetwork = true;
      throw e;
    } finally {
      clearTimeout(timer);
      if (inflight === ctrl) inflight = null;
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      var err = new Error((data && data.message) || ('HTTP ' + res.status));
      err.status = res.status;
      if (data && data.message) {
        err.engineMessage = data.message;
        err.engineMessageSv = data.message_sv;
      }
      throw err;
    }
    return data;
  }

  $('form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var body;
    try {
      body = readSettings();
    } catch (e) {
      setStatus(e.message, true);
      return;
    }
    var btn = $('update');
    btn.disabled = true;
    setStatus(t('calculating'));
    var started = performance.now();
    try {
      var fc = await callEngine(body);
      if (!renderIsochrones(fc)) {
        setStatus(t('err.empty'), true);
      } else {
        setStatus(t('done', { s: ((performance.now() - started) / 1000).toFixed(1) }));
        if (window.matchMedia('(max-width: 700px)').matches) {
          panel.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    } catch (e) {
      setStatus(errorMessage(e), true);
    } finally {
      btn.disabled = false;
    }
  });

  if (params.get('stub') === '1') {
    var s = document.createElement('script');
    s.src = 'stub.js';
    document.head.appendChild(s);
  } else {
    fetch('/t/marlin/health').then(function (r) { return r.json(); }).then(function (h) {
      $('banner').hidden = h.source !== 'fixture';
    }).catch(function () { /* the Update call reports engine problems */ });
  }

  applyLang();
})();
