// Stockholm address search via Nominatim (max 1 request/second, debounced) and geolocation.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
// left, top, right, bottom around Stockholm county
export const STOCKHOLM_VIEWBOX = [17.5, 59.75, 18.6, 59.15];
const MIN_INTERVAL_MS = 1100;

let lastRequestAt = 0;
let queue = Promise.resolve();

function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

// Returns [{label, lat, lon}]. Rejects with {code:'search_failed', status?} for errors.js.
export function searchAddress(query, { lang = 'en', limit = 5, signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return Promise.resolve([]);
  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: String(limit), countrycodes: 'se',
    viewbox: STOCKHOLM_VIEWBOX.join(','), bounded: '1', 'accept-language': lang,
  });
  return throttled(async () => {
    let res;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, { signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw { code: 'search_failed', cause: e };
    }
    if (!res.ok) throw { code: 'search_failed', status: res.status };
    const rows = await res.json();
    return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
  });
}

// Debounced search for type-ahead. Each call cancels the previous pending one.
// const s = createSearcher({lang: () => lang}); s.search(text).then(show).catch(...)
export function createSearcher({ lang = () => 'en', delayMs = 400 } = {}) {
  let timer = null;
  let ctrl = null;
  let pendingReject = null;
  return {
    search(text) {
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
      if (pendingReject) pendingReject({ name: 'AbortError', superseded: true });
      return new Promise((resolve, reject) => {
        pendingReject = reject;
        timer = setTimeout(() => {
          ctrl = new AbortController();
          pendingReject = null;
          searchAddress(text, { lang: typeof lang === 'function' ? lang() : lang, signal: ctrl.signal }).then(resolve, reject);
        }, delayMs);
      });
    },
    cancel() {
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
    },
  };
}

// Resolves {lat, lon, accuracy}. Rejects with a GeolocationPositionError or {code:'geo_unavailable'}.
export function locate({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject({ code: 'geo_unavailable' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
