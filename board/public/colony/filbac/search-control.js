// Drop-in Leaflet control: address search + "use my location". Classic script, no build step.
// Usage in any map app (needs Leaflet loaded first):
//   <script src="/colony/filbac/search-control.js"></script>
//   IsoSearchControl.add(map, { lang: function () { return lang; }, onPick: function (lat, lon) { ... } });
// onPick receives the chosen coordinates; the host app moves its pin and recalculates as it likes.
(function () {
  'use strict';

  var TEXT = {
    en: { placeholder: 'Search address or place', go: 'Search', locate: 'Use my location', none: 'No place found.' },
    sv: { placeholder: 'Sök adress eller plats', go: 'Sök', locate: 'Använd min position', none: 'Ingen plats hittades.' },
  };

  var modules = null;
  function load() {
    if (!modules) {
      modules = Promise.all([
        import('/colony/tomfor/search.js'),
        import('/colony/tomfor/errors.js'),
      ]).then(function (m) { return { search: m[0], errors: m[1] }; });
    }
    return modules;
  }

  function add(map, opts) {
    opts = opts || {};
    var getLang = opts.lang || function () { return 'en'; };
    var tx = function (k) { return (TEXT[getLang()] || TEXT.en)[k]; };

    var Control = L.Control.extend({
      options: { position: opts.position || 'topright' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'iso-search leaflet-bar');
        box.style.cssText = 'background:#fff;padding:6px;display:flex;flex-wrap:wrap;gap:6px;max-width:min(320px,80vw);';
        var input = L.DomUtil.create('input', '', box);
        input.type = 'search';
        input.style.cssText = 'flex:1;min-width:0;min-height:40px;padding:0 10px;font:inherit;border:1px solid #c7ccd1;border-radius:6px;';
        var go = L.DomUtil.create('button', '', box);
        go.type = 'button';
        go.style.cssText = 'min-height:40px;padding:0 12px;font:inherit;border:1px solid #c7ccd1;border-radius:6px;background:#f6f8fa;cursor:pointer;';
        var loc = L.DomUtil.create('button', '', box);
        loc.type = 'button';
        loc.textContent = '\u25CE';
        loc.style.cssText = go.style.cssText + 'font-size:18px;';
        var msg = L.DomUtil.create('div', '', box);
        msg.setAttribute('role', 'status');
        msg.style.cssText = 'flex-basis:100%;font-size:13px;color:#b42318;';

        function labels() {
          input.placeholder = tx('placeholder');
          input.setAttribute('aria-label', tx('placeholder'));
          go.textContent = tx('go');
          loc.title = tx('locate');
          loc.setAttribute('aria-label', tx('locate'));
        }
        labels();
        box._refreshLabels = labels;

        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);

        function fail(m, e) { msg.textContent = m.errors.errorMessage(getLang(), e).message; }
        function pick(lat, lon) {
          msg.textContent = '';
          map.setView([lat, lon], Math.max(map.getZoom(), 13));
          if (opts.onPick) opts.onPick(lat, lon);
        }
        function doSearch() {
          var q = input.value.trim();
          msg.textContent = '';
          if (!q) return;
          load().then(function (m) {
            return m.search.searchAddress(q, { lang: getLang(), limit: 1 }).then(function (hits) {
              if (!hits.length) { msg.textContent = tx('none'); return; }
              pick(hits[0].lat, hits[0].lon);
            }).catch(function (e) { fail(m, e); });
          });
        }
        go.addEventListener('click', doSearch);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });
        loc.addEventListener('click', function () {
          msg.textContent = '';
          load().then(function (m) {
            return m.search.locate().then(function (p) { pick(p.lat, p.lon); }).catch(function (e) { fail(m, e); });
          });
        });
        return box;
      },
    });

    var control = new Control();
    control.addTo(map);
    return {
      control: control,
      // call after the host app switches language
      refreshLabels: function () {
        var el = control.getContainer();
        if (el && el._refreshLabels) el._refreshLabels();
      },
    };
  }

  window.IsoSearchControl = { add: add };
})();
