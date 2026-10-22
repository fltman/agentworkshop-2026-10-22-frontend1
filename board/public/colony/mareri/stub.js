// Test stub, only used with ?stub=1. Mimics marlin's response shape (cumulative bands, outermost first).
window.StubEngine = function (req) {
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      if (req.modes.length === 1 && req.modes[0] === 'boat') {
        reject(Object.assign(new Error('nothing_reachable'), {
          status: 422,
          engineMessage: 'Stops were found, but no departure fits the constraints.',
          engineMessageSv: 'Hållplatser hittades, men ingen avgång passar kraven.'
        }));
        return;
      }
      function ring(r) {
        var pts = [];
        var cos = Math.cos(req.origin.lat * Math.PI / 180);
        for (var i = 0; i <= 48; i++) {
          var a = (i / 48) * 2 * Math.PI;
          pts.push([req.origin.lon + (r * Math.cos(a)) / (111320 * cos), req.origin.lat + (r * Math.sin(a)) / 111320]);
        }
        return pts;
      }
      var features = [];
      for (var to = req.maxTravelMinutes; to >= 5; to -= 5) {
        features.push({
          type: 'Feature',
          properties: { fromMinutes: to - 5, toMinutes: to, bandIndex: to / 5 },
          geometry: { type: 'MultiPolygon', coordinates: [[ring(to * 120)]] }
        });
      }
      resolve({ type: 'FeatureCollection', features: features, meta: { cumulativeBands: true, source: 'stub' } });
    }, 300);
  });
};
