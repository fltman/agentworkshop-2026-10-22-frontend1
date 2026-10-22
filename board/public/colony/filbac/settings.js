// Settings panel for the isochrone map. No dependencies. See projects/filbac/INTERFACES.md.

export const MODES = ["bus", "metro", "tram", "train", "commuter_rail", "boat"];

export const DEFAULT_SETTINGS = {
  origin: null,
  startTime: null,
  day: "weekday",
  maxTravelMin: 30,
  maxWaitMin: 7,
  maxTransfers: 3,
  walk: { toDestinationMin: 10, betweenStationsMin: 5 },
  modes: [...MODES],
  bandMin: 5,
};

const BAND_COLORS = [
  "#1a9850", "#66bd63", "#a6d96a", "#d9ef8b", "#fee08b", "#fdae61",
  "#f46d43", "#d73027", "#b2182b", "#a50f68", "#7b1a8a", "#5e3c99",
];

// One band per 5 minutes up to 120 minutes; the palette repeats after 60 minutes.
export const BANDS = Array.from({ length: 24 }, (_, i) => ({
  fromMin: i * 5,
  toMin: (i + 1) * 5,
  color: BAND_COLORS[i % BAND_COLORS.length],
}));

const I18N = {
  en: {
    title: "Settings",
    origin: "Origin",
    noOrigin: "Tap the map to place the pin",
    startTime: "Start time",
    now: "Now",
    maxTravel: "Maximum travel time",
    maxWait: "Maximum waiting time",
    maxTransfers: "Maximum transfers",
    walkTo: "Walk from last stop to destination",
    walkBetween: "Walk between stations",
    modes: "Transport types",
    min: "min",
    update: "Update",
    updating: "Calculating…",
    legend: "Travel time",
    errNoOrigin: "Place a pin on the map first.",
    errNoModes: "Select at least one transport type.",
    errTooStrict: "These options are very restrictive. Increase travel time, waiting time or walking.",
    mode_bus: "Bus",
    mode_metro: "Metro",
    mode_tram: "Tram",
    mode_train: "Train",
    mode_commuter_rail: "Commuter rail",
    mode_boat: "Boat",
    language: "Language",
  },
  sv: {
    title: "Inställningar",
    origin: "Startpunkt",
    noOrigin: "Tryck på kartan för att placera nålen",
    startTime: "Starttid",
    now: "Nu",
    maxTravel: "Maximal restid",
    maxWait: "Maximal väntetid",
    maxTransfers: "Maximalt antal byten",
    walkTo: "Gång från sista hållplats till mål",
    walkBetween: "Gång mellan stationer",
    modes: "Färdmedel",
    min: "min",
    update: "Uppdatera",
    updating: "Beräknar…",
    legend: "Restid",
    errNoOrigin: "Placera först en nål på kartan.",
    errNoModes: "Välj minst ett färdmedel.",
    errTooStrict: "Valen är mycket begränsande. Öka restid, väntetid eller gångtid.",
    mode_bus: "Buss",
    mode_metro: "Tunnelbana",
    mode_tram: "Spårvagn",
    mode_train: "Tåg",
    mode_commuter_rail: "Pendeltåg",
    mode_boat: "Båt",
    language: "Språk",
  },
};

export function dayFromDate(d) {
  const w = d.getDay();
  return w === 0 ? "sunday" : w === 6 ? "saturday" : "weekday";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoWithOffset(local) {
  const d = new Date(local);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${local}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) e.append(c);
  return e;
}

export function createSettingsPanel(container, opts = {}) {
  let lang = opts.lang === "sv" ? "sv" : "en";
  const state = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  let busy = false;
  let useNow = true;
  let message = null;
  const t = (k) => I18N[lang][k];

  const root = el("form", { class: "iso-settings", novalidate: "" });
  container.replaceChildren(root);
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  function slider(label, min, max, step, get, set) {
    const out = el("output", { text: `${get()} ${t("min")}` });
    const input = el("input", { type: "range", min, max, step, value: get(), "aria-label": label });
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = `${get()} ${t("min")}`;
    });
    return el("label", { class: "iso-row" }, [
      el("span", { class: "iso-label" }, [label, out]),
      input,
    ]);
  }

  function render() {
    const rows = [];

    const langSel = el("select", { "aria-label": t("language") }, [
      el("option", { value: "en", text: "English" }),
      el("option", { value: "sv", text: "Svenska" }),
    ]);
    langSel.value = lang;
    langSel.addEventListener("change", () => {
      lang = langSel.value;
      message = null;
      render();
      if (opts.onLangChange) opts.onLangChange(lang);
    });
    rows.push(el("div", { class: "iso-head" }, [el("h2", { text: t("title") }), langSel]));

    const o = state.origin;
    rows.push(
      el("div", { class: "iso-origin" }, [
        el("strong", { text: t("origin") + ": " }),
        el("span", { text: o ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` : t("noOrigin") }),
      ])
    );

    const timeInput = el("input", { type: "datetime-local", "aria-label": t("startTime") });
    timeInput.value = state.startTime ? state.startTime.slice(0, 16) : toLocalInput(new Date());
    timeInput.addEventListener("input", () => {
      useNow = false;
      state.startTime = timeInput.value ? toIsoWithOffset(timeInput.value) : null;
      if (timeInput.value) state.day = dayFromDate(new Date(timeInput.value));
    });
    const nowBtn = el("button", { type: "button", class: "iso-secondary", text: t("now") });
    nowBtn.addEventListener("click", () => {
      useNow = true;
      state.startTime = null;
      timeInput.value = toLocalInput(new Date());
    });
    rows.push(
      el("div", { class: "iso-row" }, [
        el("span", { class: "iso-label", text: t("startTime") }),
        el("div", { class: "iso-inline" }, [timeInput, nowBtn]),
      ])
    );

    rows.push(slider(t("maxTravel"), 5, 120, 5, () => state.maxTravelMin, (v) => { state.maxTravelMin = v; renderLegend(); }));
    rows.push(slider(t("maxWait"), 0, 30, 1, () => state.maxWaitMin, (v) => (state.maxWaitMin = v)));
    rows.push(slider(t("walkTo"), 0, 30, 1, () => state.walk.toDestinationMin, (v) => (state.walk.toDestinationMin = v)));
    rows.push(slider(t("walkBetween"), 0, 20, 1, () => state.walk.betweenStationsMin, (v) => (state.walk.betweenStationsMin = v)));

    const trOut = el("output", { text: String(state.maxTransfers) });
    const trIn = el("input", { type: "range", min: 0, max: 6, step: 1, value: state.maxTransfers, "aria-label": t("maxTransfers") });
    trIn.addEventListener("input", () => {
      state.maxTransfers = Number(trIn.value);
      trOut.textContent = trIn.value;
    });
    rows.push(el("label", { class: "iso-row" }, [el("span", { class: "iso-label" }, [t("maxTransfers"), trOut]), trIn]));

    const modeBox = el("fieldset", { class: "iso-modes" }, [el("legend", { text: t("modes") })]);
    for (const m of MODES) {
      const cb = el("input", { type: "checkbox", value: m });
      cb.checked = state.modes.includes(m);
      cb.addEventListener("change", () => {
        state.modes = MODES.filter((x) => (x === m ? cb.checked : state.modes.includes(x)));
      });
      modeBox.append(el("label", { class: "iso-chip" }, [cb, el("span", { text: t("mode_" + m) })]));
    }
    rows.push(modeBox);

    const msg = el("div", { class: "iso-msg", role: "alert", "aria-live": "polite", text: message ? I18N[lang][message] || message : "" });
    const btn = el("button", { type: "submit", class: "iso-update", text: busy ? t("updating") : t("update") });
    btn.disabled = busy;
    rows.push(msg, btn);

    rows.push(el("div", { class: "iso-legend" }));
    root.replaceChildren(...rows);
    renderLegend();
  }

  function renderLegend() {
    const legend = root.querySelector(".iso-legend");
    if (!legend) return;
    legend.replaceChildren(el("strong", { text: t("legend") }));
    for (const b of BANDS.filter((x) => x.toMin <= state.maxTravelMin)) {
      legend.append(
        el("span", { class: "iso-swatch" }, [el("i", { style: `background:${b.color}` }), `${b.fromMin}–${b.toMin}`])
      );
    }
  }

  function showMessage(m) {
    message = m;
    const node = root.querySelector(".iso-msg");
    if (node) node.textContent = m ? I18N[lang][m] || m : "";
  }

  function submit() {
    if (busy) return;
    if (!state.origin) return showMessage("errNoOrigin");
    if (!state.modes.length) return showMessage("errNoModes");
    showMessage(null);
    if (useNow || !state.startTime) {
      const now = new Date();
      state.startTime = toIsoWithOffset(toLocalInput(now));
      state.day = dayFromDate(now);
    }
    if (opts.onUpdate) opts.onUpdate(JSON.parse(JSON.stringify(state)));
  }

  render();

  return {
    getSettings: () => JSON.parse(JSON.stringify(state)),
    setOrigin(o) {
      state.origin = o ? { lat: o.lat, lon: o.lon } : null;
      if (o && message === "errNoOrigin") message = null;
      render();
    },
    setBusy(b) {
      busy = !!b;
      render();
    },
    // key: errNoOrigin | errNoModes | errTooStrict, or a literal message; null clears
    setError: showMessage,
    setLang(l) {
      lang = l === "sv" ? "sv" : "en";
      render();
    },
    t,
  };
}
