import { createSettingsPanel, toEngineRequest, BANDS } from "./settings.js";
import { errorMessage, fetchJson } from "../tomfor/errors.js";
import { searchAddress, locate } from "../tomfor/search.js";

const STOCKHOLM = [59.3293, 18.0686];
const ENGINE_URL = "/t/marlin/isochrone";
const TIMEOUT_MS = 20000;

const TEXT = {
  en: {
    search: "Search address or place",
    go: "Search",
    locate: "Use my location",
    notFound: "No place found.",
    noRoutes: "No public transport reachable with these options. Try more walking, waiting or travel time.",
    stats: (n, ms) => `${n} stops reached, ${ms} ms`,
    fixture: "Note: the engine is running on test data.",
  },
  sv: {
    search: "Sök adress eller plats",
    go: "Sök",
    locate: "Använd min position",
    notFound: "Ingen plats hittades.",
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

// A pane with one opacity keeps band colours exact even though cumulative bands are stacked.
map.createPane("iso").style.opacity = "0.6";
map.getPane("iso").style.zIndex = 450;
const overlay = L.layerGroup().addTo(map);
let marker = null;

const statusEl = document.getElementById("status");
const searchInput = document.getElementById("q");
const searchBtn = document.getElementById("go");
const searchMsg = document.getElementById("searchmsg");
const locateBtn = document.getElementById("loc");

function applyLang() {
  document.documentElement.lang = lang;
  searchInput.placeholder = tr("search");
  searchBtn.textContent = tr("go");
  locateBtn.setAttribute("aria-label", tr("locate"));
  locateBtn.title = tr("locate");
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
  try {
    const fc = await fetchJson(
      ENGINE_URL,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toEngineRequest(settings)) },
      TIMEOUT_MS
    );
    drawBands(fc);
  } catch (err) {
    panel.setError(engineError(err));
  } finally {
    panel.setBusy(false);
  }
}

function engineError(err) {
  if (err && err.status && (err.message || err.message_sv) && err.status !== 422) {
    return lang === "sv" ? err.message_sv || err.message : err.message;
  }
  return errorMessage(lang, err).message;
}

function drawBands(fc) {
  overlay.clearLayers();
  let drawn = 0;
  let bounds = null;
  for (const f of fc.features || []) {
    const geom = f.geometry;
    if (!geom || !geom.coordinates || !geom.coordinates.length) continue;
    const idx = Math.max(0, (f.properties.bandIndex || 1) - 1);
    const color = (BANDS[idx] || BANDS[BANDS.length - 1]).color;
    // Bands arrive outermost first and are cumulative: later layers cover earlier ones.
    const layer = L.geoJSON(f, { pane: "iso", style: { color, weight: 0, fillColor: color, fillOpacity: 1 }, interactive: false }).addTo(overlay);
    if (!bounds) bounds = layer.getBounds();
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
  if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
}

async function doSearch() {
  const q = searchInput.value.trim();
  searchMsg.textContent = "";
  if (!q) return;
  try {
    const hits = await searchAddress(q, { lang, limit: 1 });
    if (!hits.length) {
      searchMsg.textContent = tr("notFound");
      return;
    }
    setOrigin(hits[0].lat, hits[0].lon, true);
  } catch (e) {
    searchMsg.textContent = errorMessage(lang, e).message;
  }
}

locateBtn.addEventListener("click", async () => {
  searchMsg.textContent = "";
  try {
    const p = await locate();
    setOrigin(p.lat, p.lon, true);
  } catch (e) {
    searchMsg.textContent = errorMessage(lang, e).message;
  }
});

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    doSearch();
  }
});
