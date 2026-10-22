import { createSettingsPanel, toEngineRequest, BANDS } from "./settings.js";

const STOCKHOLM = [59.3293, 18.0686];
const ENGINE_URL = "/t/marlin/isochrone";
const TIMEOUT_MS = 20000;

const TEXT = {
  en: {
    search: "Search address or place",
    go: "Search",
    notFound: "No place found.",
    searchFail: "Search failed. Check your connection.",
    offline: "You appear to be offline. Check your connection and try again.",
    timeout: "The calculation took too long. Try a shorter travel time or fewer transport types.",
    server: "The service failed. Please try again in a moment.",
    noRoutes: "No public transport reachable with these options. Try more walking, waiting or travel time.",
    stats: (n, ms) => `${n} stops reached, ${ms} ms`,
    fixture: "Note: the engine is running on test data.",
  },
  sv: {
    search: "Sök adress eller plats",
    go: "Sök",
    notFound: "Ingen plats hittades.",
    searchFail: "Sökningen misslyckades. Kontrollera anslutningen.",
    offline: "Du verkar vara offline. Kontrollera anslutningen och försök igen.",
    timeout: "Beräkningen tog för lång tid. Prova kortare restid eller färre färdmedel.",
    server: "Tjänsten misslyckades. Försök igen om en stund.",
    noRoutes: "Ingen kollektivtrafik nås med dessa val. Prova mer gång, väntetid eller restid.",
    stats: (n, ms) => `${n} hållplatser nåddes, ${ms} ms`,
    fixture: "Obs: motorn kör på testdata.",
  },
};

let lang = navigator.language.startsWith("sv") ? "sv" : "en";
const tr = (k) => TEXT[lang][k];

const map = L.map("map", { zoomControl: true }).setView(STOCKHOLM, 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

const overlay = L.layerGroup().addTo(map);
let marker = null;

const statusEl = document.getElementById("status");
const searchInput = document.getElementById("q");
const searchBtn = document.getElementById("go");
const searchMsg = document.getElementById("searchmsg");

function applyLang() {
  document.documentElement.lang = lang;
  searchInput.placeholder = tr("search");
  searchBtn.textContent = tr("go");
  statusEl.textContent = "";
  searchMsg.textContent = "";
}

const panel = createSettingsPanel(document.getElementById("panel"), {
  lang,
  onLangChange(l) {
    lang = l;
    applyLang();
  },
  onUpdate: runUpdate,
});
applyLang();

function setOrigin(lat, lon, pan) {
  const o = { lat, lon };
  if (!marker) {
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      panel.setOrigin({ lat: p.lat, lon: p.lng });
    });
  } else {
    marker.setLatLng([lat, lon]);
  }
  if (pan) map.setView([lat, lon], Math.max(map.getZoom(), 13));
  panel.setOrigin(o);
}

map.on("click", (e) => setOrigin(e.latlng.lat, e.latlng.lng, false));

async function runUpdate(settings) {
  panel.setError(null);
  statusEl.textContent = "";
  statusEl.className = "";
  panel.setBusy(true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toEngineRequest(settings)),
      signal: ctrl.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON response, handled below */
    }
    if (!res.ok) {
      if (body && body.message) panel.setError(lang === "sv" ? body.message_sv || body.message : body.message);
      else panel.setError(tr("server"));
      return;
    }
    drawBands(body);
  } catch (err) {
    if (err.name === "AbortError") panel.setError(tr("timeout"));
    else if (!navigator.onLine) panel.setError(tr("offline"));
    else panel.setError(tr("server"));
  } finally {
    clearTimeout(timer);
    panel.setBusy(false);
  }
}

function drawBands(fc) {
  overlay.clearLayers();
  let drawn = 0;
  for (const f of fc.features || []) {
    const geom = f.geometry;
    if (!geom || !geom.coordinates || !geom.coordinates.length) continue;
    const idx = Math.max(0, (f.properties.bandIndex || 1) - 1);
    const color = (BANDS[idx] || BANDS[BANDS.length - 1]).color;
    // Bands arrive outermost first and are cumulative: later layers cover earlier ones.
    L.geoJSON(f, { style: { color, weight: 0, fillColor: color, fillOpacity: 0.5 }, interactive: false }).addTo(overlay);
    drawn++;
  }
  if (!drawn) {
    panel.setError(tr("noRoutes"));
    return;
  }
  const m = fc.meta || {};
  statusEl.textContent = tr("stats")(m.stopsReached ?? "?", m.computedMs ?? "?");
  if (m.source === "fixture") {
    statusEl.textContent += ". " + tr("fixture");
    statusEl.className = "warn";
  }
  if (marker) marker.bringToFront?.();
}

async function doSearch() {
  const q = searchInput.value.trim();
  searchMsg.textContent = "";
  if (!q) return;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=se" +
      "&viewbox=17.6,59.5,18.5,59.1&accept-language=" + lang + "&q=" + encodeURIComponent(q);
    const res = await fetch(url);
    if (!res.ok) throw new Error("search");
    const hits = await res.json();
    if (!hits.length) {
      searchMsg.textContent = tr("notFound");
      return;
    }
    setOrigin(Number(hits[0].lat), Number(hits[0].lon), true);
  } catch {
    searchMsg.textContent = tr("searchFail");
  }
}

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    doSearch();
  }
});
