// Service-quality layer for a Leaflet map: every station coloured by its average headway in a time window.
//   const layer = VijayService.attach(map);            // rush hour 07-09 on a weekday
//   layer.setWindow('22:00', '23:59');                 // late evening: where does service thin out?
//   layer.setDay('sunday'); layer.setVisible(false);
// Colours: green <= 7 min, yellow <= 15, orange <= 30, red > 30, grey = no departure in the window (service desert).
(function () {
  var BASE = '/t/vijay-team';
  var BUCKETS = [
    { max: 7, color: '#1a9850', en: 'every 7 min or better', sv: 'var 7:e minut eller tätare' },
    { max: 15, color: '#fee08b', en: 'every 8-15 min', sv: 'var 8-15:e minut' },
    { max: 30, color: '#f46d43', en: 'every 16-30 min', sv: 'var 16-30:e minut' },
    { max: Infinity, color: '#a50026', en: 'less often than every 30 min', sv: 'glesare än var 30:e minut' },
    { max: null, color: '#9e9e9e', en: 'no service in this window', sv: 'ingen trafik under tidsfönstret' },
  ];

  function bucketOf(h) {
    if (h === null) return BUCKETS[4];
    for (var i = 0; i < 4; i++) if (h <= BUCKETS[i].max) return BUCKETS[i];
    return BUCKETS[3];
  }

  function attach(map, opts) {
    opts = opts || {};
    var state = { day: opts.day || 'weekday', from: opts.from || '07:00', to: opts.to || '09:00', visible: opts.visible !== false };
    var group = L.layerGroup();
    var renderer = L.canvas({ padding: 0.5 });
    var stopsByDay = {};
    var lastCounts = null;

    function getStops() {
      if (!stopsByDay[state.day]) stopsByDay[state.day] = fetch(BASE + '/stops?day=' + state.day).then(function (r) { return r.json(); });
      return stopsByDay[state.day];
    }

    function draw() {
      return Promise.all([
        getStops(),
        fetch(BASE + '/frequency?day=' + state.day + '&from=' + state.from + '&to=' + state.to).then(function (r) { return r.json(); }),
      ]).then(function (res) {
        var stops = res[0];
        var head = new Map();
        (res[1].stops || []).forEach(function (s) { head.set(s.index, s.avgHeadwayMin); });
        group.clearLayers();
        var counts = BUCKETS.map(function () { return 0; });
        stops.forEach(function (s) {
          var h = head.has(s.index) ? head.get(s.index) : null;
          var b = bucketOf(h);
          counts[BUCKETS.indexOf(b)]++;
          L.circleMarker([s.lat, s.lon], { renderer: renderer, radius: 3, weight: 0, fillOpacity: 0.85, fillColor: b.color })
            .bindTooltip(s.name + (h === null ? ': no service' : ': every ' + h + ' min'))
            .addTo(group);
        });
        lastCounts = counts;
        return counts;
      });
    }

    var api = {
      layer: group,
      buckets: BUCKETS,
      counts: function () { return lastCounts; },
      setWindow: function (from, to) { state.from = from; state.to = to; return draw(); },
      setDay: function (day) { state.day = day; return draw(); },
      refresh: draw,
      setVisible: function (on) {
        state.visible = !!on;
        if (on) group.addTo(map); else map.removeLayer(group);
      },
    };
    if (state.visible) group.addTo(map);
    draw();
    return api;
  }

  window.VijayService = { attach: attach, buckets: BUCKETS, bucketOf: bucketOf };
})();
