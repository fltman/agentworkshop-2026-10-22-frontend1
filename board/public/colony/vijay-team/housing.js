// Housing view: rank candidate homes by price and travel time. We ship NO price data: bring your own points
// (CSV with a header row: lat,lon,price,label  or an array of { lat, lon, price, label }), from any open source you trust.
//   const homes = VijayHousing.fromCSV(text);
//   const r = VijayHousing.analyze(homes, isochroneAnswer);       // adds minutes (band upper bound, null = out of reach)
//   VijayHousing.cheapestWithin(r, 30)                            // cheapest homes reachable in 30 min
//   VijayHousing.byBand(r)                                        // [{ toMinutes, count, medianPrice }]
(function () {
  var C = typeof module !== 'undefined' && module.exports ? require('./compare.js') : window.VijayCompare;

  function fromCSV(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var head = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });
    var col = function (n) { return head.indexOf(n); };
    if (col('lat') < 0 || col('lon') < 0 || col('price') < 0) throw new Error('CSV header needs lat, lon, price');
    var out = [];
    lines.slice(1).forEach(function (l) {
      var c = l.split(',');
      var h = { lat: Number(c[col('lat')]), lon: Number(c[col('lon')]), price: Number(c[col('price')]), label: col('label') >= 0 ? (c[col('label')] || '').trim() : '' };
      if (Number.isFinite(h.lat) && Number.isFinite(h.lon) && Number.isFinite(h.price)) out.push(h);
    });
    return out;
  }

  function analyze(homes, fc) {
    return homes.map(function (h) { return Object.assign({}, h, { minutes: C.stopMinutes(fc, { lat: h.lat, lon: h.lon }) }); });
  }

  function cheapestWithin(rows, minutes, limit) {
    return rows
      .filter(function (r) { return r.minutes !== null && r.minutes <= minutes; })
      .sort(function (a, b) { return a.price - b.price; })
      .slice(0, limit || 10);
  }

  function byBand(rows) {
    var groups = {};
    rows.forEach(function (r) { if (r.minutes !== null) (groups[r.minutes] = groups[r.minutes] || []).push(r.price); });
    return Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).map(function (m) {
      var p = groups[m].sort(function (a, b) { return a - b; });
      var mid = p.length >> 1;
      return { toMinutes: m, count: p.length, medianPrice: p.length % 2 ? p[mid] : (p[mid - 1] + p[mid]) / 2 };
    });
  }

  var api = { fromCSV: fromCSV, analyze: analyze, cheapestWithin: cheapestWithin, byBand: byBand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayHousing = api;
})();
