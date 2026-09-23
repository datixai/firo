/**
 * common.js
 * ─────────────────────────────────────────────────────────────
 * Small helpers shared by every dashboard page.
 * ─────────────────────────────────────────────────────────────
 */

export const THEME_KEY = "fmd_theme";

/** Escape text before inserting it into innerHTML. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** True when detection_class reports fire ("FIRE DETECTED", "Fire", …) but not "No Fire". */
export function isFireClass(e) {
  const c = String(e.detection_class || "").toLowerCase();
  return c.includes("fire") && !/\bno[\s_-]?fire|non[\s_-]?fire/.test(c);
}

export function isResolved(e) {
  return String(e.status || "").toLowerCase() === "resolved";
}

/** A fire alert that has not been marked resolved yet. */
export function isActiveFire(e) {
  return isFireClass(e) && !isResolved(e);
}

/**
 * Camera position of a log entry.
 * The Raspberry Pi stores latitude in coords_y and longitude in coords_x
 * (e.g. coords_y = 33.4855, coords_x = 73.9029 for Kotli, AJK).
 * Returns null when coordinates are missing or invalid.
 */
export function getLatLon(e) {
  const lat = Number(e.coords_y), lon = Number(e.coords_x);
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

export function formatTime(e) {
  return e.timestamp_str || (e.timestamp_ms ? new Date(e.timestamp_ms).toLocaleString() : "--");
}

/** Read the saved theme ("light" | "dark"). */
export function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || "light"; } catch (e) { return "light"; }
}

/** Apply a theme to <body> and remember it. */
export function applyTheme(t) {
  document.body.setAttribute("data-theme", t === "dark" ? "dark" : "");
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}

/** Keep an element updated with the current date/time. */
export function startClock(el) {
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleString(); };
  tick();
  setInterval(tick, 1000);
}

/** Register the PWA service worker (ignored where unsupported). */
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch((err) =>
      console.warn("[FIRO] Service worker registration failed:", err)
    );
  }
}
