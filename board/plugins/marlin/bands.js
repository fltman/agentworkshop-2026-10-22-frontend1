'use strict';

/**
 * Turns earliest-arrival times per stop into GeoJSON colour bands.
 *
 * A point that is `d` metres from a stop reached at travel time `t` is itself
 * reachable in `t + d / walkSpeed`. So the area reachable within a band edge B
 * is the union of discs: one around every stop with `t <= B`, of radius
 * `(B - t) * walkSpeed`, capped by the user's egress walking limit.
 *
 * The bands are therefore cumulative and are emitted outermost first: a client
 * paints them in array order and the nearer bands cover the farther ones. That
 * is far cheaper and far more robust than computing true polygon unions, and it
 * looks identical on a map.
 */

const { haversine, INF } = require('./isochrone');

const CIRCLE_SEGMENTS = 24;
const GRID_METRES = 400;

// Blue (near) to red (far), interpolated so any band count works.
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

function circlePolygon(lat, lon, radiusMetres) {
  const latRad = lat * Math.PI / 180;
  const dLat = (radiusMetres / 111320);
  const dLon = (radiusMetres / (111320 * Math.max(0.01, Math.cos(latRad))));
  const ring = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    ring.push([
      round6(lon + dLon * Math.cos(a)),
      round6(lat + dLat * Math.sin(a)),
    ]);
  }
  return [ring];
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Keeps only discs that add area: a disc fully inside an already kept disc is
 * dropped. Candidates are compared against the neighbouring grid cells only, so
 * this stays near linear instead of quadratic.
 */
function dropCovered(discs) {
  discs.sort((a, b) => b.r - a.r);
  const grid = new Map();
  const kept = [];

  const cellOf = (lat, lon) =>
    Math.round(lat * 111320 / GRID_METRES) + ':' +
    Math.round(lon * 111320 * Math.cos(lat * Math.PI / 180) / GRID_METRES);

  for (const d of discs) {
    let covered = false;
    const baseLat = Math.round(d.lat * 111320 / GRID_METRES);
    const baseLon = Math.round(d.lon * 111320 * Math.cos(d.lat * Math.PI / 180) / GRID_METRES);

    outer:
    for (let dy = -2; dy <= 2 && !covered; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = grid.get((baseLat + dy) + ':' + (baseLon + dx));
        if (!bucket) continue;
        for (const o of bucket) {
          if (haversine(d.lat, d.lon, o.lat, o.lon) + d.r <= o.r) {
            covered = true;
            break outer;
          }
        }
      }
    }
    if (covered) continue;

    kept.push(d);
    const key = cellOf(d.lat, d.lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(d);
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

  const features = [];

  for (let b = bandCount; b >= 1; b--) {
    const edge = b * bandSeconds;
    const discs = [];

    // Walking straight from the pin, without using transit at all.
    const originRadius = Math.min(accessSeconds, edge) * walkSpeedMs;
    if (originRadius > 0) discs.push({ lat: origin.lat, lon: origin.lon, r: originRadius });

    let stopsInBand = 0;
    for (let i = 0; i < arrival.length; i++) {
      const a = arrival[i];
      if (a === INF) continue;
      const travel = a - startSec;
      if (travel > edge) continue;
      stopsInBand++;
      const r = Math.min(egressSeconds, edge - travel) * walkSpeedMs;
      if (r <= 1) continue;
      const s = net.stops[i];
      discs.push({ lat: s.lat, lon: s.lon, r });
    }

    const kept = dropCovered(discs);

    features.push({
      type: 'Feature',
      properties: {
        fromMinutes: Math.round((b - 1) * bandSeconds / 60),
        toMinutes: Math.round(edge / 60),
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

module.exports = { build, colorFor, circlePolygon };
