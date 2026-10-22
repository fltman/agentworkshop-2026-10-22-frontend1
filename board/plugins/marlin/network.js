'use strict';

/**
 * Network loading for the marlin isochrone engine.
 *
 * Reads the preprocessed GTFS artifacts produced by vijay-team from
 * <dataDir>/network/ and turns them into the flat, index-based structures the
 * algorithm wants. Falls back to a small synthetic fixture so the engine is
 * testable and demonstrable before the real data lands.
 *
 * See projects/marlin/CONTRACT.md for the file formats.
 */

const fs = require('fs');
const path = require('path');

const MODES = ['bus', 'metro', 'tram', 'train', 'commuter_rail', 'boat'];

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[marlin] could not read', path.basename(file), err && err.message);
    return null;
  }
}

function readJsonLinesIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      out.push(JSON.parse(t));
    }
    return out;
  } catch (err) {
    console.error('[marlin] could not read', path.basename(file), err && err.message);
    return null;
  }
}

/** connections.jsonl is preferred: it is the big file and streams better. */
function readCollection(dir, name) {
  return readJsonLinesIfExists(path.join(dir, name + '.jsonl')) ||
         readJsonIfExists(path.join(dir, name + '.json'));
}

/**
 * Builds the in-memory network. Everything downstream works on integer stop
 * indices, never on stop id strings: that is what keeps the inner loop fast.
 */
function build(raw, source) {
  const stops = [];
  const indexById = new Map();

  for (const s of raw.stops) {
    const id = String(s.id);
    if (indexById.has(id)) continue;
    indexById.set(id, stops.length);
    stops.push({
      id,
      name: s.name || id,
      lat: Number(s.lat),
      lon: Number(s.lon),
      modes: Array.isArray(s.modes) ? s.modes : [],
    });
  }

  const connections = [];
  const tripIds = new Map();
  const modesPresent = new Set();

  for (const c of raw.connections) {
    const from = indexById.get(String(c.from));
    const to = indexById.get(String(c.to));
    if (from === undefined || to === undefined) continue;

    const dep = Number(c.dep);
    const arr = Number(c.arr);
    if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr < dep) continue;

    const tripKey = String(c.trip != null ? c.trip : c.route + ':' + dep);
    let trip = tripIds.get(tripKey);
    if (trip === undefined) {
      trip = tripIds.size;
      tripIds.set(tripKey, trip);
    }

    const mode = String(c.mode || 'bus');
    modesPresent.add(mode);

    connections.push({
      from, to, dep, arr, trip, mode,
      route: c.route != null ? String(c.route) : '',
      service: c.service != null ? String(c.service) : '',
    });
  }

  // A single pass in departure order is the whole point of the scan, so this
  // sort is done once at startup and never again.
  connections.sort((a, b) => a.dep - b.dep || a.arr - b.arr);

  const depTimes = new Int32Array(connections.length);
  for (let i = 0; i < connections.length; i++) depTimes[i] = connections[i].dep;

  const transfers = [];
  for (let i = 0; i < stops.length; i++) transfers.push([]);
  for (const t of raw.transfers || []) {
    const from = indexById.get(String(t.from));
    const to = indexById.get(String(t.to));
    const seconds = Number(t.seconds);
    if (from === undefined || to === undefined || from === to) continue;
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    transfers[from].push({ to, seconds });
  }

  return {
    source,
    dataVersion: (raw.meta && raw.meta.dataVersion) || 'unknown',
    timezone: (raw.meta && raw.meta.timezone) || 'Europe/Stockholm',
    stops,
    indexById,
    connections,
    depTimes,
    transfers,
    tripCount: tripIds.size,
    modes: MODES.filter((m) => modesPresent.has(m)),
    calendar: raw.calendar || {},
  };
}

function load(dataDir) {
  const dir = path.join(dataDir || '.', 'network');
  const stops = readCollection(dir, 'stops');
  const connections = readCollection(dir, 'connections');

  if (Array.isArray(stops) && stops.length && Array.isArray(connections)) {
    const raw = {
      meta: readJsonIfExists(path.join(dir, 'meta.json')) || {},
      stops,
      connections,
      transfers: readCollection(dir, 'transfers') || [],
      calendar: readJsonIfExists(path.join(dir, 'calendar.json')) || {},
    };
    const net = build(raw, 'gtfs');
    console.log('[marlin] network loaded:', net.stops.length, 'stops,',
      net.connections.length, 'connections,', net.dataVersion);
    return net;
  }

  const fixture = require('./fixture');
  const net = build(fixture.raw(), 'fixture');
  console.log('[marlin] no preprocessed network in', dir, '- running on fixture');
  return net;
}

module.exports = { load, build, MODES };
