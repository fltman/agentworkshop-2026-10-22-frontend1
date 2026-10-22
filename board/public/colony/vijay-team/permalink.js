// Shareable links and export for an isochrone search.
//   VijayPermalink.encode(body)            -> 'o=59.3303,18.0586&t=08:00&m=30&w=7&x=3&modes=bus,metro&a=10,10,5&b=5&ab=1'
//   VijayPermalink.decode(string)          -> request body (validated, unknown keys ignored), or null if there is no origin
//   VijayPermalink.url(base, body)         -> base + '#' + encode(body)
//   VijayPermalink.fromLocation()          -> decode(window.location.hash), browser only
//   VijayPermalink.geojson(fc)             -> pretty GeoJSON string of an engine answer
//   VijayPermalink.stationsCSV(fc, stops)  -> 'name,lat,lon,minutes' for every reached station (needs compare.js)
//   VijayPermalink.download(name, text, mime)   browser only
(function () {
  var MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];

  function encode(b) {
    var p = [];
    if (b.origin) p.push('o=' + Number(b.origin.lat).toFixed(5) + ',' + Number(b.origin.lon).toFixed(5));
    if (b.startTime) p.push('t=' + b.startTime);
    if (b.maxTravelMinutes != null) p.push('m=' + b.maxTravelMinutes);
    if (b.maxWaitMinutes != null) p.push('w=' + b.maxWaitMinutes);
    if (b.maxTransfers != null) p.push('x=' + b.maxTransfers);
    if (b.modes) p.push('modes=' + b.modes.join(','));
    if (b.walking) p.push('a=' + [b.walking.accessMinutes, b.walking.egressMinutes, b.walking.transferMinutes].join(','));
    if (b.bandMinutes != null) p.push('b=' + b.bandMinutes);
    if (b.arriveBy) p.push('ab=1');
    return p.join('&');
  }

  function num(v, min, max) {
    var n = Number(v);
    return isFinite(n) && n >= min && n <= max ? n : undefined;
  }

  function decode(str) {
    var s = String(str || '').replace(/^[#?]/, '');
    var kv = {};
    s.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) kv[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
    var o = (kv.o || '').split(',');
    var lat = num(o[0], -90, 90);
    var lon = num(o[1], -180, 180);
    if (lat === undefined || lon === undefined) return null;
    var body = { origin: { lat: lat, lon: lon } };
    if (/^\d{1,2}:\d{2}$/.test(kv.t || '')) body.startTime = kv.t;
    var m = num(kv.m, 1, 240); if (m !== undefined) body.maxTravelMinutes = m;
    var w = num(kv.w, 0, 120); if (w !== undefined) body.maxWaitMinutes = w;
    var x = num(kv.x, 0, 10); if (x !== undefined) body.maxTransfers = x;
    var b = num(kv.b, 1, 60); if (b !== undefined) body.bandMinutes = b;
    if (kv.modes) {
      var modes = kv.modes.split(',').filter(function (v) { return MODES.indexOf(v) >= 0; });
      if (modes.length) body.modes = modes;
    }
    if (kv.a) {
      var a = kv.a.split(',').map(function (v) { return num(v, 0, 120); });
      if (a.length === 3 && a.every(function (v) { return v !== undefined; })) body.walking = { accessMinutes: a[0], egressMinutes: a[1], transferMinutes: a[2] };
    }
    if (kv.ab === '1') body.arriveBy = true;
    return body;
  }

  function url(base, body) { return base + '#' + encode(body); }
  function fromLocation() { return decode(window.location.hash); }

  function geojson(fc) { return JSON.stringify(fc, null, 2); }

  function csvCell(v) { return /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); }

  function stationsCSV(fc, stops) {
    var C = typeof module !== 'undefined' && module.exports ? require('./compare.js') : window.VijayCompare;
    var rows = ['name,lat,lon,minutes'];
    stops.forEach(function (s) {
      var t = C.stopMinutes(fc, s);
      if (t !== null) rows.push([csvCell(s.name), s.lat, s.lon, t].join(','));
    });
    return rows.join('\n');
  }

  function download(name, text, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var api = { encode: encode, decode: decode, url: url, fromLocation: fromLocation, geojson: geojson, stationsCSV: stationsCSV, download: download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayPermalink = api;
})();
