/**
 * ops/map.js — Leaflet map shared by the Overview and Live Map pages
 * Layers: cameras (circles; pulse on fire), citizen reports (diamonds),
 * incident history (small dots). Basemaps: dark, satellite.
 */

import { esc } from "/js/common.js";
import { REPORT_STATUS, fmtDateTime, timeAgo, pct } from "/js/ops/data.js";

const BASEMAPS = {
  dark: () => [L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { attribution: "© OpenStreetMap © CARTO", subdomains: "abcd", maxZoom: 19 })],
  satellite: () => [
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles © Esri", maxZoom: 19 }),
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 }),
  ],
};

function icon(cls, size = 18) {
  return L.divIcon({ className: "", html: `<div class="mk ${cls}"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
}

/**
 * handlers: { onResolveCamera(camera), onWhatsappCamera(camera), onWhatsappReport(report) }
 */
export function createOpsMap(el, { center = [33.5, 73.9], zoom = 12, basemap = "dark", handlers = {}, canAct = true } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: false }).setView(center, zoom);
  let baseLayers = [];
  function setBase(name) {
    baseLayers.forEach((l) => map.removeLayer(l));
    baseLayers = (BASEMAPS[name] || BASEMAPS.dark)();
    baseLayers.forEach((l) => l.addTo(map));
  }
  setBase(basemap);

  const layers = {
    history: L.layerGroup().addTo(map),
    reports: L.layerGroup().addTo(map),
    cameras: L.layerGroup().addTo(map),
  };
  const camMarkers = new Map();
  const repMarkers = new Map();
  let fitted = false;
  let camerasById = new Map(), reportsById = new Map();

  function cameraPopup(c) {
    const state = c.active ? '<span class="pill critical"><i class="fa-solid fa-fire"></i> Fire detected</span>'
      : c.online ? '<span class="pill good"><i class="fa-solid fa-circle-check"></i> Online · safe</span>'
      : '<span class="pill offline"><i class="fa-solid fa-plug-circle-xmark"></i> Offline</span>';
    return `<b>${esc(c.name)}</b><br />${state}
      <div class="muted" style="margin-top:6px;">Last reading ${esc(timeAgo(c.lastTime))} · ${esc(c.lastCls || "—")} · ${pct(c.lastProb)}</div>
      <div class="muted mono">${c.lat?.toFixed(5)}, ${c.lon?.toFixed(5)}</div>
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;">
        <button class="btn btn-sm" data-act="wa-cam" data-id="${esc(c.name)}"><i class="fa-brands fa-whatsapp"></i> Send</button>
        ${c.active && canAct ? `<button class="btn btn-sm btn-critical" data-act="resolve-cam" data-id="${esc(c.name)}"><i class="fa-solid fa-check"></i> Mark resolved</button>` : ""}
        <a class="btn btn-sm" href="/cameras#${encodeURIComponent(c.name)}"><i class="fa-solid fa-video"></i> Camera</a>
      </div>`;
  }

  function reportPopup(r) {
    const st = REPORT_STATUS[r.status];
    return `<b><i class="fa-solid ${r.typeInfo.icon}"></i> ${esc(r.typeInfo.label)}</b><br />
      <span class="pill ${st.pill}"><i class="fa-solid ${st.icon}"></i> ${esc(st.label)}</span>
      <div style="margin-top:6px;">${esc(r.place)}</div>
      <div class="muted">${esc(fmtDateTime(r.time))} · ${esc(timeAgo(r.time))}</div>
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;">
        <a class="btn btn-sm" href="/incidents#${esc(r.id)}"><i class="fa-solid fa-people-group"></i> Open report</a>
        <button class="btn btn-sm" data-act="wa-rep" data-id="${esc(r.id)}"><i class="fa-brands fa-whatsapp"></i> Send</button>
      </div>`;
  }

  // Popup buttons (event delegation)
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === "resolve-cam") handlers.onResolveCamera?.(camerasById.get(id));
    if (b.dataset.act === "wa-cam") handlers.onWhatsappCamera?.(camerasById.get(id));
    if (b.dataset.act === "wa-rep") handlers.onWhatsappReport?.(reportsById.get(id));
  });

  function fitAll() {
    const pts = [...camMarkers.values(), ...repMarkers.values()].map((m) => m.getLatLng());
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 });
  }

  return {
    map,
    layers,
    setBase,
    fitAll,
    setCameras(cams) {
      camerasById = new Map(cams.map((c) => [c.name, c]));
      for (const [name, m] of camMarkers) if (!camerasById.has(name)) { layers.cameras.removeLayer(m); camMarkers.delete(name); }
      for (const c of cams) {
        if (c.lat == null) continue;
        const cls = `camera ${c.active ? "fire" : c.online ? "" : "offline"}`;
        let m = camMarkers.get(c.name);
        if (!m) {
          m = L.marker([c.lat, c.lon], { icon: icon(cls), title: c.name, zIndexOffset: 500 }).addTo(layers.cameras);
          m.bindPopup(() => cameraPopup(camerasById.get(c.name)));
          camMarkers.set(c.name, m);
        } else {
          m.setLatLng([c.lat, c.lon]);
          m.setIcon(icon(cls));
        }
        m.setZIndexOffset(c.active ? 1000 : 500);
      }
      if (!fitted && camMarkers.size) { fitted = true; fitAll(); }
    },
    setReports(reports) {
      reportsById = new Map(reports.map((r) => [r.id, r]));
      for (const [id, m] of repMarkers) if (!reportsById.has(id)) { layers.reports.removeLayer(m); repMarkers.delete(id); }
      for (const r of reports) {
        if (r.lat == null) continue;
        const cls = `report ${!r.open ? "closed" : r.sev === "critical" ? "critical pulse" : ""}`;
        let m = repMarkers.get(r.id);
        if (!m) {
          m = L.marker([r.lat, r.lon], { icon: icon(cls, 16), title: r.place, zIndexOffset: 800 }).addTo(layers.reports);
          m.bindPopup(() => reportPopup(reportsById.get(r.id)));
          repMarkers.set(r.id, m);
        } else {
          m.setIcon(icon(cls, 16));
        }
      }
      if (!fitted && repMarkers.size) { fitted = true; fitAll(); }
    },
    setHistory(incidents, reports = []) {
      layers.history.clearLayers();
      const add = (lat, lon, title) => {
        if (lat == null) return;
        L.marker([lat, lon], { icon: icon("history", 9), title, interactive: true, keyboard: false }).addTo(layers.history);
      };
      incidents.forEach((i) => add(i.lat, i.lon, `${i.camera} — ${fmtDateTime(i.start)}`));
      reports.forEach((r) => add(r.lat, r.lon, `${r.place} — ${fmtDateTime(r.time)}`));
    },
    focusCamera(name) {
      const m = camMarkers.get(name);
      if (m) { map.flyTo(m.getLatLng(), 16, { duration: 0.8 }); m.openPopup(); }
      return !!m;
    },
    focusReport(id) {
      const m = repMarkers.get(id);
      if (m) { map.flyTo(m.getLatLng(), 16, { duration: 0.8 }); m.openPopup(); }
      return !!m;
    },
    counts() { return { cameras: camMarkers.size, reports: repMarkers.size }; },
  };
}
