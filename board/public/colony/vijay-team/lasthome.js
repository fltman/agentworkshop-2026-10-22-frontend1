// "Last way home": the latest time you can leave `body.origin` and still reach `home` within body.maxTravelMinutes.
//   const r = await VijayLastHome.find(iso, body, { home: { lat, lon }, after: '18:00', latest: '23:59' });
//   r.lastStart   // '23:12', or null when there is no way home in the window
//   r.minutes     // journey time at that departure (band upper bound)
// Scans backwards from `latest` in coarse steps, then bisects to the minute. Typically 6-10 engine calls.
// Needs compare.js loaded for the point-in-band check.
(function () {
  function toMin(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function find(iso, body, opts) {
    var C = typeof module !== 'undefined' && module.exports ? require('./compare.js') : window.VijayCompare;
    var home = opts.home;
    var lo = toMin(opts.after || '00:00');
    var hi = Math.min(toMin(opts.latest || '23:59'), 1439);
    var step = opts.stepMinutes || 20;
    var calls = 0;

    function reach(m) {
      calls++;
      return Promise.resolve(iso(Object.assign({}, body, { startTime: hhmm(m) }))).then(function (fc) {
        return C.stopMinutes(fc, home);
      });
    }

    // coarse scan downwards for the first time that works
    function scan(m, lastFail) {
      if (m < lo) return Promise.resolve({ lastStart: null, minutes: null, calls: calls });
      return reach(m).then(function (t) {
        if (t === null) return scan(m - step, m);
        if (lastFail === undefined) return { lastStart: hhmm(m), minutes: t, calls: calls };
        return bisect(m, t, lastFail);
      });
    }

    // good works, bad does not, good < bad: find the latest working minute
    function bisect(good, goodMinutes, bad) {
      if (bad - good <= 1) return Promise.resolve({ lastStart: hhmm(good), minutes: goodMinutes, calls: calls });
      var mid = Math.floor((good + bad) / 2);
      return reach(mid).then(function (t) {
        return t === null ? bisect(good, goodMinutes, mid) : bisect(mid, t, bad);
      });
    }

    return scan(hi);
  }

  var api = { find: find };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayLastHome = api;
})();
