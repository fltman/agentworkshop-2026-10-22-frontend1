'use strict';

/**
 * Synthetic Stockholm network, in exactly the shape vijay-team's real artifact
 * has (stops, trips with stop indices and times, directed walking transfers).
 *
 * Not real timetable data: a stand-in with realistic geography and headways so
 * the engine and its tests work even where the 2 MB GTFS artifacts are not
 * available. Because it uses the real format, the loader has only one code
 * path and the fixture cannot drift away from production.
 */

const LINES = [
  {
    route: '17', mode: 'metro', headway: 5, hopSeconds: 110,
    stops: [
      ['T-Centralen', 59.3313, 18.0622],
      ['Gamla stan', 59.3232, 18.0679],
      ['Slussen', 59.3196, 18.0719],
      ['Medborgarplatsen', 59.3145, 18.0724],
      ['Skanstull', 59.3074, 18.0757],
      ['Gullmarsplan', 59.2985, 18.0810],
      ['Skarpnäck', 59.2662, 18.1310],
    ],
  },
  {
    route: '14', mode: 'metro', headway: 5, hopSeconds: 105,
    stops: [
      ['Fruängen', 59.2862, 17.9640],
      ['Telefonplan', 59.2983, 17.9967],
      ['Liljeholmen', 59.3104, 18.0223],
      ['Hornstull', 59.3153, 18.0346],
      ['Mariatorget', 59.3177, 18.0634],
      ['Slussen', 59.3196, 18.0719],
      ['Gamla stan', 59.3232, 18.0679],
      ['T-Centralen', 59.3313, 18.0622],
      ['Östermalmstorg', 59.3350, 18.0742],
      ['Tekniska högskolan', 59.3464, 18.0710],
      ['Universitetet', 59.3652, 18.0556],
      ['Mörby centrum', 59.3978, 18.0410],
    ],
  },
  {
    route: '11', mode: 'metro', headway: 6, hopSeconds: 115,
    stops: [
      ['Kungsträdgården', 59.3307, 18.0725],
      ['T-Centralen', 59.3313, 18.0622],
      ['Rådhuset', 59.3302, 18.0400],
      ['Fridhemsplan', 59.3337, 18.0231],
      ['Stadshagen', 59.3375, 18.0137],
      ['Västra skogen', 59.3474, 18.0017],
      ['Solna centrum', 59.3600, 18.0010],
      ['Akalla', 59.4147, 17.9140],
    ],
  },
  {
    route: '41', mode: 'commuter_rail', headway: 15, hopSeconds: 240,
    stops: [
      ['Stockholm City', 59.3306, 18.0590],
      ['Stockholm Odenplan', 59.3430, 18.0495],
      ['Solna station', 59.3598, 18.0085],
      ['Sundbyberg', 59.3610, 17.9710],
      ['Barkarby', 59.4060, 17.8690],
      ['Jakobsberg', 59.4230, 17.8340],
    ],
  },
  {
    route: '7', mode: 'tram', headway: 10, hopSeconds: 100,
    stops: [
      ['Sergels torg', 59.3326, 18.0649],
      ['Kungsträdgården', 59.3307, 18.0725],
      ['Nybroplan', 59.3315, 18.0783],
      ['Djurgårdsbron', 59.3315, 18.0930],
      ['Skansen', 59.3252, 18.1035],
      ['Waldemarsudde', 59.3220, 18.1140],
    ],
  },
  {
    route: '4', mode: 'bus', headway: 7, hopSeconds: 170,
    stops: [
      ['Radiohuset', 59.3360, 18.0930],
      ['Östermalmstorg', 59.3350, 18.0742],
      ['Odenplan', 59.3430, 18.0495],
      ['Fridhemsplan', 59.3337, 18.0231],
      ['Hornstull', 59.3153, 18.0346],
      ['Södersjukhuset', 59.3110, 18.0470],
      ['Gullmarsplan', 59.2985, 18.0810],
    ],
  },
  {
    route: '80', mode: 'boat', headway: 30, hopSeconds: 420,
    stops: [
      ['Nybroplan', 59.3315, 18.0783],
      ['Allmänna gränd', 59.3243, 18.0944],
      ['Slussen', 59.3196, 18.0719],
      ['Nacka strand', 59.3135, 18.1660],
    ],
  },
  {
    route: '27', mode: 'train', headway: 20, hopSeconds: 210,
    stops: [
      ['Stockholm Östra', 59.3470, 18.0710],
      ['Universitetet Öst', 59.3660, 18.0590],
      ['Djursholms Ösby', 59.3960, 18.0680],
      ['Täby centrum', 59.4440, 18.0700],
    ],
  },
];

const SERVICE_START = 5 * 3600;
const SERVICE_END = 24 * 3600;
const DWELL_SECONDS = 30;
const WALK_SPEED_MS = 4.8 * 1000 / 3600;
const TRANSFER_RADIUS_M = 600;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function raw() {
  const stops = [];
  const indexByName = new Map();

  function indexFor(name, lat, lon) {
    let i = indexByName.get(name);
    if (i === undefined) {
      i = stops.length;
      indexByName.set(name, i);
      stops.push({ id: 'S' + (i + 1), name, lat, lon, modes: [] });
    }
    return i;
  }

  const trips = [];

  for (const line of LINES) {
    const seq = line.stops.map(([name, lat, lon]) => indexFor(name, lat, lon));
    for (const i of seq) {
      if (!stops[i].modes.includes(line.mode)) stops[i].modes.push(line.mode);
    }

    for (const direction of [1, -1]) {
      const ordered = direction === 1 ? seq : seq.slice().reverse();
      for (let t0 = SERVICE_START; t0 < SERVICE_END; t0 += line.headway * 60) {
        const times = [];
        let t = t0;
        for (let i = 0; i < ordered.length; i++) {
          times.push(t);
          t += line.hopSeconds + DWELL_SECONDS;
        }
        trips.push({ route: line.route, mode: line.mode, stops: ordered.slice(), times });
      }
    }
  }

  const transfers = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = 0; j < stops.length; j++) {
      if (i === j) continue;
      const d = haversine(stops[i].lat, stops[i].lon, stops[j].lat, stops[j].lon);
      if (d > TRANSFER_RADIUS_M) continue;
      transfers.push({ from: i, to: j, walkSec: Math.round(d / WALK_SPEED_MS) });
    }
  }

  return {
    version: 1,
    dayType: 'weekday',
    date: 'fixture',
    stops,
    trips,
    transfers,
  };
}

module.exports = { raw, haversine };
