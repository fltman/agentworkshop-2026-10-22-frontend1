'use strict';

/**
 * Turns earliest-arrival times per stop into GeoJSON colour bands.
 *
 * A point `d` metres from a stop reached at travel time `t` is itself reachable
 * in `t + d / walkSpeed`. So the area reachable within a band edge B is the
 * union of discs: one around every stop with `t <= B`, of radius
 * `(B - t) * walkSpeed`, capped by the user's egress walking limit.
 *
 * The bands are cumulative and are emitted outermost first: a client paints
 * them in array order and the nearer bands cover the farther ones. That gives
 * the ring picture without computing a single polygon union.
 *
 * The hard part is not the shape, it is the size. A 120-minute query reaches
 * about 3 700 stops, and a disc per stop per band is tens of megabytes of
 * GeoJSON — unusable on a phone. Everything below `decimate` exists to cut that
 * down to something a mobile browser can actually parse, without changing what
 * the map looks like.
 */

const { haversine } = require('./isochrone');

const MIN_RADIUS_M = 90;        // smaller than this is invisible at any sane zoom
const COVERAGE_SLACK = 0.55;    // how much of a disc may stick out and still be dropped

/**
 * A wide band is looked at on a zoomed-out map, where a kilometre is a few
 * pixels, so it tolerates a much coarser outline than the innermost band the
 * user is actually studying. Spending the same polygon budget on both is what
 * made a two-hour query tens of megabytes.
 */
function budgetFor(edgeSeconds) {
  const minutes = edgeSeconds / 60;
  if (minutes <= 30) return { max: 900, slack: COVERAGE_SLACK };
  if (minutes <= 60) return { max: 550, slack: 0.7 };
  return { max: 350, slack: 0.8 };
}

const PALETTE = [
  [43, 131, 186],
  [120, 198, 186],
  [199, 233, 173],
  [255, 255, 191],
  [254, 201, 128],
  [240, 124, 74],
  [215, 25, 28],
];

function colorFor(index, count) {
  if (count <= 1) return rgb(PALETTE[0]);
  const pos = (index / (count - 1)) * (PALETTE.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(PALETTE.length - 1, lo + 1);
  const f = pos - lo;
  return rgb([
    Math.round(PALETTE[lo][0] + (PALETTE[hi][0] - PALETTE[lo][0]) * f),
    Math.round(PALETTE[lo][1] + (PALETTE[hi][1] - PALETTE[lo][1]) * f),
    Math.round(PALETTE[lo][2] + (PALETTE[hi][2] - PALETTE[lo][2]) * f),
  ]);
}

function rgb(c) {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Small discs get fewer points: nobody can see the difference. */
function segmentsFor(radiusMetres) {
  if (radiusMetres < 250) return 8;
  if (radiusMetres < 700) return 12;
  return 18;
}

function circlePolygon(lat, lon, radiusMetres) {
  const latRad = lat * Math.PI / 180;
  const dLat = radiusMetres / 111320;
  const dLon = radiusMetres / (111320 * Math.max(0.05, Math.cos(latRad)));
  const segments = segmentsFor(radiusMetres);
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    ring.push([
      round5(lon + dLon * Math.cos(a)),
      round5(lat + dLat * Math.sin(a)),
    ]);
  }
  ring.push(ring[0].slice());
  return [ring];
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * Drops discs that add (almost) no area.
 *
 * Exact containment is not enough: once the egress walking limit caps every
 * radius at the same value, no disc ever contains another, and a dense city
 * centre keeps every single one. So a disc is also dropped when it is *nearly*
 * inside a kept one — `slack` says how much of it may stick out. At slack 0
 * this is exact containment; at 0.55 a disc whose centre is comfortably inside
 * a larger disc goes, and the outline moves by less than a pixel at city zoom.
 *
 * Candidates are compared only against neighbouring grid cells, so this stays
 * near linear instead of quadratic.
 */
function decimate(discs, slack) {
  discs.sort((a, b) => b.r - a.r);

  const cell = Math.max(150, discs.length ? discs[0].r : 150);
  const kept = [];
  const grid = new Map();

  const keyOf = (lat, lon) =>
    Math.round(lat * 111320 / cell) + ':' +
    Math.round(lon * 111320 * Math.cos(lat * Math.PI / 180) / cell);

  for (const d of discs) {
    const baseY = Math.round(d.lat * 111320 / cell);
    const baseX = Math.round(d.lon * 111320 * Math.cos(d.lat * Math.PI / 180) / cell);

    let covered = false;
    outer:
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get((baseY + dy) + ':' + (baseX + dx));
        if (!bucket) continue;
        for (const o of bucket) {
          if (haversine(d.lat, d.lon, o.lat, o.lon) + d.r * (1 - slack) <= o.r) {
            covered = true;
            break outer;
          }
        }
      }
    }
    if (covered) continue;

    kept.push(d);
    const key = keyOf(d.lat, d.lon);
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = []);
    bucket.push(d);
  }

  return kept;
}

/** Decimate harder until the band fits its polygon budget. */
/**
 * A single decimate() pass guarantees every dropped disc's centre is covered
 * by a disc that survives *that same pass*: the covering neighbour is only
 * ever read out of discs already in `kept`, so it is still there when the
 * function returns. Chaining passes on the output of the previous one breaks
 * that guarantee, because "covered by" is not transitive under the slack
 * formula - A covering B and B covering C does not mean A covers C. Re-running
 * at a higher slack must start over from the full original `discs` each time,
 * or a station that was genuinely reached ends up with no polygon covering it
 * at all: a hole in the band. (Found by @vijay-team on real data: 254 stations
 * inside a band's stop list but outside its own cumulative polygon.)
 */
function fit(discs, edgeSeconds) {
  const budget = budgetFor(edgeSeconds);
  let slack = budget.slack;
  let kept = decimate(discs, slack);
  while (kept.length > budget.max && slack < 0.95) {
    slack = Math.min(0.95, slack + 0.1);
    kept = decimate(discs, slack);
  }
  return kept;
}

/**
 * @param {object} net
 * @param {Int32Array} arrival  earliest arrival per stop, INF where unreached
 * @param {object} opts  { origin, startSec, bandSeconds, bandCount,
 *                         walkSpeedMs, egressSeconds, accessSeconds }
 * @returns {Array} GeoJSON features, outermost band first
 */
function build(net, arrival, opts) {
  const {
    origin, startSec, bandSeconds, bandCount,
    walkSpeedMs, egressSeconds, accessSeconds,
  } = opts;

  const INF = 0x7fffffff;
  const stops = net.stops;

  // Travel time per reached stop, computed once instead of once per band.
  const reached = [];
  for (let i = 0; i < arrival.length; i++) {
    if (arrival[i] === INF) continue;
    reached.push({ lat: stops[i].lat, lon: stops[i].lon, t: arrival[i] - startSec });
  }
  reached.sort((a, b) => a.t - b.t);

  const features = [];

  for (let b = bandCount; b >= 1; b--) {
    const edge = b * bandSeconds;
    const discs = [];

    // Walking straight from the pin, without using transit at all.
    const originRadius = Math.min(accessSeconds, edge) * walkSpeedMs;
    if (originRadius > 0) discs.push({ lat: origin.lat, lon: origin.lon, r: originRadius });

    let stopsInBand = 0;
    for (const s of reached) {
      if (s.t > edge) break;            // sorted by t, so nothing further qualifies
      stopsInBand++;
      const r = Math.min(egressSeconds, edge - s.t) * walkSpeedMs;
      if (r < MIN_RADIUS_M) continue;
      discs.push({ lat: s.lat, lon: s.lon, r });
    }

    const kept = fit(discs, edge);
    const fromMinutes = Math.round((b - 1) * bandSeconds / 60);
    const toMinutes = Math.round(edge / 60);

    features.push({
      type: 'Feature',
      properties: {
        fromMinutes,
        toMinutes,
        // The same two numbers under the names mareri's frontend asked for.
        from_min: fromMinutes,
        to_min: toMinutes,
        bandIndex: b,
        cumulative: true,
        color: colorFor(b - 1, bandCount),
        stops: stopsInBand,
        polygons: kept.length,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: kept.map((d) => circlePolygon(d.lat, d.lon, d.r)),
      },
    });
  }

  return features;
}

module.exports = { build, colorFor, circlePolygon, decimate, fit, budgetFor };
