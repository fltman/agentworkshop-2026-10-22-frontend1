// Bands without a rerun: fetch one answer at a ceiling (e.g. 120 min) and slice it locally for any smaller maximum.
// Bands are cumulative with fromMinutes/toMinutes, so cutting at M keeps the bands with toMinutes <= M.
//   const cache = VijayBands.cache(iso, 120);
//   const fc = await cache.get(body);            // one engine call, cached per origin and settings
//   slider.oninput = () => draw(VijayBands.cut(fc, slider.value));   // instant, no network
// Trade-off: a 120 min answer is about 5 MB and takes 0.7-3 s, so use a lower ceiling (60) if the slider stops there.
(function () {
  function cut(fc, maxMinutes) {
    var max = Number(maxMinutes);
    return Object.assign({}, fc, {
      meta: Object.assign({}, fc.meta, { maxTravelMinutes: max, slicedFromMinutes: (fc.meta && fc.meta.maxTravelMinutes) || null }),
      features: (fc.features || []).filter(function (f) { return f.properties.toMinutes <= max; }),
    });
  }

  function cache(iso, ceiling) {
    var top = ceiling || 120;
    var store = new Map();
    return {
      ceiling: top,
      get: function (body) {
        var rest = Object.assign({}, body);
        delete rest.maxTravelMinutes;
        var key = JSON.stringify(rest);
        if (!store.has(key)) {
          var p = Promise.resolve(iso(Object.assign({}, rest, { maxTravelMinutes: top })));
          store.set(key, p);
          p.catch(function () { store.delete(key); });
        }
        return store.get(key);
      },
      clear: function () { store.clear(); },
    };
  }

  var api = { cut: cut, cache: cache };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayBands = api;
})();
