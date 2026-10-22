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
  var map = L.map('map', { zoomControl: false }).setView(STOCKHOLM, 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var PIN_SVG = '<span class="pin-ring"></span>' +
    '<svg viewBox="0 0 36 44" aria-hidden="true"><path d="M18 1C9 1 2 8 2 17c0 12 16 26 16 26s16-14 16-26C34 8 27 1 18 1z" fill="#2563eb" stroke="#fff" stroke-width="2.5"/>' +
    '<circle cx="18" cy="17" r="6" fill="#fff"/></svg>';
  var pin = L.marker(STOCKHOLM, {
    draggable: true,
    autoPan: true,
    icon: L.divIcon({ className: 'pin', html: PIN_SVG, iconSize: [36, 44], iconAnchor: [18, 43] })
  }).addTo(map);
  pin.on('dragstart', function () { pin.getElement().classList.add('lifted'); });
  pin.on('dragend', function () { pin.getElement().classList.remove('lifted'); });

  // Solid-filled cumulative bands are made translucent as one layer, so they don't blend with each other.
  var isoPane = map.createPane('iso');
  isoPane.style.opacity = '0';
  var isoRenderer = L.canvas({ pane: 'iso' });
  var ISO_OPACITY = '0.6';
  var overlay = null;

  // Real street-network walking area from the pin, drawn above the bands.
  var walkPane = map.createPane('walk');
  walkPane.style.zIndex = 450;
  walkPane.style.pointerEvents = 'none';
  var walkLayer = null;
  var walkMinutes = null;
  var walkToken = 0;

  function clearWalk() {
    walkToken++;
    if (walkLayer) { map.removeLayer(walkLayer); walkLayer = null; }
    walkMinutes = null;
    $('walk-note').hidden = true;
  }

  function showWalkNote() {
    if (walkMinutes === null) return;
    $('walk-text').textContent = t('walkReal', { n: walkMinutes });
    $('walk-note').hidden = false;
  }

  async function loadWalkArea(p, minutes) {
    clearWalk();
    if (params.get('stub') === '1' || !(minutes >= 1)) return;
    var token = walkToken;
    try {
      var res = await fetch('/t/mareri/walk?lat=' + p.lat + '&lon=' + p.lng + '&minutes=' + minutes);
      if (!res.ok) return;
      var feature = await res.json();
      if (token !== walkToken) return;
      walkLayer = L.geoJSON(feature, {
        pane: 'walk',
        interactive: false,
        style: { color: '#0f172a', weight: 2.5, dashArray: '6 5', fillColor: '#ffffff', fillOpacity: 0.12 }
      }).addTo(map);
      walkMinutes = minutes;
      showWalkNote();
    } catch (e) { /* optional layer: the isochrone stays valid without it */ }
  }

  function showOrigin() {
    var p = pin.getLatLng();
    $('origin-out').textContent = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
  }
  pin.on('drag', showOrigin);
  map.on('click', function (e) { pin.setLatLng(e.latlng); showOrigin(); });
  showOrigin();

  // ---- Form setup ----
  var maxTravel = $('max-travel');
  function syncTravel() {
    var v = parseInt(maxTravel.value, 10);
    var pct = ((v - 5) / (120 - 5)) * 100;
    maxTravel.style.setProperty('--pct', pct + '%');
    $('travel-out').textContent = t('minutes', { n: v });
  }
  maxTravel.addEventListener('input', syncTravel);

  var MODE_ICONS = { bus: '\uD83D\uDE8C', metro: '\uD83D\uDE87', tram: '\uD83D\uDE8A', train: '\uD83D\uDE86', commuter_rail: '\uD83D\uDE89', boat: '\u26F4\uFE0F' };
  var modesBox = $('modes');
  MODES.forEach(function (mode) {
    var label = document.createElement('label');
    label.className = 'chip';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = mode;
    cb.checked = true;
    var face = document.createElement('span');
    face.className = 'face';
    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = MODE_ICONS[mode];
    var text = document.createElement('span');
    text.setAttribute('data-i18n', 'mode.' + mode);
    face.appendChild(ico);
    face.appendChild(text);
    label.appendChild(cb);
    label.appendChild(face);
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
    showWalkNote();
    syncTravel();
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
  // Keep the OSM attribution visible above the bottom sheet on small screens.
  function syncSheetHeight() {
    var small = window.matchMedia('(max-width: 700px)').matches;
    document.documentElement.style.setProperty('--sheet-h', small ? panel.offsetHeight + 'px' : '0px');
  }
  if (window.ResizeObserver) new ResizeObserver(syncSheetHeight).observe(panel);
  window.addEventListener('resize', syncSheetHeight);
  syncSheetHeight();

  // ---- Status ----
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = isError ? 'error' : '';
  }

  // ---- Overlay rendering ----
  var lastBands = null;

  // Teal (near) -> lime -> yellow -> orange -> red -> magenta -> purple (far)
  var STOPS = [[25, 211, 162], [125, 220, 59], [242, 209, 43], [255, 154, 31], [255, 90, 77], [224, 53, 155], [122, 44, 191]];
  function bandColor(i, n) {
    var f = n <= 1 ? 0 : i / (n - 1);
    var pos = f * (STOPS.length - 1);
    var lo = Math.min(Math.floor(pos), STOPS.length - 2);
    var k = pos - lo;
    var a = STOPS[lo], b = STOPS[lo + 1];
    return 'rgb(' + [0, 1, 2].map(function (c) { return Math.round(a[c] + (b[c] - a[c]) * k); }).join(',') + ')';
  }

  function renderLegend(bands) {
    var box = $('legend');
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = t('legend');
    var bar = document.createElement('div');
    bar.className = 'legend-bar';
    bands.forEach(function (b, i) {
      var seg = document.createElement('span');
      seg.style.background = bandColor(i, bands.length);
      seg.title = b.from + '–' + b.to + ' min';
      bar.appendChild(seg);
    });
    var last = bands[bands.length - 1].to;
    var scale = document.createElement('div');
    scale.className = 'legend-scale';
    [0, Math.round(last / 2), last].forEach(function (v) {
      var s = document.createElement('span');
      s.textContent = v;
      scale.appendChild(s);
    });
    box.appendChild(title);
    box.appendChild(bar);
    box.appendChild(scale);
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
    if (!drawn.length) { lastBands = null; $('legend').hidden = true; clearWalk(); return false; }

    var group = L.featureGroup();
    // Bands are cumulative: paint the outermost first so nearer bands cover it.
    bands.slice().reverse().forEach(function (b) {
      if (!hasArea(b.feature.geometry)) return;
      L.geoJSON(b.feature, {
        pane: 'iso',
        renderer: isoRenderer,
        interactive: false,
        style: {
          stroke: true,
          color: '#ffffff',
          weight: 0.8,
          opacity: 0.75,
          fillColor: bandColor(bands.indexOf(b), bands.length),
          fillOpacity: 1
        }
      }).addTo(group);
    });
    overlay = group.addTo(map);
    lastBands = bands;
    renderLegend(bands);

    var small = window.matchMedia('(max-width: 700px)').matches;
    var bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, small
        ? { paddingTopLeft: [24, 24], paddingBottomRight: [24, Math.min(panel.offsetHeight, window.innerHeight * 0.4) + 24], maxZoom: 14 }
        : { paddingTopLeft: [panel.offsetWidth + 36, 36], paddingBottomRight: [60, 36], maxZoom: 14 });
    }
    isoPane.style.opacity = '0';
    requestAnimationFrame(function () { requestAnimationFrame(function () { isoPane.style.opacity = ISO_OPACITY; }); });
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
    btn.classList.add('loading');
    setStatus(t('calculating'));
    var started = performance.now();
    try {
      var fc = await callEngine(body);
      if (!renderIsochrones(fc)) {
        setStatus(t('err.empty'), true);
      } else {
        setStatus(t('done', { s: ((performance.now() - started) / 1000).toFixed(1) }));
        loadWalkArea(pin.getLatLng(), body.walking.accessMinutes);
        if (window.matchMedia('(max-width: 700px)').matches) {
          panel.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    } catch (e) {
      setStatus(errorMessage(e), true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
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
