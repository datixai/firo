/**
 * ops/data.js — data layer for the FIRO Control Room
 * ─────────────────────────────────────────────────────────────
 * • startOps()        Firebase + login guard + role check (staff/admin)
 * • watchLogs()       live camera readings (Raspberry Pi fire_logs)
 * • watchReports()    live citizen reports (Report a Fire page)
 * • fetch*Range()     one-off history queries for analytics
 * • cameraSummary()   latest state + health per camera
 * • cameraIncidents() groups consecutive fire readings into incidents
 * • actions           resolve camera incident, change report status
 * ─────────────────────────────────────────────────────────────
 */

import { initFirebase, fireLogsPath, COLLECTIONS } from "/js/firebase-init.js";
import { isFireClass, isResolved } from "/js/common.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, query, orderBy, limit, where, onSnapshot, getDocs, doc, getDoc, updateDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ── Constants ─────────────────────────────────────────────── */

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** A camera with no reading for this long is shown as offline. */
export const CAMERA_ONLINE_MS = 10 * MIN;
/** Fire readings from one camera closer together than this form one incident. */
export const INCIDENT_GAP_MS = 10 * MIN;

export const REPORT_TYPES = {
  smoke:      { label: "Smoke",           icon: "fa-smog",              sev: "warning" },
  small_fire: { label: "Small fire",      icon: "fa-fire-flame-simple", sev: "serious" },
  large_fire: { label: "Large fire",      icon: "fa-fire",              sev: "critical" },
  near_homes: { label: "Fire near homes", icon: "fa-house-fire",        sev: "critical" },
};
export const REPORT_STATUS = {
  new:       { label: "New",           icon: "fa-circle-exclamation", open: true,  pill: "critical" },
  reviewing: { label: "Reviewing",     icon: "fa-eye",                open: true,  pill: "warning" },
  verified:  { label: "Verified fire", icon: "fa-fire",               open: true,  pill: "serious" },
  resolved:  { label: "Resolved",      icon: "fa-circle-check",       open: false, pill: "good" },
  dismissed: { label: "Dismissed",     icon: "fa-ban",                open: false, pill: "offline" },
};
export const OPEN_STATUSES = ["new", "reviewing", "verified"];

const halt = () => new Promise(() => {});

/* ── Start-up: Firebase, login guard, roles ────────────────── */

/**
 * Initialise Firebase and require an email/password login.
 * Resolves with { auth, db, config, settings, user, isAdmin, isStaff }.
 * Staff (or admins) can see citizen reports; see firestore.rules.
 */
export async function startOps() {
  const fb = await initFirebase();
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(fb.auth, (u) => { unsubscribe(); resolve(u); });
  });
  if (!user || user.isAnonymous) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    await halt();
  }
  const exists = async (col) => {
    try { return (await getDoc(doc(fb.db, col, user.uid))).exists(); } catch { return false; }
  };
  const [isAdmin, isStaffDoc] = await Promise.all([exists(COLLECTIONS.admins), exists(COLLECTIONS.staff)]);
  return { ...fb, user, isAdmin, isStaff: isAdmin || isStaffDoc };
}

/* ── Normalisers ───────────────────────────────────────────── */

export function normalizeLog(id, d) {
  const lat = Number(d.coords_y), lon = Number(d.coords_x);
  const fire = isFireClass(d);
  const resolved = isResolved(d);
  return {
    id,
    camera: d.camera_location || "Unknown camera",
    lat: lat && lon ? lat : null,
    lon: lat && lon ? lon : null,
    time: Number(d.timestamp_ms) || 0,
    timeStr: d.timestamp_str || "",
    prob: Number(d.fire_probability) || 0,
    cls: d.detection_class || "",
    fire,
    resolved,
    active: fire && !resolved,
    resolvedMs: Number(d.resolved_ms) || null,
    device: d.device_id || "",
  };
}

export function normalizeReport(id, d) {
  const type = REPORT_TYPES[d.type] || { label: String(d.type || "Report"), icon: "fa-flag", sev: "warning" };
  const status = REPORT_STATUS[d.status] ? d.status : "new";
  return {
    id,
    kind: "report",
    ref: id.slice(0, 8).toUpperCase(),
    type: d.type,
    typeInfo: type,
    sev: type.sev,
    status,
    statusInfo: REPORT_STATUS[status],
    open: REPORT_STATUS[status].open,
    place: d.place || "Unknown place",
    description: d.description || "",
    lat: typeof d.lat === "number" ? d.lat : null,
    lon: typeof d.lon === "number" ? d.lon : null,
    accuracy: d.accuracy_m || null,
    photo: d.photo || "",
    name: d.name || "",
    phone: d.phone || "",
    time: Number(d.created_ms) || 0,
    ackMs: Number(d.acknowledged_ms) || null,
    resolvedMs: Number(d.resolved_ms) || null,
    handledBy: d.handled_by || "",
  };
}

/* ── Live subscriptions ────────────────────────────────────── */

/**
 * Live camera readings, newest first, capped at `max` documents.
 * onData(logs, meta) — logs sorted oldest → newest; meta.fromCache tells if offline.
 */
export function watchLogs(ctx, onData, onError, { max = 5000 } = {}) {
  const q = query(collection(ctx.db, ...fireLogsPath(ctx.config)), orderBy("timestamp_ms", "desc"), limit(max));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const logs = snap.docs.map((d) => normalizeLog(d.id, d.data())).reverse();
    onData(logs, { fromCache: snap.metadata.fromCache });
  }, onError);
}

/** Live citizen reports, newest first (staff/admin only). */
export function watchReports(ctx, onData, onError, { max = 2000 } = {}) {
  const q = query(collection(ctx.db, COLLECTIONS.reports), orderBy("created_ms", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => normalizeReport(d.id, d.data())));
  }, onError);
}

/* ── History queries (analytics) ───────────────────────────── */

export async function fetchLogsSince(ctx, since, { max = 20000 } = {}) {
  const col = collection(ctx.db, ...fireLogsPath(ctx.config));
  const q = since > 0
    ? query(col, where("timestamp_ms", ">=", since), orderBy("timestamp_ms", "desc"), limit(max))
    : query(col, orderBy("timestamp_ms", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeLog(d.id, d.data())).reverse();
}

export async function fetchReportsSince(ctx, since, { max = 5000 } = {}) {
  const col = collection(ctx.db, COLLECTIONS.reports);
  const q = since > 0
    ? query(col, where("created_ms", ">=", since), orderBy("created_ms", "desc"), limit(max))
    : query(col, orderBy("created_ms", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeReport(d.id, d.data()));
}

/* ── Derived views ─────────────────────────────────────────── */

/** Latest state and health for every camera. Input: logs sorted oldest → newest. */
export function cameraSummary(logs, now = Date.now()) {
  const cams = new Map();
  for (const l of logs) {
    let c = cams.get(l.camera);
    if (!c) {
      c = { name: l.camera, lat: null, lon: null, lastTime: 0, lastProb: 0, lastCls: "", lastFire: false,
            active: false, activeIds: [], readings: [], count24h: 0, fires24h: 0, total: 0, device: "" };
      cams.set(l.camera, c);
    }
    c.total++;
    if (l.lat != null) { c.lat = l.lat; c.lon = l.lon; }
    if (l.time >= c.lastTime) {
      c.lastTime = l.time; c.lastProb = l.prob; c.lastCls = l.cls; c.lastFire = l.fire && !l.resolved;
      if (l.device) c.device = l.device;
    }
    if (l.active) { c.active = true; c.activeIds.push(l.id); }
    if (now - l.time <= DAY) { c.count24h++; if (l.fire) c.fires24h++; }
    c.readings.push([l.time, l.prob]);
  }
  for (const c of cams.values()) {
    c.readings = c.readings.slice(-60);
    c.online = now - c.lastTime <= CAMERA_ONLINE_MS;
    c.state = c.active ? "fire" : c.online ? "online" : "offline";
  }
  return [...cams.values()].sort((a, b) =>
    (b.active - a.active) || (b.online - a.online) || a.name.localeCompare(b.name));
}

/**
 * Group fire readings into incidents: consecutive fire readings from the same
 * camera, less than INCIDENT_GAP_MS apart, are one incident.
 */
export function cameraIncidents(logs) {
  const byCam = new Map();
  for (const l of logs) {
    if (!l.fire) continue;
    if (!byCam.has(l.camera)) byCam.set(l.camera, []);
    byCam.get(l.camera).push(l);
  }
  const incidents = [];
  for (const [camera, list] of byCam) {
    list.sort((a, b) => a.time - b.time);
    let cur = null;
    for (const l of list) {
      if (!cur || l.time - cur.end > INCIDENT_GAP_MS) {
        cur = { kind: "camera", camera, start: l.time, end: l.time, peak: 0, count: 0,
                activeIds: [], ids: [], lat: l.lat, lon: l.lon, resolvedMs: null };
        incidents.push(cur);
      }
      cur.end = l.time;
      cur.count++;
      cur.peak = Math.max(cur.peak, l.prob);
      cur.ids.push(l.id);
      if (l.active) cur.activeIds.push(l.id);
      if (l.resolvedMs) cur.resolvedMs = Math.max(cur.resolvedMs || 0, l.resolvedMs);
      if (l.lat != null) { cur.lat = l.lat; cur.lon = l.lon; }
    }
  }
  for (const i of incidents) {
    i.id = `${i.camera}@${i.start}`;
    i.time = i.start;
    i.active = i.activeIds.length > 0;
    i.sev = i.active ? "critical" : "good";
  }
  return incidents.sort((a, b) => b.start - a.start);
}

/** One list for feeds: camera incidents + citizen reports, open ones first, newest first. */
export function unifiedFeed(incidents, reports) {
  const items = [
    ...incidents.map((i) => ({ ...i, open: i.active })),
    ...reports,
  ];
  return items.sort((a, b) => (b.open - a.open) || (b.time - a.time));
}

/** Median of an array of numbers (null if empty). */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* ── Actions ───────────────────────────────────────────────── */

/** Mark every open reading of a camera incident as resolved (keeps the original reading for history). */
export async function resolveCameraIds(ctx, ids) {
  if (!ids.length) return;
  if (!ctx.isStaff) throw new Error("Only control-room staff can resolve fires.");
  const now = Date.now();
  const batch = writeBatch(ctx.db);
  ids.forEach((id) => batch.update(doc(ctx.db, ...fireLogsPath(ctx.config), id), { status: "resolved", resolved_ms: now }));
  await batch.commit();
}

/** Move a citizen report through the workflow, recording response times. */
export async function setReportStatus(ctx, report, status) {
  const now = Date.now();
  const data = { status, updated_ms: now, handled_by: ctx.user.email || ctx.user.uid };
  if (status !== "new" && !report.ackMs) data.acknowledged_ms = now;
  if (status === "resolved" || status === "dismissed") data.resolved_ms = now;
  await updateDoc(doc(ctx.db, COLLECTIONS.reports, report.id), data);
}

/* ── Formatting ────────────────────────────────────────────── */

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d < 60 ? `${d} d ago` : new Date(ms).toLocaleDateString();
}

export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const m = Math.round(ms / MIN);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString());
export const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;

/* ── WhatsApp messages ─────────────────────────────────────── */

const URDU = "🔥 آگ لگی ہوئی ہے — براہ کرم فوری کارروائی کریں۔";

export function whatsappLink(number, lines) {
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.filter((l) => l !== null && l !== undefined).join("\n"))}`;
}

export function cameraMessage(inc) {
  return [
    `🚨 Fire detected at ${inc.camera}`,
    inc.lat != null ? `Coordinates: ${inc.lat}, ${inc.lon}` : null,
    inc.lat != null ? `Map: https://www.google.com/maps?q=${inc.lat},${inc.lon}` : null,
    `Since: ${fmtDateTime(inc.start)}`,
    "",
    URDU,
  ];
}

export function reportMessage(r) {
  return [
    `🔥 Fire report (${r.typeInfo.label}) — Ref ${r.ref}`,
    `Place: ${r.place}`,
    r.lat != null ? `Map: https://www.google.com/maps?q=${r.lat},${r.lon}` : null,
    r.description ? `Details: ${r.description}` : null,
    r.name || r.phone ? `Reporter: ${[r.name, r.phone].filter(Boolean).join(", ")}` : null,
    `Reported: ${fmtDateTime(r.time)}`,
    "",
    URDU,
  ];
}
