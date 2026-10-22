// "Type a destination, get a sentence" (classic script, no build step, no dependencies):
//   <script src="/colony/tomfor/destination.js"></script>
// window.TomforDestination.describeJourney(lang, journey, opts) turns mareri's POST /t/mareri/journey answer
// (or its error body) into {text, srText, kind}. attach(container, opts) adds a "To" field that searches an
// address (search.js, loaded on demand), calls /journey and reads the sentence out in an aria-live region.
// With filbac's IsoSearchControl picking the place, use attach(container, {searchControl}) (no second input) and
// call handle.pick(lat, lon) from its onPick, or describeFor(place, opts) without any DOM.
(function (root) {
  'use strict';

  var STRINGS = {
    en: {
      'dest.label': 'To',
      'dest.placeholder': 'Where do you want to go?',
      'dest.clear': 'Clear destination',
      'dest.searching': 'Finding {place}…',
      'dest.sentence': '{place}: {min} min, leave {time}, {legs}',
      'dest.arriveBy': '{place}: leave by {time} to arrive {deadline}, {legs}',
      'dest.leg.transit': '{mode} {line}',
      'dest.leg.walk': '{min} min walk',
      'dest.leg.then': ' then ',
      'dest.walkOnly': '{place}: {min} min walk, no transit needed',
      'dest.walkFaster': '{place}: faster to walk, {min} min',
      'dest.outOfReach': '{place} is not within {max} min. The nearest place you reach is {stop} ({min} min).',
      'dest.outOfReach.plain': '{place} is not within {max} min.',
      'dest.outOfReach.fix': 'Try a longer travel time or more transport types.',
      'dest.notFound': 'Could not find "{q}" in the Stockholm area. Try a street name or a station.',
      'dest.unavailable': 'Trip details are not available right now. The map still shows how far you get.',
      'dest.place': 'Your destination',
      'dest.sr.walk': 'Walk {min} min to {to}.',
      'dest.sr.ride': 'Take {mode} {line} at {depart} from {from} to {to}, {stops} stops, {min} min.',
      'dest.sr.ride.one': 'Take {mode} {line} at {depart} from {from} to {to}, 1 stop, {min} min.',
      'dest.sr.wait': 'Wait {min} min.',
      'dest.sr.arrive': 'Arrive {time}, {min} min in total.',
      'dest.sr.there': 'your destination',
      'mode.bus': 'bus', 'mode.metro': 'metro', 'mode.tram': 'tram', 'mode.train': 'train',
      'mode.commuter_rail': 'commuter rail', 'mode.boat': 'boat', 'mode.ferry': 'boat'
    },
    sv: {
      'dest.label': 'Till',
      'dest.placeholder': 'Vart vill du åka?',
      'dest.clear': 'Rensa resmålet',
      'dest.searching': 'Letar efter {place}…',
      'dest.sentence': '{place}: {min} min, åk {time}, {legs}',
      'dest.arriveBy': '{place}: åk senast {time} för att vara framme {deadline}, {legs}',
      'dest.leg.transit': '{mode} {line}',
      'dest.leg.walk': '{min} min promenad',
      'dest.leg.then': ' och sedan ',
      'dest.walkOnly': '{place}: {min} min promenad, ingen kollektivtrafik behövs',
      'dest.walkFaster': '{place}: snabbare att gå, {min} min',
      'dest.outOfReach': '{place} nås inte inom {max} min. Närmast du kommer är {stop} ({min} min).',
      'dest.outOfReach.plain': '{place} nås inte inom {max} min.',
      'dest.outOfReach.fix': 'Prova en längre restid eller fler trafikslag.',
      'dest.notFound': 'Hittade inte ”{q}” i Stockholmsområdet. Prova ett gatunamn eller en station.',
      'dest.unavailable': 'Resdetaljer finns inte just nu. Kartan visar ändå hur långt du kommer.',
      'dest.place': 'Ditt resmål',
      'dest.sr.walk': 'Gå {min} min till {to}.',
      'dest.sr.ride': 'Ta {mode} {line} klockan {depart} från {from} till {to}, {stops} hållplatser, {min} min.',
      'dest.sr.ride.one': 'Ta {mode} {line} klockan {depart} från {from} till {to}, 1 hållplats, {min} min.',
      'dest.sr.wait': 'Vänta {min} min.',
      'dest.sr.arrive': 'Framme {time}, {min} min totalt.',
      'dest.sr.there': 'resmålet',
      'mode.bus': 'buss', 'mode.metro': 'tunnelbana', 'mode.tram': 'spårvagn', 'mode.train': 'tåg',
      'mode.commuter_rail': 'pendeltåg', 'mode.boat': 'båt', 'mode.ferry': 'båt'
    }
  };

  function norm(lang) { return String(lang || '').toLowerCase().slice(0, 2) === 'sv' ? 'sv' : 'en'; }

  function t(lang, key, vars) {
    var s = STRINGS[norm(lang)][key];
    if (s == null) s = STRINGS.en[key];
    if (s == null) s = key;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars && vars[k] != null ? String(vars[k]) : m; });
  }

  // "08:44" stays as is; ISO timestamps are shown in Stockholm time.
  function hhmm(v) {
    if (v == null || v === '') return '';
    if (/^\d{1,2}:\d{2}$/.test(String(v))) return String(v).padStart(5, '0');
    var d = new Date(v);
    if (isNaN(d)) return String(v);
    try {
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
    } catch (e) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }

  function toMin(v) { var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm(v)); return m ? +m[1] * 60 + +m[2] : null; }
  function fromMin(n) { n = Math.round(n); n = ((n % 1440) + 1440) % 1440; return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function round(n) { return Math.max(1, Math.round(Number(n) || 0)); }

  function modeName(lang, mode) { return t(lang, 'mode.' + mode) === 'mode.' + mode ? String(mode || '') : t(lang, 'mode.' + mode); }

  function legText(lang, leg) {
    if (leg.type === 'ride') return t(lang, 'dest.leg.transit', { mode: modeName(lang, leg.mode), line: leg.line || '' }).trim();
    return t(lang, 'dest.leg.walk', { min: round(leg.minutes) });
  }

  function isRide(l) { return l && l.type === 'ride'; }

  // Latest time you can leave: first departure minus the walk before it (falls back to journey.startTime).
  function leaveTime(journey) {
    var legs = journey.legs || [];
    var walk = 0;
    for (var i = 0; i < legs.length; i++) {
      if (isRide(legs[i])) {
        var dep = toMin(legs[i].depart);
        return dep == null ? hhmm(journey.startTime) : fromMin(dep - walk);
      }
      walk += Number(legs[i].minutes) || 0;
    }
    return hhmm(journey.startTime);
  }

  function srText(lang, journey, place) {
    var legs = journey.legs || [];
    var parts = legs.map(function (leg, i) {
      if (isRide(leg)) {
        var s = '';
        if (leg.waitMinutes >= 1) s += t(lang, 'dest.sr.wait', { min: Math.round(leg.waitMinutes) }) + ' ';
        return s + t(lang, leg.stops === 1 ? 'dest.sr.ride.one' : 'dest.sr.ride', {
          mode: modeName(lang, leg.mode), line: leg.line || '', depart: hhmm(leg.depart),
          from: (leg.from && leg.from.name) || '', to: (leg.to && leg.to.name) || '',
          stops: leg.stops, min: round(leg.minutes)
        }).replace(/ {2,}/g, ' ');
      }
      var to = (leg.to && leg.to.name) || (i === legs.length - 1 ? place : t(lang, 'dest.sr.there'));
      return t(lang, 'dest.sr.walk', { min: round(leg.minutes), to: to });
    });
    parts.push(t(lang, 'dest.sr.arrive', { time: hhmm(journey.arriveTime), min: round(journey.totalMinutes) }));
    return place + '. ' + parts.join(' ');
  }

  function errorCode(err) {
    if (!err) return null;
    if (typeof err === 'string') return err;
    if (typeof err.error === 'string') return err.error;
    if (err.error && typeof err.error.code === 'string') return err.error.code;
    if (err.body && typeof err.body.error === 'string') return err.body.error;
    return typeof err.code === 'string' ? err.code : null;
  }

  // errors.js is used when loaded (window.TomforErrors, TomforMareri.use(...), or api.use(module)).
  var errorsModule = null;
  function getErrors() {
    return errorsModule || root.TomforErrors || null;
  }

  // Error body from /journey (or a thrown {status, ...body}) -> {text, srText, kind, fix}.
  function describeError(lang, err, opts) {
    opts = opts || {};
    lang = norm(lang);
    var place = opts.place || t(lang, 'dest.place');
    var code = errorCode(err);
    var text, fix = '', kind = 'error';
    if (code === 'not_reachable' || (err && err.status === 404 && !code)) {
      kind = 'outOfReach';
      var max = opts.maxTravelMinutes || (opts.request && opts.request.maxTravelMinutes);
      var n = opts.nearest;
      if (n && n.name && n.minutes != null) text = t(lang, 'dest.outOfReach', { place: place, max: max, stop: n.name, min: round(n.minutes) });
      else if (max) text = t(lang, 'dest.outOfReach.plain', { place: place, max: max });
      else text = (lang === 'sv' ? err && err.message_sv : err && err.message) || t(lang, 'dest.outOfReach.plain', { place: place, max: '?' });
      fix = t(lang, 'dest.outOfReach.fix');
    } else if (code === 'not_found') {
      kind = 'notFound';
      text = t(lang, 'dest.notFound', { q: opts.query || place });
    } else {
      var E = getErrors();
      var info = E && E.errorMessage ? E.errorMessage(lang, err) : null;
      var engine = err && (lang === 'sv' ? err.message_sv : err.message);
      var status = err && (err.status || err.statusCode);
      if (status >= 500 || code === 'street_engine_unavailable') {
        kind = 'unavailable';
        text = t(lang, 'dest.unavailable');
      } else if (info && info.key !== 'unknown' && info.key !== 'api') {
        text = info.text; fix = info.fix;
      } else if (engine && code) {
        text = engine;
      } else {
        kind = 'unavailable';
        text = t(lang, 'dest.unavailable');
      }
    }
    var full = fix ? text + ' ' + fix : text;
    return { text: full, srText: full, kind: kind, code: code || null };
  }

  // mareri /journey answer -> {text, srText, kind: 'journey'|'walkOnly'|'walkFaster'|'arriveBy'|<error kind>}.
  // opts: place (label), arriveBy + deadline, walkOnlyMinutes (from a walk-only lookup), maxTravelMinutes, nearest.
  function describeJourney(lang, journey, opts) {
    opts = opts || {};
    lang = norm(lang);
    if (!journey || journey.error || !Array.isArray(journey.legs)) return describeError(lang, journey || {}, opts);
    var place = opts.place || t(lang, 'dest.place');
    var legs = journey.legs.filter(function (l) { return isRide(l) || (Number(l.minutes) || 0) >= 0.5; });
    var rides = legs.filter(isRide);
    var total = round(journey.totalMinutes);
    var sr = srText(lang, journey, place);

    if (!rides.length) {
      return { text: t(lang, 'dest.walkOnly', { place: place, min: total }), srText: sr, kind: 'walkOnly' };
    }
    var walkAlt = Number(opts.walkOnlyMinutes);
    if (walkAlt > 0 && walkAlt <= total) {
      var w = t(lang, 'dest.walkFaster', { place: place, min: round(walkAlt) });
      return { text: w, srText: w, kind: 'walkFaster' };
    }
    var legsText = legs.map(function (l) { return legText(lang, l); }).join(t(lang, 'dest.leg.then'));
    var arriveBy = opts.arriveBy || journey.arriveBy || (opts.request && opts.request.arriveBy);
    if (arriveBy) {
      var deadline = hhmm(opts.deadline || journey.deadline || (opts.request && (opts.request.deadline || opts.request.startTime)) || journey.arriveTime);
      return {
        text: t(lang, 'dest.arriveBy', { place: place, time: leaveTime(journey), deadline: deadline, legs: legsText }),
        srText: sr, kind: 'arriveBy'
      };
    }
    return {
      text: t(lang, 'dest.sentence', { place: place, min: total, time: leaveTime(journey), legs: legsText }),
      srText: sr, kind: 'journey'
    };
  }

  // POST /t/mareri/journey. Resolves the journey; rejects with {status, error, message, message_sv} or a fetch error.
  function fetchJourney(request, target, opts) {
    opts = opts || {};
    var f = opts.fetch || root.fetch;
    var body = Object.assign({}, request, { target: { lat: Number(target.lat), lon: Number(target.lon) } });
    if (opts.origin) body.origin = { lat: Number(opts.origin.lat), lon: Number(opts.origin.lon) };
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 15000) : null;
    if (opts.signal && ctrl) opts.signal.addEventListener('abort', function () { ctrl.abort(); });
    return f(opts.endpoint || '/t/mareri/journey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign({ status: res.status }, data && typeof data === 'object' ? data : {});
        return data;
      });
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // Place picked elsewhere (e.g. filbac's search control) -> fetch /journey -> describeJourney.
  // place: {lat, lon, label?}. opts: lang, request, origin, endpoint, fetch, signal, query, walkOnlyMinutes.
  // Resolves {place, journey, error, text, srText, kind}; never rejects.
  function describeFor(place, opts) {
    opts = opts || {};
    var req = opts.request || {};
    var short = String(place.label || '').split(',')[0].trim() || t(opts.lang, 'dest.place');
    return fetchJourney(req, place, { origin: opts.origin, endpoint: opts.endpoint, signal: opts.signal, fetch: opts.fetch })
      .then(function (journey) { return { journey: journey, error: null }; }, function (error) { return { journey: null, error: error }; })
      .then(function (r) {
        var d = describeJourney(opts.lang, r.journey || r.error, {
          place: short, request: req, query: opts.query, walkOnlyMinutes: opts.walkOnlyMinutes
        });
        return { place: place, journey: r.journey, error: r.error, text: d.text, srText: d.srText, kind: d.kind };
      });
  }

  // The text the user typed in a filbac IsoSearchControl handle ({control, refreshLabels}) or in a plain input.
  function controlText(sc) {
    try {
      if (!sc) return '';
      if (typeof sc.value === 'string') return sc.value.trim();
      var box = sc.control && sc.control.getContainer ? sc.control.getContainer() : sc.getContainer ? sc.getContainer() : sc;
      var inp = box && box.querySelector && box.querySelector('input');
      return inp ? String(inp.value || '').trim() : '';
    } catch (e) { return ''; }
  }

  // "59.325, 18.071" typed directly works without search.js.
  function parseLatLon(q) {
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(q || ''));
    return m ? { label: m[1] + ', ' + m[2], lat: +m[1], lon: +m[2] } : null;
  }

  var searchModule = null;
  var base = '/colony/tomfor/';
  try {
    var src = root.document && root.document.currentScript && root.document.currentScript.src;
    if (src) base = src.replace(/[^/]*$/, '');
  } catch (e) { /* keep default */ }

  function loadModules() {
    var tasks = [];
    try {
      if (!root.TomforSearch && !searchModule) tasks.push(import(base + 'search.js').then(function (m) { searchModule = m; }).catch(function () {}));
      if (!getErrors()) tasks.push(import(base + 'errors.js').then(function (m) { errorsModule = m; }).catch(function () {}));
    } catch (e) { /* no dynamic import: coordinates only, own messages */ }
    return Promise.all(tasks);
  }

  function getSearch() { return root.TomforSearch || searchModule || null; }

  function el(doc, tag, attrs, text) {
    var e = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  // attach(container, {getOrigin, getRequest, onResult, lang, endpoint, searchControl})
  //   -> {input, live, go(place), pick(lat, lon, label), setLang, destroy}
  // getRequest(): the isochrone request behind the shown map (origin, startTime, modes, ...).
  // getOrigin(): optional {lat, lon}, overrides request.origin. lang: 'en'|'sv' or a function returning one.
  // searchControl: filbac's IsoSearchControl handle, an <input>, or true. Then no To field is created: only the
  // aria-live sentence; call pick(lat, lon) from the control's onPick (label = text typed in the control).
  // onResult({place, journey, error, text, srText, kind}).
  function attach(container, opts) {
    opts = opts || {};
    var doc = container.ownerDocument || root.document;
    var lang = function () { return norm(typeof opts.lang === 'function' ? opts.lang() : opts.lang || doc.documentElement.lang); };
    var uid = 'tomfor-dest-' + Math.random().toString(36).slice(2, 8);
    var external = !!opts.searchControl;
    var wrap = el(doc, 'div', { class: 'tomfor-dest' });
    var label = external ? null : el(doc, 'label', { for: uid + '-in' }, t(lang(), 'dest.label'));
    var input = external ? null : el(doc, 'input', {
      id: uid + '-in', type: 'search', autocomplete: 'off', role: 'combobox',
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': uid + '-list',
      placeholder: t(lang(), 'dest.placeholder')
    });
    var list = external ? null : el(doc, 'ul', { id: uid + '-list', role: 'listbox', hidden: '' });
    var live = el(doc, 'p', { class: 'tomfor-dest-result', 'aria-live': 'polite', role: 'status' });
    if (!external) { wrap.appendChild(label); wrap.appendChild(input); wrap.appendChild(list); }
    wrap.appendChild(live);
    container.appendChild(wrap);

    var searcher = null, ctrl = null, lastQuery = '';
    if (!external) loadModules();

    function say(text) { live.textContent = text; }
    function closeList() {
      if (!list) return;
      list.innerHTML = ''; list.hidden = true; input.setAttribute('aria-expanded', 'false');
    }

    function go(place) {
      closeList();
      if (input) input.value = place.label;
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var short = String(place.label || '').split(',')[0].trim() || t(lang(), 'dest.place');
      say(t(lang(), 'dest.searching', { place: short }));
      var mine = ctrl;
      return describeFor(place, {
        lang: lang(), request: (opts.getRequest && opts.getRequest()) || {}, origin: opts.getOrigin && opts.getOrigin(),
        endpoint: opts.endpoint, fetch: opts.fetch, signal: ctrl && ctrl.signal, query: lastQuery || place.label
      }).then(function (out) {
        if (mine !== ctrl) return null;
        say(out.text);
        if (opts.onResult) opts.onResult(out);
        return out;
      });
    }

    function pick(lat, lon, text) {
      var typed = text || controlText(opts.searchControl === true ? null : opts.searchControl);
      lastQuery = typed;
      return go({ lat: +lat, lon: +lon, label: typed });
    }

    function show(results) {
      list.innerHTML = '';
      if (!results.length) {
        say(t(lang(), 'dest.notFound', { q: lastQuery }));
        return closeList();
      }
      results.forEach(function (r, i) {
        var li = el(doc, 'li', { role: 'option', id: uid + '-o' + i, tabindex: '-1' }, r.label);
        li.addEventListener('click', function () { go(r); });
        li.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(r); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function onInput() {
      lastQuery = input.value.trim();
      var direct = parseLatLon(lastQuery);
      if (direct) return closeList();
      var S = getSearch();
      if (!S || lastQuery.length < 3) return closeList();
      if (!searcher) searcher = S.createSearcher({ lang: lang });
      searcher.search(lastQuery).then(show, function (e) {
        if (e && e.name === 'AbortError') return;
        say(describeError(lang(), e && e.code === 'search_failed' ? e : { code: 'search_failed' }).text);
      });
    }

    function onKey(e) {
      if (e.key === 'Escape') { closeList(); return; }
      if (e.key === 'ArrowDown' && list.firstChild) { e.preventDefault(); list.firstChild.focus(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var direct = parseLatLon(input.value);
      if (direct) { go(direct); return; }
      var first = list.firstChild;
      if (first) first.click();
    }

    if (input) {
      input.addEventListener('input', onInput);
      input.addEventListener('keydown', onKey);
    }

    return {
      input: input, live: live, go: go, pick: pick,
      setLang: function (l) {
        opts.lang = l;
        if (label) { label.textContent = t(lang(), 'dest.label'); input.placeholder = t(lang(), 'dest.placeholder'); }
      },
      destroy: function () { if (searcher) searcher.cancel(); if (ctrl) ctrl.abort(); wrap.remove(); }
    };
  }

  var api = {
    strings: STRINGS,
    t: t,
    describeJourney: describeJourney,
    describeError: describeError,
    fetchJourney: fetchJourney,
    describeFor: describeFor,
    parseLatLon: parseLatLon,
    attach: attach,
    use: function (mod) { if (mod && mod.errorMessage) errorsModule = mod; if (mod && mod.createSearcher) searchModule = mod; return api; },
    ready: null
  };
  api.ready = root.document ? loadModules().then(function () { return api; }) : Promise.resolve(api);
  root.TomforDestination = api;
})(typeof window !== 'undefined' ? window : globalThis);
