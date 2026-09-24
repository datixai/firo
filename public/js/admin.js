/**
 * admin.js — FIRO admin panel (/admin)
 * ─────────────────────────────────────────────────────────────
 * Access: signed-in user whose UID has a document in the
 * "admins" collection. Firestore rules enforce the same check
 * (see firestore.rules), so hiding the page is not the only guard.
 *
 * Manages: fire reports, contact messages and blog posts.
 * ─────────────────────────────────────────────────────────────
 */

import { initFirebase, fireLogsPath, COLLECTIONS } from "/js/firebase-init.js";
import { esc, isActiveFire } from "/js/common.js";
import { initJungleBackground } from "/js/jungle-bg.js";
import { toast, formatDate } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";
import { compressImage } from "/js/image-utils.js";
import { STARTER_POSTS } from "/js/blog-data.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

initJungleBackground();

const $ = (id) => document.getElementById(id);

const REPORT_STATUSES = ["new", "reviewing", "verified", "resolved", "dismissed"];
const OPEN_STATUSES = ["new", "reviewing", "verified"];
const REPORT_TYPES = { smoke: "Smoke", small_fire: "Small fire", large_fire: "Large fire", near_homes: "Fire near homes" };
const STATUS_LABELS = { new: "New", reviewing: "Reviewing", verified: "Verified fire", resolved: "Resolved", dismissed: "Dismissed" };

const timeText = (ms) => (ms ? new Date(ms).toLocaleString() : "--");

// Stop running this module without an error (used after redirects / access denied)
const halt = () => new Promise(() => {});

function show(state) {
  for (const s of ["loading", "denied", "admin"]) $(`state-${s}`).hidden = s !== state;
}

/* ── Boot: Firebase + access check ─────────────────────────── */
let firebase;
try {
  firebase = await initFirebase();
} catch (err) {
  console.error(err);
  $("state-loading").innerHTML = `<p class="text-dim">Could not load configuration from /api/config.</p>`;
  throw err;
}
const { auth, db, config, settings } = firebase;

$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("/login?next=/admin");
});

const user = await new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (u) => { unsubscribe(); resolve(u); });
});
if (!user || user.isAnonymous) {
  window.location.replace("/login?next=/admin");
  await halt();
}

$("logout-btn").hidden = false;
$("admin-user").innerHTML = `${esc(user.email || "")}<br /><span class="text-muted">Admin</span>`;

let isAdmin = false;
try {
  isAdmin = (await getDoc(doc(db, COLLECTIONS.admins, user.uid))).exists();
} catch (err) {
  console.warn("[FIRO] Admin check failed:", err);
}

if (!isAdmin) {
  $("admin-user").innerHTML = esc(user.email || "");
  $("denied-email").textContent = user.email || "this account";
  $("denied-uid").textContent = user.uid;
  $("copy-uid").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(user.uid); toast("UID copied", "success"); }
    catch { toast("Copy failed. Select the UID and copy it manually.", "error"); }
  });
  show("denied");
  await halt();
}

show("admin");

/* ── Tabs ───────────────────────────────────────────────────── */
function openTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  try { sessionStorage.setItem("firo_admin_tab", name); } catch {}
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.goto)));
try { const saved = sessionStorage.getItem("firo_admin_tab"); if (saved) openTab(saved); } catch {}

/* ── Modals ─────────────────────────────────────────────────── */
function openModal(id) { $(id).classList.add("open"); }
function closeModal(el) { el.closest(".modal-backdrop").classList.remove("open"); }
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b)));
document.querySelectorAll(".modal-backdrop").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
});

function setBadge(id, n) {
  const el = $(id);
  el.textContent = n;
  el.hidden = !n;
}

/* ── Data ───────────────────────────────────────────────────── */
let reports = [], messages = [], posts = [];

function listenerError(what) {
  return (err) => {
    console.error(`[FIRO] ${what} listener error:`, err);
    toast(`Could not load ${what}: ${err.code || err.message}`, "error", 8000);
  };
}

onSnapshot(query(collection(db, COLLECTIONS.reports), orderBy("created_ms", "desc"), limit(300)), (snap) => {
  reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderReports();
  renderOverview();
}, listenerError("fire reports"));

onSnapshot(query(collection(db, COLLECTIONS.messages), orderBy("created_ms", "desc"), limit(300)), (snap) => {
  messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderMessages();
  renderOverview();
}, listenerError("messages"));

onSnapshot(collection(db, COLLECTIONS.posts), (snap) => {
  posts = snap.docs.map((d) => ({ slug: d.id, ...d.data() }))
    .sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
  renderPosts();
  renderOverview();
}, listenerError("blog posts"));

onSnapshot(collection(db, ...fireLogsPath(config)), (snap) => {
  const cameras = new Set();
  snap.forEach((d) => { const e = d.data(); if (isActiveFire(e)) cameras.add(e.camera_location || d.id); });
  $("ov-fires").textContent = cameras.size;
}, listenerError("fire logs"));

/* ── Overview ───────────────────────────────────────────────── */
function renderOverview() {
  const newReports = reports.filter((r) => r.status === "new").length;
  const unread = messages.filter((m) => m.status !== "read").length;
  $("ov-reports").textContent = newReports;
  $("ov-messages").textContent = unread;
  $("ov-posts").textContent = posts.filter((p) => p.published).length;
  setBadge("count-reports", newReports);
  setBadge("count-messages", unread);

  $("ov-report-list").innerHTML = reports.slice(0, 5).map((r) => `
    <div class="overview-row">
      <span><span class="pill pill-${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span>
        ${esc(REPORT_TYPES[r.type] || r.type)} · ${esc(r.place)}</span>
      <span class="text-muted">${esc(timeText(r.created_ms))}</span>
    </div>`).join("") || `<div class="empty">No reports yet.</div>`;

  $("ov-message-list").innerHTML = messages.slice(0, 5).map((m) => `
    <div class="overview-row">
      <span><span class="pill pill-${m.status === "read" ? "read" : "unread"}">${m.status === "read" ? "Read" : "Unread"}</span>
        ${esc(m.name)} · ${esc(m.subject)}</span>
      <span class="text-muted">${esc(timeText(m.created_ms))}</span>
    </div>`).join("") || `<div class="empty">No messages yet.</div>`;
}

/* ── Fire reports ───────────────────────────────────────────── */
$("report-filter").addEventListener("change", renderReports);

function renderReports() {
  const filter = $("report-filter").value;
  const list = reports.filter((r) =>
    !filter ? true : filter === "open" ? OPEN_STATUSES.includes(r.status) : r.status === filter);

  $("report-list").innerHTML = list.map((r) => {
    const hasLoc = typeof r.lat === "number" && typeof r.lon === "number";
    const mapUrl = hasLoc ? `https://www.google.com/maps?q=${r.lat},${r.lon}` : "";
    return `
    <article class="glass item" data-id="${esc(r.id)}">
      <div class="item-top">
        <div class="item-title"><i class="fa-solid fa-fire text-fire" aria-hidden="true"></i>
          ${esc(REPORT_TYPES[r.type] || r.type)} · ${esc(r.place)}</div>
        <span class="pill pill-${esc(r.status)}">${esc(STATUS_LABELS[r.status] || r.status)}</span>
      </div>
      <div class="item-meta">
        <span><i class="fa-regular fa-clock"></i>${esc(timeText(r.created_ms))}</span>
        <span><i class="fa-solid fa-hashtag"></i>${esc(r.id.slice(0, 8).toUpperCase())}</span>
        ${hasLoc ? `<span><i class="fa-solid fa-location-dot"></i><a href="${mapUrl}" target="_blank" rel="noopener">${r.lat}, ${r.lon}</a>${r.accuracy_m ? ` (±${esc(r.accuracy_m)} m)` : ""}</span>` : `<span><i class="fa-solid fa-location-dot"></i>No map location</span>`}
        ${r.name ? `<span><i class="fa-solid fa-user"></i>${esc(r.name)}</span>` : ""}
        ${r.phone ? `<span><i class="fa-solid fa-phone"></i><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></span>` : ""}
      </div>
      ${r.description ? `<div class="item-body">${esc(r.description)}</div>` : ""}
      ${r.photo ? `<img class="thumb" src="${esc(r.photo)}" alt="Report photo" data-photo="${esc(r.id)}" />` : ""}
      <div class="item-actions">
        <label class="sr-only" for="st-${esc(r.id)}">Status</label>
        <select class="select select-sm" id="st-${esc(r.id)}" data-status="${esc(r.id)}">
          ${REPORT_STATUSES.map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
        </select>
        ${settings.whatsappNumber ? `<button class="btn btn-sm" data-forward="${esc(r.id)}"><i class="fa-brands fa-whatsapp"></i> Forward</button>` : ""}
        <button class="btn btn-sm btn-danger" data-delete-report="${esc(r.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </article>`;
  }).join("") || `<div class="glass empty"><i class="fa-solid fa-inbox" aria-hidden="true"></i>No reports in this view.</div>`;
}

$("report-list").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  try {
    const r = reports.find((x) => x.id === id) || {};
    const status = e.target.value, now = Date.now();
    const data = { status, updated_ms: now, handled_by: user.email || user.uid };
    if (status !== "new" && !r.acknowledged_ms) data.acknowledged_ms = now;
    if (status === "resolved" || status === "dismissed") data.resolved_ms = now;
    await updateDoc(doc(db, COLLECTIONS.reports, id), data);
    toast("Status updated", "success");
  } catch (err) { console.error(err); toast("Update failed", "error"); }
});

$("report-list").addEventListener("click", async (e) => {
  const photo = e.target.closest("[data-photo]");
  if (photo) { $("photo-full").src = photo.src; openModal("photo-modal"); return; }

  const fwd = e.target.closest("[data-forward]");
  if (fwd) {
    const r = reports.find((x) => x.id === fwd.dataset.forward);
    const text = [
      `🔥 Fire report (${REPORT_TYPES[r.type] || r.type}) — Ref ${r.id.slice(0, 8).toUpperCase()}`,
      `Place: ${r.place}`,
      typeof r.lat === "number" ? `Map: https://www.google.com/maps?q=${r.lat},${r.lon}` : "",
      r.description ? `Details: ${r.description}` : "",
      r.name || r.phone ? `Reporter: ${[r.name, r.phone].filter(Boolean).join(", ")}` : "",
      `Reported: ${timeText(r.created_ms)}`,
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank");
    return;
  }

  const del = e.target.closest("[data-delete-report]");
  if (del && confirm("Delete this report permanently?")) {
    try { await deleteDoc(doc(db, COLLECTIONS.reports, del.dataset.deleteReport)); toast("Report deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

/* ── Messages ───────────────────────────────────────────────── */
$("message-filter").addEventListener("change", renderMessages);

function renderMessages() {
  const filter = $("message-filter").value;
  const list = messages.filter((m) =>
    !filter ? true : filter === "read" ? m.status === "read" : m.status !== "read");

  $("message-list").innerHTML = list.map((m) => {
    const read = m.status === "read";
    const reply = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject} (FIRO)`)}`;
    return `
    <article class="glass item">
      <div class="item-top">
        <div class="item-title">${esc(m.subject)}</div>
        <span class="pill pill-${read ? "read" : "unread"}">${read ? "Read" : "Unread"}</span>
      </div>
      <div class="item-meta">
        <span><i class="fa-solid fa-user"></i>${esc(m.name)}</span>
        <span><i class="fa-solid fa-at"></i><a href="${reply}">${esc(m.email)}</a></span>
        <span><i class="fa-regular fa-clock"></i>${esc(timeText(m.created_ms))}</span>
      </div>
      <div class="item-body">${esc(m.message)}</div>
      <div class="item-actions">
        <a class="btn btn-sm btn-leaf" href="${reply}"><i class="fa-solid fa-reply"></i> Reply by email</a>
        <button class="btn btn-sm" data-toggle-read="${esc(m.id)}" data-read="${read}">
          <i class="fa-solid ${read ? "fa-envelope" : "fa-envelope-open"}"></i> Mark as ${read ? "unread" : "read"}</button>
        <button class="btn btn-sm btn-danger" data-delete-message="${esc(m.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </article>`;
  }).join("") || `<div class="glass empty"><i class="fa-solid fa-inbox" aria-hidden="true"></i>No messages in this view.</div>`;
}

$("message-list").addEventListener("click", async (e) => {
  const tgl = e.target.closest("[data-toggle-read]");
  if (tgl) {
    const status = tgl.dataset.read === "true" ? "unread" : "read";
    try { await updateDoc(doc(db, COLLECTIONS.messages, tgl.dataset.toggleRead), { status }); }
    catch (err) { console.error(err); toast("Update failed", "error"); }
    return;
  }
  const del = e.target.closest("[data-delete-message]");
  if (del && confirm("Delete this message permanently?")) {
    try { await deleteDoc(doc(db, COLLECTIONS.messages, del.dataset.deleteMessage)); toast("Message deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

/* ── Blog posts ─────────────────────────────────────────────── */
function renderPosts() {
  $("blog-note").hidden = posts.length > 0;
  $("post-rows").innerHTML = posts.map((p) => `
    <tr>
      <td><strong>${esc(p.title)}</strong><br /><span class="text-muted" style="font-size:.85rem;">/blog/${esc(p.slug)}</span></td>
      <td><span class="pill pill-${p.published ? "published" : "draft"}">${p.published ? "Published" : "Draft"}</span></td>
      <td class="text-dim">${esc(formatDate(p.published_at))}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${p.published ? `<a class="btn btn-sm" href="/blog/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener" title="View" aria-label="View post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ""}
        <button class="btn btn-sm" data-publish="${esc(p.slug)}">${p.published ? "Unpublish" : "Publish"}</button>
        <button class="btn btn-sm" data-edit="${esc(p.slug)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-delete-post="${esc(p.slug)}" title="Delete" aria-label="Delete post"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No posts yet.</td></tr>`;
}

$("post-rows").addEventListener("click", async (e) => {
  const pub = e.target.closest("[data-publish]");
  if (pub) {
    const p = posts.find((x) => x.slug === pub.dataset.publish);
    try {
      await updateDoc(doc(db, COLLECTIONS.posts, p.slug), {
        published: !p.published,
        published_at: p.published_at || Date.now(),
        updated_ms: Date.now(),
      });
      toast(p.published ? "Post unpublished" : "Post published", "success");
    } catch (err) { console.error(err); toast("Update failed", "error"); }
    return;
  }
  const edit = e.target.closest("[data-edit]");
  if (edit) { openEditor(posts.find((x) => x.slug === edit.dataset.edit)); return; }

  const del = e.target.closest("[data-delete-post]");
  if (del && confirm(`Delete the post "${del.dataset.deletePost}" permanently?`)) {
    try { await deleteDoc(doc(db, COLLECTIONS.posts, del.dataset.deletePost)); toast("Post deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

$("import-starter").addEventListener("click", async () => {
  const missing = STARTER_POSTS.filter((s) => !posts.some((p) => p.slug === s.slug));
  if (!missing.length) return toast("Starter posts are already imported", "info");
  if (!confirm(`Import ${missing.length} starter post(s) into Firestore?`)) return;
  try {
    const batch = writeBatch(db);
    missing.forEach((p) => batch.set(doc(db, COLLECTIONS.posts, p.slug), { ...p, updated_ms: Date.now() }));
    await batch.commit();
    toast(`Imported ${missing.length} post(s)`, "success");
  } catch (err) { console.error(err); toast("Import failed", "error"); }
});

/* ── Post editor ────────────────────────────────────────────── */
let editing = null;       // slug of the post being edited, or null for a new post
let slugTouched = false;
let coverData = "";

const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

function updatePreview() {
  $("post-preview").innerHTML = renderMarkdown($("post-content").value) || `<p class="text-muted">Nothing to preview yet.</p>`;
  $("slug-preview").textContent = $("post-slug").value || "…";
}

function setCover(src) {
  coverData = src || "";
  $("cover-preview").src = coverData;
  $("cover-preview").hidden = !coverData;
}

function openEditor(post) {
  editing = post ? post.slug : null;
  slugTouched = !!post;
  $("editor-title").textContent = post ? "Edit post" : "New post";
  $("post-title").value = post?.title || "";
  $("post-slug").value = post?.slug || "";
  $("post-excerpt").value = post?.excerpt || "";
  $("post-tags").value = (post?.tags || []).join(", ");
  $("post-author").value = post?.author || "FIRO Team";
  $("post-cover-url").value = post?.cover && !post.cover.startsWith("data:") ? post.cover : "";
  setCover(post?.cover || "");
  $("post-date").value = new Date(post?.published_at || Date.now()).toISOString().slice(0, 10);
  $("post-published").checked = post ? !!post.published : false;
  $("post-content").value = post?.content || "";
  $("editor-status").innerHTML = "";
  updatePreview();
  openModal("editor-modal");
  $("post-title").focus();
}

$("new-post").addEventListener("click", () => openEditor(null));
$("post-title").addEventListener("input", () => {
  if (!slugTouched) $("post-slug").value = slugify($("post-title").value);
  updatePreview();
});
$("post-slug").addEventListener("input", () => { slugTouched = true; updatePreview(); });
$("post-content").addEventListener("input", updatePreview);
$("post-cover-url").addEventListener("change", () => setCover($("post-cover-url").value.trim()));
$("cover-clear").addEventListener("click", () => { $("post-cover-url").value = ""; setCover(""); });
$("post-cover-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    setCover(await compressImage(file, { maxSize: 1600, maxBytes: 600_000 }));
    $("post-cover-url").value = "";
  } catch (err) { toast(err.message, "error"); }
  e.target.value = "";
});

$("post-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("editor-status");
  const slug = slugify($("post-slug").value);
  const data = {
    slug,
    title: $("post-title").value.trim(),
    excerpt: $("post-excerpt").value.trim(),
    content: $("post-content").value,
    tags: $("post-tags").value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8),
    author: $("post-author").value.trim(),
    cover: coverData,
    published: $("post-published").checked,
    published_at: new Date($("post-date").value || Date.now()).getTime(),
    updated_ms: Date.now(),
  };

  const fail = (msg) => { status.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(msg)}</div></div>`; };
  if (!data.title || !data.excerpt || !data.content.trim()) return fail("Title, summary and content are required.");
  if (!slug) return fail("Please enter a URL slug (letters, numbers and dashes).");

  $("save-post").disabled = true;
  try {
    if (slug !== editing) {
      const existing = await getDoc(doc(db, COLLECTIONS.posts, slug));
      if (existing.exists()) { $("save-post").disabled = false; return fail(`A post with the slug "${slug}" already exists.`); }
    }
    await setDoc(doc(db, COLLECTIONS.posts, slug), data);
    if (editing && editing !== slug) await deleteDoc(doc(db, COLLECTIONS.posts, editing));
    toast("Post saved", "success");
    $("editor-modal").classList.remove("open");
  } catch (err) {
    console.error(err);
    fail(err.code === "invalid-argument" ? "The post is too large. Try a smaller cover image." : "Save failed. See the browser console for details.");
  } finally {
    $("save-post").disabled = false;
  }
});

/* ── Team (control-room staff) ─────────────────────────────── */
let staff = [];
onSnapshot(collection(db, COLLECTIONS.staff), (snap) => {
  staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (b.added_ms || 0) - (a.added_ms || 0));
  $("staff-rows").innerHTML = staff.map((m) => `
    <tr>
      <td><strong>${esc(m.email || m.name || "—")}</strong></td>
      <td class="text-muted" style="font-family:ui-monospace,Consolas,monospace;font-size:.85rem;">${esc(m.uid)}</td>
      <td class="text-dim">${esc(formatDate(m.added_ms))}</td>
      <td style="text-align:right;"><button class="btn btn-sm btn-danger" data-remove-staff="${esc(m.uid)}"><i class="fa-solid fa-user-minus"></i> Remove</button></td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No staff yet. Admins already have full access.</td></tr>`;
}, listenerError("team"));

$("staff-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = $("staff-uid").value.trim();
  const label = $("staff-email").value.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return toast("That doesn't look like a user ID. Copy it from the /incidents page.", "error");
  try {
    await setDoc(doc(db, COLLECTIONS.staff, uid), { email: label, added_ms: Date.now(), added_by: user.email || user.uid });
    $("staff-form").reset();
    toast("Added to the control-room team", "success");
  } catch (err) { console.error(err); toast("Could not add staff. Check the security rules are published.", "error"); }
});

$("staff-rows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-remove-staff]");
  if (!b || !confirm("Remove this person from the control-room team?")) return;
  try { await deleteDoc(doc(db, COLLECTIONS.staff, b.dataset.removeStaff)); toast("Removed from the team", "success"); }
  catch (err) { console.error(err); toast("Could not remove staff.", "error"); }
});
