// Time-of-day animation: the reachable area from one origin through the day (05:00 ... 23:30), so you can watch it breathe.
//   const frames = await VijayTimelapse.frames(iso, body, { from: '05:00', to: '23:30', stepMinutes: 30 });
//   VijayTimelapse.play(frames, (frame) => draw(frame.fc), { fps: 2 });      // returns { stop }
//   VijayTimelapse.series(frames, stops)    // [{ time, stations }] for a chart, needs compare.js loaded
// Engine calls run a few at a time so one animation does not hog the shared server.
(function () {
  function toMin(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function times(from, to, step) {
    var out = [];
    for (var m = toMin(from); m <= toMin(to); m += step) out.push(hhmm(m));
    return out;
  }

  function frames(iso, body, opts) {
    var o = opts || {};
    var list = times(o.from || '05:00', o.to || '23:30', o.stepMinutes || 30);
    var lanes = o.concurrency || 3;
    var result = new Array(list.length);
    var next = 0;
    function lane() {
      if (next >= list.length) return Promise.resolve();
      var i = next++;
      return Promise.resolve(iso(Object.assign({}, body, { startTime: list[i] }))).then(function (fc) {
        result[i] = { time: list[i], fc: fc };
        if (o.onFrame) o.onFrame(result[i], i, list.length);
        return lane();
      });
    }
    var jobs = [];
    for (var k = 0; k < Math.min(lanes, list.length); k++) jobs.push(lane());
    return Promise.all(jobs).then(function () { return result; });
  }

  function play(list, draw, opts) {
    var fps = (opts && opts.fps) || 2;
    var loop = !opts || opts.loop !== false;
    var i = 0;
    var timer = setInterval(function () {
      if (i >= list.length) {
        if (!loop) { clearInterval(timer); return; }
        i = 0;
      }
      draw(list[i], i);
      i++;
    }, 1000 / fps);
    return { stop: function () { clearInterval(timer); } };
  }

  function series(list, stops) {
    var C = typeof module !== 'undefined' && module.exports ? require('./compare.js') : window.VijayCompare;
    return list.map(function (f) {
      var n = 0;
      stops.forEach(function (s) { if (C.stopMinutes(f.fc, s) !== null) n++; });
      return { time: f.time, stations: n };
    });
  }

  var api = { times: times, frames: frames, play: play, series: series };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.VijayTimelapse = api;
})();
