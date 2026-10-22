// Difference between two isochrone answers (same origin at two times, weekday vs Sunday, with vs without a mode...).
//   const d = VijayDiff.stations(fcA, fcB, stops);   // { gained, lost, faster, slower, same }  (B relative to A)
//   VijayDiff.attach(map, fcA, fcB, { cellM: 500 }); // green = only in B (gained), red = only in A (lost)
// Station level is exact to the band size; the grid view tests cell centres against each answer's outermost band.
(function () {
  var C = typeof module !== 'undefined' && module.exports ? require('./compare.js') : window.VijayCompare;

  function stations(fcA, fcB, stops) {
    var out = { gained: [], lost: [], faster: [], slower: [], same: 0 };
    stops.forEach(function (s) {
      var a = C.stopMinutes(fcA, s);
      var b = C.stopMinutes(fcB, s);
      if (a === null && b === null) return;
      var row = { index: s.index, name: s.name, lat: s.lat, lon: s.lon, minutesA: a, minutesB: b };
      if (a === null) out.gained.push(row);
      else if (b === null) out.lost.push(row);
      else if (b < a) out.faster.push(row);
      else if (b > a) out.slower.push(row);
      else out.same++;
    });
    return out;
  }

  function outer(fc) {
    var best = null;
    (fc.features || []).forEach(function (f) { if (!best || f.properties.toMinutes > best.properties.toMinutes) best = f; });
    return best;
  }

  function bbox(feats) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    feats.forEach(function (f) {
      var g = f.geometry;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      polys.forEach(function (poly) {
        poly[0].forEach(function (p) {
          if (p[0] < b[0]) b[0] = p[0];
          if (p[1] < b[1]) b[1] = p[1];
          if (p[0] > b[2]) b[2] = p[0];
          if (p[1] > b[3]) b[3] = p[1];
        });
      });
    });
    return b;
  }

  // Cells that are reachable in only one of the answers. Cell size grows automatically to stay under maxCells.
  function grid(fcA, fcB, opts) {
    var oa = outer(fcA);
    var ob = outer(fcB);
    if (!oa || !ob) return { cellM: 0, cells: [], gainedKm2: 0, lostKm2: 0 };
    var b = bbox([oa, ob]);
    var cellM = (opts && opts.cellM) || 500;
    var maxCells = (opts && opts.maxCells) || 40000;
    var lat0 = (b[1] + b[3]) / 2;
    var kmLat = 111.32 / 1;
    var kmLon = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    var w = (b[2] - b[0]) * kmLon * 1000;
    var h = (b[3] - b[1]) * kmLat * 1000;
    while ((w / cellM) * (h / cellM) > maxCells) cellM *= 1.25;
    var dLat = cellM / 1000 / kmLat;
    var dLon = cellM / 1000 / kmLon;
    var cells = [];
    var gained = 0;
    var lost = 0;
    for (var lat = b[1]; lat < b[3]; lat += dLat) {
      for (var lon = b[0]; lon < b[2]; lon += dLon) {
        var x = lon + dLon / 2;
        var y = lat + dLat / 2;
        var inA = C.inFeature(x, y, oa);
        var inB = C.inFeature(x, y, ob);
        if (inA === inB) continue;
        cells.push({ south: lat, west: lon, north: lat + dLat, east: lon + dLon, state: inB ? 'gained' : 'lost' });
        if (inB) gained++; else lost++;
      }
    }
    var km2 = (cellM / 1000) * (cellM / 1000);
    return { cellM: Math.round(cellM), cells: cells, gainedKm2: Math.round(gained * km2 * 10) / 10, lostKm2: Math.round(lost * km2 * 10) / 10 };
  }

  function attach(map, fcA, fcB, opts) {
    var g = grid(fcA, fcB, opts);
    var layer = L.layerGroup(g.cells.map(function (c) {
      return L.rectangle([[c.south, c.west], [c.north, c.east]], {
        weight: 0, fillOpacity: 0.45, fillColor: c.state === 'gained' ? '#1a9850' : '#d73027', interactive: false,
      });
    })).addTo(map);
    return { layer: layer, gainedKm2: g.gainedKm2, lostKm2: g.lostKm2, cellM: g.cellM };
  }

  var api = { stations: stations, grid: grid, attach: attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayDiff = api;
})();
