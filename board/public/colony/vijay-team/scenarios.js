// Saved scenarios: keep favourite origins and settings in the browser (localStorage), export and import them as JSON.
//   VijayScenarios.save('Home to work', { origin, body, note })   // returns the stored scenario with an id
//   VijayScenarios.list() / get(id) / remove(id) / rename(id, name)
//   VijayScenarios.exportJSON() -> string, VijayScenarios.importJSON(string) -> number added
// body is the isochrone request body, so a saved scenario can be re-run with iso(scenario.body).
// Nothing leaves the browser. In node (tests) an in-memory store is used.
(function () {
  var KEY = 'vijay-team.scenarios.v1';
  var MAX = 50;
  var mem = {};
  var memStore = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; } };
  var store = memStore;
  try {
    // private mode or blocked storage throws; fall back to memory so the page still works
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') {
      window.localStorage.setItem(KEY + '.probe', '1');
      window.localStorage.removeItem(KEY + '.probe');
      store = window.localStorage;
    }
  } catch (e) {
    store = memStore;
  }

  function read() {
    try {
      var v = JSON.parse(store.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) { store.setItem(KEY, JSON.stringify(list.slice(0, MAX))); }
  function id() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function valid(s) {
    return s && typeof s.name === 'string' && s.name.trim() && s.origin && Number.isFinite(s.origin.lat) && Number.isFinite(s.origin.lon) && s.body && typeof s.body === 'object';
  }

  function save(name, data) {
    var s = { id: id(), name: String(name).trim(), savedAt: new Date().toISOString(), origin: data && data.origin, body: data && data.body, note: (data && data.note) || '' };
    if (!valid(s)) throw new Error('scenario needs a name, origin {lat, lon} and body');
    var list = read();
    list.unshift(s);
    write(list);
    return s;
  }
  function importJSON(text) {
    var incoming = JSON.parse(text);
    if (!Array.isArray(incoming)) throw new Error('expected a JSON array of scenarios');
    var list = read();
    var have = new Set(list.map(function (s) { return s.id; }));
    var added = 0;
    incoming.forEach(function (s) {
      if (!valid(s) || have.has(s.id)) return;
      list.push({ id: String(s.id || id()), name: s.name, savedAt: s.savedAt || new Date().toISOString(), origin: s.origin, body: s.body, note: s.note || '' });
      added++;
    });
    write(list);
    return added;
  }

  var api = {
    save: save,
    list: read,
    get: function (i) { return read().find(function (s) { return s.id === i; }) || null; },
    remove: function (i) { var l = read(); var n = l.filter(function (s) { return s.id !== i; }); write(n); return l.length - n.length; },
    rename: function (i, name) {
      var l = read();
      var s = l.find(function (x) { return x.id === i; });
      if (!s || !String(name).trim()) return false;
      s.name = String(name).trim();
      write(l);
      return true;
    },
    exportJSON: function () { return JSON.stringify(read(), null, 2); },
    importJSON: importJSON,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayScenarios = api;
})();
