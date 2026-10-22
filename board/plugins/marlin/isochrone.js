'use strict';

/**
 * The isochrone engine.
 *
 * Round-based connection scan: round k holds the earliest arrival at every stop
 * using at most k transit legs, so the user's "maximum number of connections"
 * is the loop bound rather than a filter applied afterwards. Within a round the
 * scan walks one globally sorted connection array once, which keeps the inner
 * loop branch-light and cache friendly.
 *
 * Timeline-alpha (RAPTOR rounds) crossed with timeline-beta (sorted connection
 * scan). See .claude/flux/evolution/7c1e/.
 */

const INF = 0x7fffffff;
const EARTH_RADIUS = 6371000;

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Index of the first connection departing at or after `time`. */
function lowerBound(depTimes, time) {
  let lo = 0;
  let hi = depTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @returns {{arrival: Int32Array, reached: number, originStops: number}}
 *   arrival[stopIndex] = earliest arrival in seconds, or INF.
 */
function search(net, opts) {
  const {
    origin, startSec, maxTravelSeconds, maxWaitSeconds, maxTransfers,
    allowedModes, walkSpeedMs, accessSeconds, egressSeconds, transferSeconds,
  } = opts;

  const stopCount = net.stops.length;
  const cutoff = startSec + maxTravelSeconds;

  const best = new Int32Array(stopCount).fill(INF);
  const prev = new Int32Array(stopCount).fill(INF);

  // Round 0: walk from the pin to every stop within the access budget.
  const accessRadius = accessSeconds * walkSpeedMs;
  let originStops = 0;
  for (let i = 0; i < stopCount; i++) {
    const s = net.stops[i];
    const d = haversine(origin.lat, origin.lon, s.lat, s.lon);
    if (d > accessRadius) continue;
    const t = startSec + Math.round(d / walkSpeedMs);
    if (t > cutoff) continue;
    best[i] = t;
    prev[i] = t;
    originStops++;
  }

  if (originStops === 0) {
    return { arrival: best, reached: 0, originStops: 0 };
  }

  const modeOk = new Set(allowedModes);
  const startIndex = lowerBound(net.depTimes, startSec);
  const connections = net.connections;
  const depTimes = net.depTimes;
  const maxLegs = maxTransfers + 1;

  for (let leg = 1; leg <= maxLegs; leg++) {
    const cur = prev.slice();
    const tripBoarded = new Int32Array(net.tripCount).fill(INF);
    let improved = false;

    for (let ci = startIndex; ci < connections.length; ci++) {
      if (depTimes[ci] > cutoff) break;
      const c = connections[ci];
      if (!modeOk.has(c.mode)) continue;

      let onBoard = tripBoarded[c.trip] !== INF;

      if (!onBoard) {
        const ready = prev[c.from];
        if (ready === INF || ready > c.dep) continue;
        // "Maximum waiting time between connections" is about transfers: the
        // first boarding after walking from the pin is not limited, otherwise a
        // rare line would make the pin look unreachable.
        if (leg > 1 && c.dep - ready > maxWaitSeconds) continue;
        tripBoarded[c.trip] = c.dep;
        onBoard = true;
      }

      if (c.arr <= cutoff && c.arr < cur[c.to]) {
        cur[c.to] = c.arr;
        improved = true;
      }
    }

    if (!improved) break;

    // Walking transfers, so the next round can board at a neighbouring stop.
    if (leg < maxLegs) {
      for (let i = 0; i < stopCount; i++) {
        const t = cur[i];
        if (t === INF) continue;
        const list = net.transfers[i];
        for (let k = 0; k < list.length; k++) {
          const tr = list[k];
          if (tr.seconds > transferSeconds) continue;
          const t2 = t + tr.seconds;
          if (t2 <= cutoff && t2 < cur[tr.to]) cur[tr.to] = t2;
        }
      }
    }

    for (let i = 0; i < stopCount; i++) {
      if (cur[i] < best[i]) best[i] = cur[i];
      prev[i] = cur[i];
    }
  }

  let reached = 0;
  for (let i = 0; i < stopCount; i++) if (best[i] !== INF) reached++;

  return { arrival: best, reached, originStops, egressSeconds };
}

module.exports = { search, haversine, lowerBound, INF };
