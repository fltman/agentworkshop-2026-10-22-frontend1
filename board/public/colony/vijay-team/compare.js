// Meeting-point and reliability helpers on top of marlin's /t/marlin/isochrone answers.
// Pure client-side: no engine change. Works in the browser (window.VijayCompare) and in node (require).
//
//   const stops = await (await fetch('/t/vijay-team/stops')).json();
//   const a = await iso({ origin: A, ... }), b = await iso({ origin: B, ... });
//   VijayCompare.meeting(a, b, stops, { by: 'max' }).best      // fairest meeting station
//   VijayCompare.reliability(await VijayCompare.sample(iso, body, '08:00', 20, 5), stops, 0.8)
//
// Bands from marlin are cumulative; a station's time is the toMinutes of the smallest band that contains it.
// Use bandMinutes 1 or 2 for finer meeting-point ranking.
(function () {
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygon(x, y, poly) {
    if (!inRing(x, y, poly[0])) return false;
    for (var h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
    return true;
  }
  function inFeature(x, y, f) {
    var g = f.geometry;
    if (!g) return false;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (var i = 0; i < polys.length; i++) if (inPolygon(x, y, polys[i])) return true;
    return false;
  }

  // Minutes (band upper bound) at which a station is reached, or null.
  function stopMinutes(fc, s) {
    var best = null;
    (fc.features || []).forEach(function (f) {
      var t = f.properties.toMinutes;
      if ((best === null || t < best) && inFeature(s.lon, s.lat, f)) best = t;
    });
    return best;
  }

  // Stations reachable from both origins, ranked by the longer journey ('max', default) or the sum ('sum').
  function meeting(fcA, fcB, stops, opts) {
    var by = (opts && opts.by) || 'max';
    var limit = (opts && opts.limit) || 10;
    var rows = [];
    stops.forEach(function (s) {
      var a = stopMinutes(fcA, s);
      if (a === null) return;
      var b = stopMinutes(fcB, s);
      if (b === null) return;
      rows.push({ index: s.index, name: s.name, lat: s.lat, lon: s.lon, modes: s.modes, minutesA: a, minutesB: b, max: Math.max(a, b), sum: a + b });
    });
    rows.sort(function (x, y) { return x[by] - y[by] || x.sum - y.sum; });
    return { common: rows.length, best: rows[0] || null, top: rows.slice(0, limit) };
  }

  // Best place to live: stations that reach EVERY pin in time. Pass one answer per pin (e.g. arrive-by from each workplace).
  // Ranked by the longest of the journeys ('max', default) or their sum ('sum'); `minutes` lists each pin's time.
  function commonAll(fcs, stops, opts) {
    var by = (opts && opts.by) || 'max';
    var limit = (opts && opts.limit) || 10;
    var rows = [];
    stops.forEach(function (s) {
      var minutes = [];
      for (var i = 0; i < fcs.length; i++) {
        var m = stopMinutes(fcs[i], s);
        if (m === null) return;
        minutes.push(m);
      }
      var max = Math.max.apply(null, minutes);
      var sum = minutes.reduce(function (a, b) { return a + b; }, 0);
      rows.push({ index: s.index, name: s.name, lat: s.lat, lon: s.lon, modes: s.modes, minutes: minutes, max: max, sum: sum });
    });
    rows.sort(function (x, y) { return x[by] - y[by] || x.sum - y.sum; });
    return { common: rows.length, best: rows[0] || null, top: rows.slice(0, limit) };
  }

  var RELAX = [
    { key: 'transfer', label: { en: '+1 transfer', sv: '+1 byte' }, patch: function (b) { return { maxTransfers: (b.maxTransfers || 3) + 1 }; } },
    { key: 'wait', label: { en: '+5 min waiting', sv: '+5 min väntetid' }, patch: function (b) { return { maxWaitMinutes: (b.maxWaitMinutes || 7) + 5 }; } },
    {
      key: 'walk', label: { en: '+5 min walking', sv: '+5 min gångtid' },
      patch: function (b) {
        var w = b.walking || {};
        return { walking: Object.assign({}, w, { accessMinutes: (w.accessMinutes || 10) + 5, egressMinutes: (w.egressMinutes || 10) + 5, transferMinutes: (w.transferMinutes || 5) + 5 }) };
      },
    },
  ];

  // "Why not here?": reruns with one limit relaxed at a time and counts the stations each relaxation unlocks.
  // Returns { base, unlocks: [{ key, label, newStations, stations }] }, biggest unlock first: the binding constraint.
  function unlock(iso, body, stops) {
    var jobs = [iso(body)].concat(RELAX.map(function (r) { return iso(Object.assign({}, body, r.patch(body))); }));
    return Promise.all(jobs).then(function (fcs) {
      var base = new Set();
      stops.forEach(function (s) { if (stopMinutes(fcs[0], s) !== null) base.add(s.index); });
      var unlocks = RELAX.map(function (r, i) {
        var added = stops.filter(function (s) { return !base.has(s.index) && stopMinutes(fcs[i + 1], s) !== null; });
        return { key: r.key, label: r.label, newStations: added.length, stations: added };
      });
      unlocks.sort(function (a, b) { return b.newStations - a.newStations; });
      return { base: base.size, unlocks: unlocks };
    });
  }

  // Return trip: places you can reach going out AND get back from before a deadline. Two engine calls (forward from `start`,
  // arrive-by at `returnBy`), intersected by station. `stranded` = reachable going out but no way back in time; `tooTight` =
  // both directions exist but out + back + stayMinutes does not fit in the window (times are band upper bounds, so conservative).
  //   VijayCompare.roundTrip(iso, body, stops, { start: '21:00', returnBy: '23:30' })
  function roundTrip(iso, body, stops, opts) {
    var o = opts || {};
    var toMin = function (t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
    var window = (toMin(o.returnBy) - toMin(o.start) + 1440) % 1440;
    var stay = o.stayMinutes || 0;
    var out = Object.assign({}, body, { startTime: o.start });
    var back = Object.assign({}, body, { startTime: o.returnBy, arriveBy: true });
    return Promise.all([iso(out), iso(back)]).then(function (res) {
      var both = [];
      var stranded = [];
      var tooTight = [];
      stops.forEach(function (s) {
        var a = stopMinutes(res[0], s);
        if (a === null) return;
        var b = stopMinutes(res[1], s);
        var row = { index: s.index, name: s.name, lat: s.lat, lon: s.lon, minutesOut: a, minutesBack: b };
        if (b === null) stranded.push(row);
        else if (a + b + stay > window) tooTight.push(row);
        else both.push(row);
      });
      both.sort(function (x, y) { return x.minutesOut + x.minutesBack - (y.minutesOut + y.minutesBack); });
      var total = both.length + stranded.length + tooTight.length;
      return { both: both, stranded: stranded, tooTight: tooTight, outbound: total, windowMinutes: window, canReturnShare: both.length / Math.max(total, 1) };
    });
  }

  function hhmmAdd(start, minutes) {
    var p = start.split(':');
    var t = (Number(p[0]) * 60 + Number(p[1]) + minutes) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  // Runs iso(body) at start, start+step, ... over a window; iso is any function returning a Promise of a FeatureCollection.
  function sample(iso, body, startHHMM, windowMinutes, stepMinutes) {
    var times = [];
    for (var m = 0; m <= windowMinutes; m += stepMinutes) times.push(hhmmAdd(startHHMM, m));
    return Promise.all(times.map(function (t) {
      return iso(Object.assign({}, body, { startTime: t }));
    })).then(function (fcs) { return { times: times, results: fcs }; });
  }

  // Share of samples in which each station is reachable; "reliable" = at least minShare of the samples.
  function reliability(sampled, stops, minShare) {
    var share = minShare === undefined ? 0.8 : minShare;
    var n = sampled.results.length;
    var rows = [];
    stops.forEach(function (s) {
      var hit = 0;
      sampled.results.forEach(function (fc) { if (stopMinutes(fc, s) !== null) hit++; });
      if (hit) rows.push({ index: s.index, name: s.name, lat: s.lat, lon: s.lon, reached: hit, samples: n, share: hit / n });
    });
    var reliable = rows.filter(function (r) { return r.share >= share; });
    return {
      samples: n, times: sampled.times, anyCount: rows.length, reliableCount: reliable.length,
      luckyCount: rows.length - reliable.length, reliable: reliable, rows: rows,
    };
  }

  var api = { roundTrip: roundTrip, inFeature: inFeature, stopMinutes: stopMinutes, meeting: meeting, commonAll: commonAll, unlock: unlock, sample: sample, reliability: reliability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayCompare = api;
})();
