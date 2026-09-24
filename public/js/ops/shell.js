/**
 * ops/shell.js — top bar and control-room behaviour shared by every page
 * ─────────────────────────────────────────────────────────────
 * Page tabs · live clock · connection light · sound alerts · kiosk mode
 * (hide navigation on wall screens) · pop-out window · fullscreen ·
 * alert banner · toasts · user menu (website, admin, logout).
 * ─────────────────────────────────────────────────────────────
 */

import { signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc } from "/js/common.js";
import { COLLECTIONS } from "/js/firebase-init.js";

export const PAGES = [
  { key: "overview",  href: "/dashboard", label: "Overview",        icon: "fa-gauge-high" },
  { key: "map",       href: "/map",       label: "Live map",        icon: "fa-map-location-dot" },
  { key: "incidents", href: "/incidents", label: "Citizen reports", icon: "fa-people-group" },
  { key: "cameras",   href: "/cameras",   label: "Cameras",         icon: "fa-video" },
  { key: "analytics", href: "/analytics", label: "Analytics",       icon: "fa-chart-line" },
  { key: "logs",      href: "/logs",      label: "Event log",       icon: "fa-list" },
];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ── Sound alert (Web Audio; needs one click to unlock) ───── */
let audioCtx = null;
function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.28].forEach((offset, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = i ? 660 : 880;
    g.gain.setValueAtTime(0.0001, now + offset);
    g.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.24);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + offset);
    o.stop(now + offset + 0.26);
  });
}

/**
 * Build the top bar. Returns helpers: setLive, setBadge, alertBanner, notify, toast.
 * ctx: result of startOps(); active: page key.
 */
export function renderShell(active, ctx) {
  if (!ctx.isStaff) initAccessRequest(ctx);
  const bar = document.getElementById("topbar");
  bar.className = "topbar";
  bar.innerHTML = `
    <a class="tb-brand" href="/dashboard" aria-label="FIRO Control Room">
      <img src="/assets/logo-mark.png" alt="" width="26" height="30" />
      <b>FIRO</b><span>OPS</span>
    </a>
    <nav class="tb-nav" aria-label="Dashboard pages">
      ${PAGES.map((p) => `
        <a class="tb-tab ${p.key === active ? "active" : ""}" href="${p.href}" data-key="${p.key}"
           ${p.key === active ? 'aria-current="page"' : ""} title="Ctrl+click to open in a new tab">
          <i class="fa-solid ${p.icon}" aria-hidden="true"></i>${p.label}
          <span class="count" data-badge="${p.key}" hidden></span>
        </a>`).join("")}
    </nav>
    <div class="tb-right">
      <span class="live-dot" id="live-dot">LIVE</span>
      <div class="tb-clock"><div class="t" id="clock-t">--:--:--</div><div class="d" id="clock-d"></div></div>
      <button class="icon-btn tb-hide-kiosk" id="btn-sound" title="Sound alerts for new incidents" aria-pressed="false"><i class="fa-solid fa-volume-xmark"></i></button>
      <button class="icon-btn" id="btn-kiosk" title="Kiosk mode for wall screens (K)" aria-pressed="false"><i class="fa-solid fa-tv"></i></button>
      <button class="icon-btn tb-hide-kiosk" id="btn-popout" title="Open this page in a new window (drag it to another screen)"><i class="fa-solid fa-up-right-from-square"></i></button>
      <button class="icon-btn" id="btn-full" title="Fullscreen (F)"><i class="fa-solid fa-expand"></i></button>
      <div class="user-menu tb-hide-kiosk">
        <button class="icon-btn" id="btn-user" title="Account" aria-expanded="false"><i class="fa-solid fa-user-shield"></i></button>
        <div class="panel" id="user-panel" hidden>
          <div class="who">Signed in as<b>${esc(ctx.user.email || "")}</b>
            <span class="muted">${ctx.isAdmin ? "Admin" : ctx.isStaff ? "Control-room staff" : "Officer"}</span></div>
          <a href="/" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i> Public website</a>
          ${ctx.isAdmin ? '<a href="/admin"><i class="fa-solid fa-screwdriver-wrench"></i> Admin panel</a>' : ""}
          <button class="item danger" id="btn-logout"><i class="fa-solid fa-right-from-bracket"></i> Log out</button>
        </div>
      </div>
    </div>`;

  // Clock
  const tick = () => {
    const d = new Date();
    document.getElementById("clock-t").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    document.getElementById("clock-d").textContent = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  tick(); setInterval(tick, 1000);

  // Sound
  const soundBtn = document.getElementById("btn-sound");
  const setSound = (on) => {
    soundBtn.classList.toggle("on", on);
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.innerHTML = `<i class="fa-solid ${on ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
    store.set("firo_ops_sound", on ? "1" : "0");
  };
  let soundOn = store.get("firo_ops_sound", "0") === "1";
  setSound(soundOn);
  const unlock = () => {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    audioCtx?.resume?.();
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  soundBtn.addEventListener("click", () => { unlock(); soundOn = !soundOn; setSound(soundOn); if (soundOn) beep(); });

  // Kiosk (per page, remembered; #kiosk in the URL also starts it)
  const kioskKey = `firo_ops_kiosk_${active}`;
  const kioskBtn = document.getElementById("btn-kiosk");
  const setKiosk = (on) => {
    document.body.classList.toggle("kiosk", on);
    kioskBtn.classList.toggle("on", on);
    kioskBtn.setAttribute("aria-pressed", String(on));
    store.set(kioskKey, on ? "1" : "0");
  };
  setKiosk(location.hash === "#kiosk" || store.get(kioskKey, "0") === "1");
  kioskBtn.addEventListener("click", () => setKiosk(!document.body.classList.contains("kiosk")));

  // Pop-out and fullscreen
  document.getElementById("btn-popout").addEventListener("click", () => {
    window.open(location.pathname, "_blank", "popup,width=1600,height=900");
  });
  const toggleFull = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };
  document.getElementById("btn-full").addEventListener("click", toggleFull);
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "k" || e.key === "K") setKiosk(!document.body.classList.contains("kiosk"));
    if (e.key === "f" || e.key === "F") toggleFull();
  });

  // User menu
  const userBtn = document.getElementById("btn-user"), userPanel = document.getElementById("user-panel");
  userBtn.addEventListener("click", () => {
    userPanel.hidden = !userPanel.hidden;
    userBtn.setAttribute("aria-expanded", String(!userPanel.hidden));
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".user-menu")) userPanel.hidden = true; });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await signOut(ctx.auth);
    window.location.replace("/login");
  });

  // Toasts
  function toast(message, type = "info", ms = 5000) {
    let stack = document.querySelector(".toast-stack");
    if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; stack.setAttribute("aria-live", "polite"); document.body.appendChild(stack); }
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = message;
    stack.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  const baseTitle = document.title;

  return {
    toast,
    /** Green LIVE light or grey OFFLINE. */
    setLive(on) {
      const el = document.getElementById("live-dot");
      el.classList.toggle("off", !on);
      el.textContent = on ? "LIVE" : "OFFLINE";
      el.title = on ? "Receiving live updates" : "Showing cached data; reconnecting…";
    },
    /** Red count on a page tab (e.g. open citizen reports). */
    setBadge(key, n) {
      const el = document.querySelector(`[data-badge="${key}"]`);
      if (!el) return;
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = !n;
    },
    /** Red banner under the top bar while there are open critical incidents. */
    alertBanner(items, onView) {
      let el = document.getElementById("alert-banner");
      if (!items.length) { el?.remove(); document.title = baseTitle; return; }
      if (!el) {
        el = document.createElement("div");
        el.id = "alert-banner";
        el.className = "alert-banner";
        el.setAttribute("role", "alert");
        bar.after(el);
      }
      const first = items[0];
      el.innerHTML = `
        <span class="beacon" aria-hidden="true"></span>
        <div class="msg">${items.length} active incident${items.length > 1 ? "s" : ""}: ${esc(first.title)}
          <small>${esc(first.sub || "")}${items.length > 1 ? ` · and ${items.length - 1} more` : ""}</small></div>
        <button class="btn btn-critical btn-sm" type="button">View</button>`;
      el.querySelector("button").onclick = () => onView?.(first);
      document.title = `(${items.length}) ${baseTitle}`;
    },
    /** New incident arrived: toast + sound (if enabled). */
    notify(message) {
      toast(message, "error", 9000);
      if (soundOn) beep();
    },
  };
}

/** Locked notice for staff-only sections. */
/* ── Access requests (signed-in users who are not staff yet) ── */
let requestState = "none";   // none | sent

function requestHtml() {
  return requestState === "sent"
    ? `<p class="muted req-access" style="font-size:.85rem;"><i class="fa-solid fa-clock"></i> Access requested. An admin will review it.</p>`
    : `<p class="req-access"><button class="btn btn-sm" data-request-access><i class="fa-solid fa-key"></i> Request access</button></p>`;
}

function initAccessRequest(ctx) {
  const ref = doc(ctx.db, COLLECTIONS.requests, ctx.user.uid);
  const refresh = () => document.querySelectorAll(".req-access").forEach((el) => { el.outerHTML = requestHtml(); });
  getDoc(ref).then((snap) => { if (snap.exists()) { requestState = "sent"; refresh(); } }).catch(() => {});
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-request-access]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await setDoc(ref, { email: ctx.user.email || "", requested_ms: Date.now() });
      requestState = "sent";
      refresh();
    } catch (err) {
      console.error("[FIRO] Access request failed:", err);
      btn.disabled = false;
      btn.textContent = "Could not send. Try again";
    }
  });
}

export function lockedHtml(ctx, what = "citizen reports") {
  return `<div class="locked">
    <i class="fa-solid fa-lock" style="font-size:1.4rem;color:var(--ink-3);"></i>
    <p>Only control-room staff can see ${esc(what)}.</p>
    ${requestHtml()}
  </div>`;
}
