/**
 * admin.js — FIRO admin panel (/admin)
 * ─────────────────────────────────────────────────────────────
 * Access: signed-in user whose UID has a document in the
 * "admins" collection. Firestore rules enforce the same check
 * (see firestore.rules), so hiding the page is not the only guard.
 *
 * Tabs: contact messages · donations (pledges, money received and
 * how it was used) · volunteers (applications, WhatsApp group,
 * featured profiles) · blog posts · our team (About page) · website
 * content (text on the public pages) · staff access (control room). Fire reports are handled
 * in the control room (/incidents).
 * ─────────────────────────────────────────────────────────────
 */

import { initFirebase, COLLECTIONS } from "/js/firebase-init.js";
import { esc } from "/js/common.js";
import { initJungleBackground } from "/js/jungle-bg.js";
import { toast, formatDate } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";
import { compressImage } from "/js/image-utils.js";
import { STARTER_POSTS } from "/js/blog-data.js";
import { STARTER_VOLUNTEERS, REGIONS, initials } from "/js/volunteers.js";
import { STARTER_TEAM, safeImage } from "/js/team.js";
import { CATEGORIES, money, totalsByYear } from "/js/donate.js";
import { applyContent, docIdFor, editableElements, loadSanitizer } from "/js/content.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

initJungleBackground();

const $ = (id) => document.getElementById(id);

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
const { auth, db } = firebase;

async function logout() {
  await signOut(auth);
  window.location.replace("/login?next=/admin");
}
$("logout-btn").addEventListener("click", logout);
$("denied-logout").addEventListener("click", logout);

const user = await new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (u) => { unsubscribe(); resolve(u); });
});
if (!user || user.isAnonymous) {
  window.location.replace("/login?next=/admin");
  await halt();
}

let isAdmin = false;
try {
  isAdmin = (await getDoc(doc(db, COLLECTIONS.admins, user.uid))).exists();
} catch (err) {
  console.warn("[FIRO] Admin check failed:", err);
}

if (!isAdmin) {
  $("denied-email").textContent = user.email || "this account";
  show("denied");
  await halt();
}

show("admin");

/* ── Profile menu ───────────────────────────────────────────── */
$("profile").hidden = false;
$("profile-email").textContent = user.email || "";
const profileBtn = $("profile-btn"), profileMenu = $("profile-menu");
function setMenu(open) {
  profileMenu.hidden = !open;
  profileBtn.setAttribute("aria-expanded", String(open));
}
profileBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(profileMenu.hidden); });
document.addEventListener("click", (e) => { if (!profileMenu.hidden && !profileMenu.contains(e.target)) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !profileMenu.hidden) { setMenu(false); profileBtn.focus(); } });

/* ── Tabs ───────────────────────────────────────────────────── */
const TABS = [...document.querySelectorAll(".tab")].map((t) => t.dataset.tab);
const tabHooks = {};
let currentTab = "messages";
function openTab(name) {
  if (!TABS.includes(name)) name = "messages";
  if (currentTab === "content" && name !== "content" && !confirmLeaveContent()) return;
  currentTab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  try { sessionStorage.setItem("firo_admin_tab", name); } catch {}
  tabHooks[name]?.();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));

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

function listenerError(what) {
  return (err) => {
    console.error(`[FIRO] ${what} listener error:`, err);
    toast(`Could not load ${what}: ${err.code || err.message}`, "error", 8000);
  };
}

/* ── Messages ───────────────────────────────────────────────── */
let messages = [];
onSnapshot(query(collection(db, COLLECTIONS.messages), orderBy("created_ms", "desc"), limit(300)), (snap) => {
  messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  setBadge("count-messages", messages.filter((m) => m.status !== "read").length);
  renderMessages();
}, listenerError("messages"));

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
let posts = [];
let blogChecked = false;

onSnapshot(collection(db, COLLECTIONS.posts), (snap) => {
  posts = snap.docs.map((d) => ({ slug: d.id, ...d.data() }))
    .sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
  renderPosts();
  if (!blogChecked) { blogChecked = true; takeOverBlog(); }
}, listenerError("blog posts"));

/**
 * The website shows built-in starter articles until the admin panel manages the blog.
 * The first time an admin opens the panel, copy them into Firestore (if there are no
 * posts yet) so every article can be edited or deleted here, and mark the blog as managed.
 */
async function takeOverBlog() {
  try {
    const ref = doc(db, COLLECTIONS.content, "blog");
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().posts_managed) return;
    const missing = posts.length ? [] : STARTER_POSTS;
    const batch = writeBatch(db);
    missing.forEach((p) => batch.set(doc(db, COLLECTIONS.posts, p.slug), starterDoc(p)));
    batch.set(ref, { posts_managed: true, updated_ms: Date.now(), updated_by: user.email || user.uid }, { merge: true });
    await batch.commit();
    if (missing.length) toast(`The ${missing.length} built-in articles are now listed in Blog, so you can edit or delete them.`, "info", 7000);
  } catch (err) {
    console.error("[FIRO] Could not set up blog management:", err);
  }
}

/** A built-in article as stored in Firestore. */
function starterDoc(sp, keep = {}) {
  const { rev, replaces, ...post } = sp;
  return { ...post, ...keep, starter_rev: rev || 1, updated_ms: Date.now() };
}

/**
 * Built-in articles whose text changed since they were copied into Firestore
 * (found by slug, or by their old slug if the address changed).
 */
function starterUpdates() {
  return STARTER_POSTS.map((sp) => ({ sp, cur: posts.find((p) => p.slug === sp.slug) || posts.find((p) => sp.replaces && p.slug === sp.replaces) }))
    .filter(({ sp, cur }) => cur && (cur.starter_rev || 1) < (sp.rev || 1));
}

function renderStarterUpdate() {
  const list = starterUpdates();
  $("starter-update").hidden = !list.length;
  $("starter-update-list").textContent = list.length
    ? ` New versions (with cover photos) of: ${list.map(({ sp }) => `"${sp.title}"`).join(", ")}. Updating replaces their text but keeps them published or hidden as they are now.`
    : "";
}

$("starter-apply").addEventListener("click", async () => {
  const list = starterUpdates();
  if (!list.length || !confirm("Replace these articles with the updated versions? Any changes you made to them will be lost.")) return;
  try {
    const batch = writeBatch(db);
    for (const { sp, cur } of list) {
      batch.set(doc(db, COLLECTIONS.posts, sp.slug), starterDoc(sp, {
        published: !!cur.published, published_at: cur.published_at || sp.published_at, cover: cur.cover || sp.cover || "",
      }));
      if (cur.slug !== sp.slug) batch.delete(doc(db, COLLECTIONS.posts, cur.slug));
    }
    await batch.commit();
    toast("Articles updated", "success");
  } catch (err) { console.error(err); toast("Update failed", "error"); }
});

$("starter-keep").addEventListener("click", async () => {
  try {
    const batch = writeBatch(db);
    for (const { sp, cur } of starterUpdates()) batch.update(doc(db, COLLECTIONS.posts, cur.slug), { starter_rev: sp.rev });
    await batch.commit();
  } catch (err) { console.error(err); toast("Update failed", "error"); }
});

function renderPosts() {
  renderStarterUpdate();
  $("post-rows").innerHTML = posts.map((p) => `
    <tr>
      <td><strong>${esc(p.title)}</strong><br /><span class="text-muted" style="font-size:.85rem;">/blog/${esc(p.slug)}</span></td>
      <td><span class="pill pill-${p.published ? "published" : "draft"}">${p.published ? "Published" : "Draft"}</span></td>
      <td class="text-dim">${esc(formatDate(p.published_at))}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${p.published ? `<a class="btn btn-sm" href="/blog/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener" title="View" aria-label="View post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ""}
        <button class="btn btn-sm" data-publish="${esc(p.slug)}">${p.published ? "Unpublish" : "Publish"}</button>
        <button class="btn btn-sm" data-edit="${esc(p.slug)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-delete-post="${esc(p.slug)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No posts yet. Press <strong>New post</strong> to write one.</td></tr>`;
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
  if (del) {
    const p = posts.find((x) => x.slug === del.dataset.deletePost);
    if (!confirm(`Delete "${p?.title || del.dataset.deletePost}" permanently?`)) return;
    try { await deleteDoc(doc(db, COLLECTIONS.posts, del.dataset.deletePost)); toast("Post deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
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

  // Keep the built-in article revision, so "Updated built-in articles" is not offered again
  const prev = posts.find((x) => x.slug === editing);
  if (prev?.starter_rev) data.starter_rev = prev.starter_rev;

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

/* ── Donations ──────────────────────────────────────────────── */
let pledges = [], records = [], uses = [];
const causeName = (k) => CATEGORIES[k]?.label || k || "";
const dateInput = (ms) => new Date(ms || Date.now()).toISOString().slice(0, 10);
const fromDateInput = (v) => { const t = new Date(`${v}T12:00:00`).getTime(); return Number.isFinite(t) ? t : Date.now(); };
const PLEDGE_STATUS = { new: ["New", "new"], contacted: ["Contacted", "reviewing"], received: ["Received", "resolved"], declined: ["Declined", "dismissed"] };

onSnapshot(query(collection(db, COLLECTIONS.pledges), orderBy("created_ms", "desc"), limit(500)), (snap) => {
  pledges = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  setBadge("count-pledges", pledges.filter((p) => p.status === "new").length);
  renderPledges();
  renderRecords();
}, listenerError("donation pledges"));
onSnapshot(collection(db, COLLECTIONS.donations), (snap) => {
  records = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.received_ms || 0) - (a.received_ms || 0));
  renderRecords();
  renderYears();
}, listenerError("donations"));
onSnapshot(collection(db, COLLECTIONS.donationUses), (snap) => {
  uses = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date_ms || 0) - (a.date_ms || 0));
  renderUses();
  renderYears();
}, listenerError("donation spending"));

function renderYears() {
  const byYear = totalsByYear(records);
  const spent = {};
  uses.forEach((u) => { spent[u.year] = (spent[u.year] || 0) + (Number(u.amount) || 0); });
  const years = [...new Set([...Object.keys(byYear), ...Object.keys(spent)])].map(Number).sort((a, b) => b - a);
  $("year-rows").innerHTML = years.map((y) => `
    <tr><td><strong>${y}</strong></td><td>${esc(money(byYear[y]?.total || 0))}</td><td>${esc(money(spent[y] || 0))}</td><td class="text-dim">${byYear[y]?.count || 0}</td></tr>`).join("")
    || `<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>`;
}

$("pledge-filter").addEventListener("change", renderPledges);
function pledgeMessage(p) {
  return `Assalam o Alaikum ${p.name}! Thank you for your pledge of ${money(p.amount, p.currency)} for ${causeName(p.category)} to FIRO. `;
}
function renderPledges() {
  const filter = $("pledge-filter").value;
  const list = pledges.filter((p) => !filter || p.status === filter);
  $("pledge-list").innerHTML = list.map((p) => {
    const [label, pill] = PLEDGE_STATUS[p.status] || [p.status, "draft"];
    const mail = `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent("Your donation to FIRO")}&body=${encodeURIComponent(pledgeMessage(p))}`;
    return `
    <article class="glass item">
      <div class="item-top">
        <div class="item-title">${esc(money(p.amount, p.currency))} · ${esc(causeName(p.category))}</div>
        <span class="pill pill-${pill}">${esc(label)}</span>
      </div>
      <div class="item-meta">
        <span><i class="fa-solid fa-user"></i>${esc(p.name)}</span>
        ${p.location ? `<span><i class="fa-solid fa-location-dot"></i>${esc(p.location)}</span>` : ""}
        <span><i class="fa-solid fa-at"></i><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></span>
        <span><i class="fa-solid fa-phone"></i><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></span>
        <span><i class="fa-regular fa-clock"></i>${esc(timeText(p.created_ms))}</span>
        ${p.received_amount ? `<span><i class="fa-solid fa-circle-check"></i>Received ${esc(money(p.received_amount))}</span>` : ""}
      </div>
      ${p.message ? `<div class="item-body"><strong class="text-dim" style="font-size:.85rem;">Message / prayer request</strong><br />${esc(p.message)}</div>` : ""}
      <div class="item-actions">
        <button class="btn btn-sm btn-leaf" data-pledge-wa="${esc(p.id)}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
        <a class="btn btn-sm" href="${mail}" data-pledge-mail="${esc(p.id)}"><i class="fa-solid fa-envelope"></i> Email</a>
        ${p.status !== "received" ? `<button class="btn btn-sm btn-leaf" data-pledge-record="${esc(p.id)}"><i class="fa-solid fa-sack-dollar"></i> Record donation</button>` : ""}
        ${p.status === "new" ? `<button class="btn btn-sm" data-pledge-status="contacted" data-pledge="${esc(p.id)}">Mark contacted</button>` : ""}
        ${p.status !== "declined" && p.status !== "received" ? `<button class="btn btn-sm" data-pledge-status="declined" data-pledge="${esc(p.id)}">Didn't donate</button>` : ""}
        <button class="btn btn-sm btn-danger" data-delete-pledge="${esc(p.id)}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </article>`;
  }).join("") || `<div class="glass empty"><i class="fa-solid fa-inbox" aria-hidden="true"></i>No pledges in this view.</div>`;
}

const markContacted = (p) => {
  if (p.status !== "new") return;
  updateDoc(doc(db, COLLECTIONS.pledges, p.id), { status: "contacted", contacted_ms: Date.now(), handled_by: user.email || user.uid })
    .catch((err) => console.error(err));
};

$("pledge-list").addEventListener("click", async (e) => {
  const id = (k) => e.target.closest(`[${k}]`)?.getAttribute(k);
  const wa = id("data-pledge-wa"), mail = id("data-pledge-mail"), rec = id("data-pledge-record"), del = id("data-delete-pledge");
  const st = e.target.closest("[data-pledge-status]");
  if (wa) {
    const p = pledges.find((x) => x.id === wa);
    window.open(`https://wa.me/${waNumber(p.phone)}?text=${encodeURIComponent(pledgeMessage(p))}`, "_blank");
    markContacted(p);
  } else if (mail) {
    markContacted(pledges.find((x) => x.id === mail));
  } else if (rec) {
    openRecordEditor(null, pledges.find((x) => x.id === rec));
  } else if (st) {
    try {
      await updateDoc(doc(db, COLLECTIONS.pledges, st.dataset.pledge),
        { status: st.dataset.pledgeStatus, [`${st.dataset.pledgeStatus}_ms`]: Date.now(), handled_by: user.email || user.uid });
    } catch (err) { console.error(err); toast("Update failed", "error"); }
  } else if (del && confirm("Delete this pledge permanently?")) {
    try { await deleteDoc(doc(db, COLLECTIONS.pledges, del)); toast("Pledge deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

/* Donations received */
function renderRecords() {
  $("record-rows").innerHTML = records.map((r) => {
    const p = r.pledge_id && pledges.find((x) => x.id === r.pledge_id);
    return `
    <tr>
      <td class="text-dim">${esc(formatDate(r.received_ms))}</td>
      <td>${esc(causeName(r.category))}</td>
      <td><strong>${esc(money(r.amount))}</strong></td>
      <td class="text-dim">${p ? esc(p.name) : r.pledge_id ? "Pledge" : "Added by hand"}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" data-record-edit="${esc(r.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-record-delete="${esc(r.id)}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No donations recorded yet.</td></tr>`;
}

let editingRecord = null, recordPledge = null;
function openRecordEditor(r, pledge = null) {
  editingRecord = r ? r.id : null;
  recordPledge = pledge || (r?.pledge_id && pledges.find((x) => x.id === r.pledge_id)) || null;
  $("record-title").textContent = r ? "Edit donation" : "Record donation";
  $("record-from").textContent = recordPledge
    ? `From ${recordPledge.name} (pledged ${money(recordPledge.amount, recordPledge.currency)}). Enter the amount actually received, in rupees.`
    : "A donation received outside the Donate form.";
  $("record-amount").value = r?.amount ?? (pledge && pledge.currency === "PKR" ? pledge.amount : "");
  $("record-date").value = dateInput(r?.received_ms);
  $("record-category").value = r?.category || pledge?.category || "general";
  $("record-status").innerHTML = "";
  openModal("record-modal");
  $("record-amount").focus();
}
$("new-record").addEventListener("click", () => openRecordEditor(null));
$("record-rows").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-record-edit]"), del = e.target.closest("[data-record-delete]");
  if (edit) openRecordEditor(records.find((x) => x.id === edit.dataset.recordEdit));
  if (del && confirm("Delete this donation from the records? It will also leave the public totals.")) {
    const r = records.find((x) => x.id === del.dataset.recordDelete);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, COLLECTIONS.donations, r.id));
      if (r.pledge_id && pledges.some((p) => p.id === r.pledge_id)) {
        batch.update(doc(db, COLLECTIONS.pledges, r.pledge_id), { status: "contacted", received_amount: 0 });
      }
      await batch.commit();
      toast("Donation removed", "success");
    } catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});
$("record-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number($("record-amount").value);
  const fail = (msg) => { $("record-status").innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(msg)}</div></div>`; };
  if (!(amount > 0) || amount > 1e9) return fail("Enter the amount received in rupees.");
  const received_ms = fromDateInput($("record-date").value);
  const data = {
    amount: Math.round(amount),
    category: $("record-category").value,
    year: new Date(received_ms).getFullYear(),
    received_ms,
    pledge_id: recordPledge?.id || "",
    updated_ms: Date.now(),
  };
  $("save-record").disabled = true;
  try {
    const batch = writeBatch(db);
    const ref = editingRecord ? doc(db, COLLECTIONS.donations, editingRecord) : doc(collection(db, COLLECTIONS.donations));
    batch.set(ref, editingRecord ? { ...data, created_ms: records.find((x) => x.id === editingRecord)?.created_ms || Date.now() } : { ...data, created_ms: Date.now() });
    if (recordPledge) {
      batch.update(doc(db, COLLECTIONS.pledges, recordPledge.id),
        { status: "received", received_amount: data.amount, received_ms, record_id: ref.id, handled_by: user.email || user.uid });
    }
    await batch.commit();
    toast("Donation recorded. It now counts in the public totals.", "success");
    $("record-modal").classList.remove("open");
  } catch (err) {
    console.error(err);
    fail("Save failed. Check that the latest security rules are published.");
  } finally {
    $("save-record").disabled = false;
  }
});

/* How donations were used */
function renderUses() {
  $("use-rows").innerHTML = uses.map((u) => `
    <tr>
      <td class="text-dim">${esc(formatDate(u.date_ms))}</td>
      <td><strong>${esc(u.title)}</strong>${u.description ? `<br /><span class="text-muted" style="font-size:.85rem;">${esc(u.description.slice(0, 90))}${u.description.length > 90 ? "…" : ""}</span>` : ""}</td>
      <td>${esc(causeName(u.category))}</td>
      <td><strong>${esc(money(u.amount))}</strong></td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" data-use-edit="${esc(u.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-use-delete="${esc(u.id)}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty">No spending reported yet.</td></tr>`;
}
let editingUse = null;
function openUseEditor(u) {
  editingUse = u ? u.id : null;
  $("use-title").textContent = u ? "Edit spending" : "Add spending";
  $("use-what").value = u?.title || "";
  $("use-amount").value = u?.amount ?? "";
  $("use-date").value = dateInput(u?.date_ms);
  $("use-category").value = u?.category || "plantation";
  $("use-description").value = u?.description || "";
  $("use-status").innerHTML = "";
  openModal("use-modal");
  $("use-what").focus();
}
$("new-use").addEventListener("click", () => openUseEditor(null));
$("use-rows").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-use-edit]"), del = e.target.closest("[data-use-delete]");
  if (edit) openUseEditor(uses.find((x) => x.id === edit.dataset.useEdit));
  if (del && confirm("Delete this spending entry? It will also leave the public report.")) {
    try { await deleteDoc(doc(db, COLLECTIONS.donationUses, del.dataset.useDelete)); toast("Removed", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});
$("use-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("use-what").value.trim(), amount = Number($("use-amount").value);
  const fail = (msg) => { $("use-status").innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(msg)}</div></div>`; };
  if (!title) return fail("Say what the money was used for.");
  if (!(amount > 0) || amount > 1e9) return fail("Enter the amount spent in rupees.");
  const date_ms = fromDateInput($("use-date").value);
  const data = {
    title, amount: Math.round(amount), category: $("use-category").value,
    description: $("use-description").value.trim(), year: new Date(date_ms).getFullYear(), date_ms, updated_ms: Date.now(),
  };
  $("save-use").disabled = true;
  try {
    if (editingUse) await setDoc(doc(db, COLLECTIONS.donationUses, editingUse), { ...data, created_ms: uses.find((x) => x.id === editingUse)?.created_ms || Date.now() });
    else await setDoc(doc(collection(db, COLLECTIONS.donationUses)), { ...data, created_ms: Date.now() });
    toast("Saved. It now shows on the Donate page.", "success");
    $("use-modal").classList.remove("open");
  } catch (err) {
    console.error(err);
    fail("Save failed. Check that the latest security rules are published.");
  } finally {
    $("save-use").disabled = false;
  }
});

/* ── Volunteers: applications ───────────────────────────────── */
let applications = [];
let groupLink = "";

onSnapshot(query(collection(db, COLLECTIONS.applications), orderBy("created_ms", "desc"), limit(500)), (snap) => {
  applications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  setBadge("count-applications", applications.filter((a) => a.status === "pending").length);
  renderApplications();
}, listenerError("volunteer applications"));

$("application-filter").addEventListener("change", renderApplications);

const APP_STATUS = { pending: ["Waiting", "new"], approved: ["Approved", "resolved"], declined: ["Declined", "dismissed"] };

/** Phone number for wa.me links: digits only, Pakistani 03xx numbers get the 92 country code. */
function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = `92${d.slice(1)}`;
  return d;
}
const inviteText = (a) => `Assalam o Alaikum ${a.name}! Thank you for volunteering with FIRO. Your application has been approved. Join the volunteers' WhatsApp group here: ${groupLink}`;

function renderApplications() {
  const filter = $("application-filter").value;
  const list = applications.filter((a) => !filter || a.status === filter);
  $("application-list").innerHTML = list.map((a) => {
    const [label, pill] = APP_STATUS[a.status] || [a.status, "draft"];
    const mail = `mailto:${encodeURIComponent(a.email)}?subject=${encodeURIComponent("FIRO volunteers")}&body=${encodeURIComponent(groupLink ? inviteText(a) : `Assalam o Alaikum ${a.name},\n\n`)}`;
    return `
    <article class="glass item">
      <div class="item-top">
        <div class="item-title">${esc(a.name)}</div>
        <span class="pill pill-${pill}">${esc(label)}</span>
      </div>
      <div class="item-meta">
        <span><i class="fa-solid fa-location-dot"></i>${esc(a.location)}</span>
        <span><i class="fa-solid fa-at"></i><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></span>
        <span><i class="fa-solid fa-phone"></i><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></span>
        <span><i class="fa-regular fa-clock"></i>${esc(timeText(a.created_ms))}</span>
        ${a.invited_ms ? `<span><i class="fa-brands fa-whatsapp"></i>Invite sent ${esc(timeText(a.invited_ms))}</span>` : ""}
      </div>
      <div class="item-body">${esc(a.motivation)}</div>
      <div class="item-actions">
        ${a.status !== "approved" ? `<button class="btn btn-sm btn-leaf" data-app-status="approved" data-app="${esc(a.id)}"><i class="fa-solid fa-check"></i> Approve</button>` : ""}
        ${a.status === "pending" ? `<button class="btn btn-sm" data-app-status="declined" data-app="${esc(a.id)}"><i class="fa-solid fa-xmark"></i> Decline</button>` : ""}
        ${a.status === "approved" ? `
          <button class="btn btn-sm btn-leaf" data-invite="${esc(a.id)}" ${groupLink ? "" : 'disabled title="Add the WhatsApp group link below first"'}><i class="fa-brands fa-whatsapp"></i> Send invite</button>
          <a class="btn btn-sm" href="${mail}" data-mail-invite="${esc(a.id)}"><i class="fa-solid fa-envelope"></i> Email</a>` : ""}
        <button class="btn btn-sm btn-danger" data-delete-app="${esc(a.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </article>`;
  }).join("") || `<div class="glass empty"><i class="fa-solid fa-inbox" aria-hidden="true"></i>No applications in this view.</div>`;
}

$("application-list").addEventListener("click", async (e) => {
  const st = e.target.closest("[data-app-status]");
  if (st) {
    try {
      await updateDoc(doc(db, COLLECTIONS.applications, st.dataset.app),
        { status: st.dataset.appStatus, reviewed_ms: Date.now(), reviewed_by: user.email || user.uid });
      toast(st.dataset.appStatus === "approved" ? "Approved. Now send the WhatsApp group invite." : "Application declined", "success");
    } catch (err) { console.error(err); toast("Update failed", "error"); }
    return;
  }
  const inv = e.target.closest("[data-invite]") || e.target.closest("[data-mail-invite]");
  if (inv) {
    const id = inv.dataset.invite || inv.dataset.mailInvite;
    const a = applications.find((x) => x.id === id);
    if (inv.dataset.invite) window.open(`https://wa.me/${waNumber(a.phone)}?text=${encodeURIComponent(inviteText(a))}`, "_blank");
    if (groupLink) updateDoc(doc(db, COLLECTIONS.applications, id), { invited_ms: Date.now() }).catch((err) => console.error(err));
    return;
  }
  const del = e.target.closest("[data-delete-app]");
  if (del && confirm("Delete this application permanently?")) {
    try { await deleteDoc(doc(db, COLLECTIONS.applications, del.dataset.deleteApp)); toast("Application deleted", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

/* ── Volunteers: WhatsApp group link ────────────────────────── */
onSnapshot(doc(db, COLLECTIONS.volunteerSettings, "group"), (snap) => {
  const d = snap.exists() ? snap.data() : {};
  groupLink = d.link || "";
  $("group-link-input").value = groupLink;
  $("group-public").checked = !!d.public;
  $("group-saved").textContent = d.updated_ms ? `Last changed ${timeText(d.updated_ms)}` : "";
  renderApplications();
}, listenerError("WhatsApp group link"));

$("group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const link = $("group-link-input").value.trim();
  if (link && !/^https:\/\/chat\.whatsapp\.com\/\S+$/.test(link)) {
    return toast("Paste the group's invite link. It starts with https://chat.whatsapp.com/", "error", 7000);
  }
  try {
    await setDoc(doc(db, COLLECTIONS.volunteerSettings, "group"),
      { link, public: !!link && $("group-public").checked, updated_ms: Date.now(), updated_by: user.email || user.uid });
    toast("WhatsApp group link saved", "success");
  } catch (err) { console.error(err); toast("Save failed. Check that the latest security rules are published.", "error", 8000); }
});

/* ── Volunteers: featured profiles ──────────────────────────── */
let profiles = [];
let profilesChecked = false;
onSnapshot(collection(db, COLLECTIONS.volunteers), (snap) => {
  profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name)));
  renderProfiles();
  if (!profilesChecked) { profilesChecked = true; takeOverProfiles(); }
}, listenerError("featured volunteers"));

/** First visit: copy the built-in profiles into Firestore so they can be edited here. */
async function takeOverProfiles() {
  try {
    const ref = doc(db, COLLECTIONS.content, "volunteers");
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().profiles_managed) return;
    const batch = writeBatch(db);
    if (!profiles.length) {
      STARTER_VOLUNTEERS.forEach(({ id, ...v }) => batch.set(doc(db, COLLECTIONS.volunteers, id), { ...v, created_ms: Date.now(), updated_ms: Date.now() }));
    }
    batch.set(ref, { profiles_managed: true, updated_ms: Date.now(), updated_by: user.email || user.uid }, { merge: true });
    await batch.commit();
  } catch (err) {
    console.error("[FIRO] Could not set up volunteer profiles:", err);
  }
}

function renderProfiles() {
  $("volunteer-rows").innerHTML = profiles.map((v) => `
    <tr>
      <td><strong>${esc(v.name)}</strong><br /><span class="text-muted" style="font-size:.85rem;">${esc(v.role || "")}</span></td>
      <td class="text-dim">${esc(REGIONS[v.region] || v.region || "")}</td>
      <td><span class="pill pill-${v.published ? "published" : "draft"}">${v.published ? "Shown" : "Hidden"}</span>
        ${!v.story ? `<br /><span class="text-muted" style="font-size:.8rem;">Story not written yet</span>` : ""}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" data-vol-publish="${esc(v.id)}">${v.published ? "Hide" : "Show"}</button>
        <button class="btn btn-sm" data-vol-edit="${esc(v.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-vol-delete="${esc(v.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No featured volunteers yet. Press <strong>Add volunteer</strong>.</td></tr>`;
}

$("volunteer-rows").addEventListener("click", async (e) => {
  const pub = e.target.closest("[data-vol-publish]");
  if (pub) {
    const v = profiles.find((x) => x.id === pub.dataset.volPublish);
    try { await updateDoc(doc(db, COLLECTIONS.volunteers, v.id), { published: !v.published, updated_ms: Date.now() }); }
    catch (err) { console.error(err); toast("Update failed", "error"); }
    return;
  }
  const edit = e.target.closest("[data-vol-edit]");
  if (edit) { openVolunteerEditor(profiles.find((x) => x.id === edit.dataset.volEdit)); return; }
  const del = e.target.closest("[data-vol-delete]");
  if (del) {
    const v = profiles.find((x) => x.id === del.dataset.volDelete);
    if (!confirm(`Remove ${v?.name || "this volunteer"} from the website?`)) return;
    try { await deleteDoc(doc(db, COLLECTIONS.volunteers, del.dataset.volDelete)); toast("Removed", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

let editingVolunteer = null;
let volunteerPhoto = "";
function setVolunteerPhoto(src) {
  volunteerPhoto = src || "";
  $("vol-photo-preview").src = volunteerPhoto;
  $("vol-photo-preview").hidden = !volunteerPhoto;
}
function openVolunteerEditor(v) {
  editingVolunteer = v ? v.id : null;
  $("volunteer-editor-title").textContent = v ? `Edit ${v.name}` : "Add volunteer";
  $("vol-name").value = v?.name || "";
  $("vol-region").value = v?.region || "ajk";
  $("vol-role").value = v?.role || "";
  $("vol-story").value = v?.story || "";
  $("vol-link").value = v?.link || "";
  $("vol-order").value = v?.order ?? (profiles.length + 1);
  $("vol-photo-url").value = v?.photo && !v.photo.startsWith("data:") ? v.photo : "";
  setVolunteerPhoto(v?.photo || "");
  $("vol-published").checked = v ? !!v.published : true;
  $("volunteer-status").innerHTML = "";
  openModal("volunteer-modal");
  $("vol-name").focus();
}
$("new-volunteer").addEventListener("click", () => openVolunteerEditor(null));
$("vol-photo-url").addEventListener("change", () => setVolunteerPhoto($("vol-photo-url").value.trim()));
$("vol-photo-clear").addEventListener("click", () => { $("vol-photo-url").value = ""; setVolunteerPhoto(""); });
$("vol-photo-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { setVolunteerPhoto(await compressImage(file, { maxSize: 480, maxBytes: 150_000 })); $("vol-photo-url").value = ""; }
  catch (err) { toast(err.message, "error"); }
  e.target.value = "";
});

$("volunteer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("vol-name").value.trim();
  const link = $("vol-link").value.trim();
  const fail = (msg) => { $("volunteer-status").innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(msg)}</div></div>`; };
  if (!name) return fail("Please enter a name.");
  if (link && !/^https?:\/\//i.test(link)) return fail("The link must start with https://");
  const data = {
    name,
    region: $("vol-region").value,
    role: $("vol-role").value.trim(),
    story: $("vol-story").value.trim(),
    link,
    photo: volunteerPhoto,
    order: Number($("vol-order").value) || 0,
    published: $("vol-published").checked,
    updated_ms: Date.now(),
  };
  $("save-volunteer").disabled = true;
  try {
    if (editingVolunteer) await updateDoc(doc(db, COLLECTIONS.volunteers, editingVolunteer), data);
    else {
      const id = slugify(name) || `volunteer-${Date.now()}`;
      const exists = (await getDoc(doc(db, COLLECTIONS.volunteers, id))).exists();
      await setDoc(doc(db, COLLECTIONS.volunteers, exists ? `${id}-${Date.now().toString(36)}` : id), { ...data, created_ms: Date.now() });
    }
    toast("Saved", "success");
    $("volunteer-modal").classList.remove("open");
  } catch (err) {
    console.error(err);
    fail(err.code === "invalid-argument" ? "The photo is too large. Try a smaller one." : "Save failed. Check that the latest security rules are published.");
  } finally {
    $("save-volunteer").disabled = false;
  }
});

/* ── Our team (About page) ──────────────────────────────────── */
let members = [];
let membersChecked = false;
onSnapshot(collection(db, COLLECTIONS.team), (snap) => {
  members = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name)));
  renderMembers();
  if (!membersChecked) { membersChecked = true; takeOverTeam(); }
}, listenerError("team members"));

/** First visit: copy the built-in team into Firestore so it can be edited here. */
async function takeOverTeam() {
  try {
    const ref = doc(db, COLLECTIONS.content, "about");
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().team_managed) return;
    const batch = writeBatch(db);
    if (!members.length) {
      STARTER_TEAM.forEach(({ id, ...m }) => batch.set(doc(db, COLLECTIONS.team, id), { ...m, created_ms: Date.now(), updated_ms: Date.now() }));
    }
    batch.set(ref, { team_managed: true, updated_ms: Date.now(), updated_by: user.email || user.uid }, { merge: true });
    await batch.commit();
  } catch (err) {
    console.error("[FIRO] Could not set up the team list:", err);
  }
}

const photoHtml = (url, name) => (safeImage(url) ? `<img src="${esc(safeImage(url))}" alt="" />` : esc(initials(name)));

function renderMembers() {
  $("member-rows").innerHTML = members.map((m) => `
    <tr>
      <td><div style="display:flex;gap:12px;align-items:center;">
        <span class="member-thumb">${photoHtml(m.photo, m.name)}</span>
        <div><strong>${esc(m.name)}</strong><br /><span class="text-muted" style="font-size:.85rem;">${esc(m.role || "")}</span></div>
      </div></td>
      <td><span class="pill pill-${m.published ? "published" : "draft"}">${m.published ? "Shown" : "Hidden"}</span></td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm" data-member-publish="${esc(m.id)}">${m.published ? "Hide" : "Show"}</button>
        <button class="btn btn-sm" data-member-edit="${esc(m.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm btn-danger" data-member-delete="${esc(m.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="3" class="empty">No team members yet. Press <strong>Add member</strong>.</td></tr>`;
}

$("member-rows").addEventListener("click", async (e) => {
  const pub = e.target.closest("[data-member-publish]");
  if (pub) {
    const m = members.find((x) => x.id === pub.dataset.memberPublish);
    try { await updateDoc(doc(db, COLLECTIONS.team, m.id), { published: !m.published, updated_ms: Date.now() }); }
    catch (err) { console.error(err); toast("Update failed", "error"); }
    return;
  }
  const edit = e.target.closest("[data-member-edit]");
  if (edit) { openMemberEditor(members.find((x) => x.id === edit.dataset.memberEdit)); return; }
  const del = e.target.closest("[data-member-delete]");
  if (del) {
    const m = members.find((x) => x.id === del.dataset.memberDelete);
    if (!confirm(`Remove ${m?.name || "this member"} from the About page?`)) return;
    try { await deleteDoc(doc(db, COLLECTIONS.team, del.dataset.memberDelete)); toast("Removed", "success"); }
    catch (err) { console.error(err); toast("Delete failed", "error"); }
  }
});

let editingMember = null;
function updateMemberPreview() {
  const box = $("member-photo-preview");
  box.innerHTML = photoHtml($("member-photo").value.trim(), $("member-name").value || "?");
  box.querySelector("img")?.addEventListener("error", () => {
    box.textContent = initials($("member-name").value || "?");
    $("member-status").innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>That photo link doesn't load. Use a direct image link (for GitHub, the "raw.githubusercontent.com" address).</div></div>`;
  });
}
function openMemberEditor(m) {
  editingMember = m ? m.id : null;
  $("member-editor-title").textContent = m ? `Edit ${m.name}` : "Add member";
  $("member-name").value = m?.name || "";
  $("member-role").value = m?.role || "";
  $("member-photo").value = m?.photo || "";
  $("member-bio").value = m?.bio || "";
  $("member-order").value = m?.order ?? (members.length + 1);
  $("member-published").checked = m ? !!m.published : true;
  $("member-status").innerHTML = "";
  updateMemberPreview();
  openModal("member-modal");
  $("member-name").focus();
}
$("new-member").addEventListener("click", () => openMemberEditor(null));
$("member-photo").addEventListener("input", () => { $("member-status").innerHTML = ""; updateMemberPreview(); });
$("member-name").addEventListener("input", () => { if (!safeImage($("member-photo").value.trim())) updateMemberPreview(); });

$("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("member-name").value.trim();
  const photo = $("member-photo").value.trim();
  const fail = (msg) => { $("member-status").innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><div>${esc(msg)}</div></div>`; };
  if (!name) return fail("Please enter a name.");
  if (photo && !safeImage(photo)) return fail("The photo link must start with https:// (and have no spaces).");
  const data = {
    name,
    role: $("member-role").value.trim(),
    photo,
    bio: $("member-bio").value.trim(),
    order: Number($("member-order").value) || 0,
    published: $("member-published").checked,
    updated_ms: Date.now(),
  };
  $("save-member").disabled = true;
  try {
    if (editingMember) await updateDoc(doc(db, COLLECTIONS.team, editingMember), data);
    else {
      const id = slugify(name) || `member-${Date.now()}`;
      const exists = (await getDoc(doc(db, COLLECTIONS.team, id))).exists();
      await setDoc(doc(db, COLLECTIONS.team, exists ? `${id}-${Date.now().toString(36)}` : id), { ...data, created_ms: Date.now() });
    }
    toast("Saved", "success");
    $("member-modal").classList.remove("open");
  } catch (err) {
    console.error(err);
    fail("Save failed. Check that the latest security rules are published.");
  } finally {
    $("save-member").disabled = false;
  }
});

/* ── Website content ────────────────────────────────────────── */
// Each page's text lives in site_content/{id}; the footer is shared by every page.
const CONTENT_PAGES = [
  { id: "home",    label: "Home",          url: "/" },
  { id: "about",   label: "About",         url: "/about" },
  { id: "volunteers", label: "Volunteers",  url: "/volunteers" },
  { id: "blog",    label: "Blog",          url: "/blog" },
  { id: "report",  label: "Report a Fire", url: "/report" },
  { id: "donate",  label: "Donate",        url: "/donate" },
  { id: "footer",  label: "Footer",        url: "/" },
];
const KIND_LABELS = {
  title: "Heading", heading: "Title", text: "Text", item: "List item", button: "Button", label: "Label",
  number: "Number", caption: "Caption", role: "Role", initials: "Initials",
  about: "About text", col: "Column heading", tagline: "Tagline", quote: "Quote", quoteby: "Said by",
};

const content = {
  page: null,           // current CONTENT_PAGES entry
  saved: {},            // key -> saved value (from Firestore)
  savedDoc: {},         // the whole saved document
  drafts: {},           // key -> value typed in the form ("" = back to the original)
  elements: new Map(),  // key -> element in the preview frame
  frameReady: false,
  view: "desktop",
  sanitize: null,
};

/** Value to store for a field: null means "use the original text". */
function storedValue(key) {
  const el = content.elements.get(key);
  const v = (content.drafts[key] ?? content.saved[key] ?? "").trim();
  return !v || v === el?.firoDefault ? null : v;
}
const contentDirty = () => [...content.elements.keys()].some((k) => storedValue(k) !== (content.saved[k] ?? null));

function confirmLeaveContent() {
  return !contentDirty() || confirm("You have unsaved changes to the website text. Leave without saving?");
}
window.addEventListener("beforeunload", (e) => { if (contentDirty()) { e.preventDefault(); e.returnValue = ""; } });

function renderPagePills() {
  const dirty = contentDirty();
  $("content-pages").innerHTML = CONTENT_PAGES.map((p) => `
    <button type="button" class="page-pill ${p === content.page ? "active" : ""}" data-page="${p.id}" role="tab"
      aria-selected="${p === content.page}">${esc(p.label)}${p === content.page && dirty ? '<span class="dot" title="Unsaved changes"></span>' : ""}</button>`).join("");
}
$("content-pages").addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b || b.dataset.page === content.page?.id || !confirmLeaveContent()) return;
  openContentPage(CONTENT_PAGES.find((p) => p.id === b.dataset.page));
});

function fieldLabel(key) {
  const m = key.match(/^(?:s\d+-)?([a-z]+?)(\d*)$/);
  const kind = m ? m[1] : key;
  return `${KIND_LABELS[kind] || "Text"}${m && m[2] && kind !== "col" ? ` ${m[2]}` : ""}`;
}

const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent.trim(); };
const frameDoc = () => $("content-frame").contentDocument;
// The footer's fields belong to the "footer" document; everything else to the page
const belongsTo = (el, page) => docIdFor(el, page.id === "footer" ? "__page" : page.id) === page.id;

async function openContentPage(page) {
  content.page = page;
  content.drafts = {};
  content.elements = new Map();
  content.frameReady = false;
  content.savedDoc = {};
  content.saved = {};
  renderPagePills();
  updateContentBar();
  $("content-open").href = page.url;
  $("content-fields").innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  $("frame-loading").hidden = false;

  const [snap] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.content, page.id)).catch((err) => { console.error(err); return null; }),
    loadFrame(page.url),
  ]);
  if (content.page !== page) return;   // another page was chosen meanwhile
  content.savedDoc = snap?.exists() ? snap.data() : {};
  content.saved = {};
  for (const [k, v] of Object.entries(content.savedDoc.fields || {})) if (typeof v === "string" && v.trim()) content.saved[k] = v;
  renderContentFields();
  updateContentBar();
  previewDrafts();
}

function loadFrame(url) {
  const frame = $("content-frame");
  return new Promise((resolve) => {
    frame.onload = async () => {
      const win = frame.contentWindow;
      for (let i = 0; i < 80 && !win.__firoContent; i++) await new Promise((r) => setTimeout(r, 100));
      try { await win.__firoContent; } catch {}
      content.frameReady = true;
      $("frame-loading").hidden = true;
      // Show every section straight away (the page fades them in while scrolling)
      win.document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
      const style = win.document.createElement("style");
      style.textContent = ".firo-edit-focus{outline:2px dashed #f47a1f!important;outline-offset:4px;border-radius:4px;}";
      win.document.head.appendChild(style);
      resolve();
    };
    frame.src = `${url}${url.includes("?") ? "&" : "?"}preview=${Date.now()}`;
    sizeFrame();
  });
}

function sizeFrame() {
  const box = $("frame-box"), frame = $("content-frame");
  if (!box.clientWidth) return;
  const width = content.view === "mobile" ? 390 : 1280;
  const scale = Math.min(1, box.clientWidth / width);
  frame.style.width = `${width}px`;
  frame.style.height = `${box.clientHeight / scale}px`;
  frame.style.transform = `scale(${scale})`;
  frame.style.left = `${Math.max(0, (box.clientWidth - width * scale) / 2)}px`;
}
window.addEventListener("resize", sizeFrame);
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  content.view = b.dataset.view;
  document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("on", x === b));
  sizeFrame();
}));

function renderContentFields() {
  const page = content.page;
  const fdoc = frameDoc();
  const groups = [];
  for (const el of editableElements(fdoc).filter((x) => belongsTo(x, page))) {
    content.elements.set(el.dataset.edit, el);
    const section = el.closest("#site-footer") || el.closest("section") || fdoc.body;
    let g = groups.find((x) => x.section === section);
    if (!g) {
      const head = [...section.querySelectorAll("[data-edit]")].find((x) => /^H[12]$/.test(x.tagName));
      const title = page.id === "footer" ? "Footer (every page)" : section.dataset?.editGroup || (head ? plain(head.firoDefault) : `Section ${groups.length + 1}`);
      g = { section, title, els: [] };
      groups.push(g);
    }
    g.els.push(el);
  }

  $("content-fields").innerHTML = groups.map((g) => `
    <div class="content-group">
      <h3>${esc(g.title)}</h3>
      ${g.els.map((el) => {
        const key = el.dataset.edit;
        const value = content.saved[key] ?? el.firoDefault;
        const hidden = !el.getClientRects().length;
        return `
        <div class="cfield" data-key="${esc(key)}">
          <div class="cfield-head">
            <label for="cf-${esc(key)}">${esc(fieldLabel(key))}</label>
            ${hidden ? `<span class="note">(shown only in some situations)</span>` : ""}
            <span class="edited" hidden>Edited</span>
            <button type="button" data-reset="${esc(key)}" hidden>Reset</button>
          </div>
          <textarea class="textarea" id="cf-${esc(key)}" data-field="${esc(key)}" rows="1">${esc(value)}</textarea>
          ${el.firoMode === "html" ? `<span class="hint">Formatting allowed: &lt;strong&gt;bold&lt;/strong&gt;, &lt;em&gt;italic&lt;/em&gt;, &lt;a href="…"&gt;link&lt;/a&gt;, &lt;br&gt;</span>` : ""}
        </div>`;
      }).join("")}
    </div>`).join("") || `<div class="empty">No editable text on this page.</div>`;
  for (const key of content.elements.keys()) markField(key);
  $("content-fields").querySelectorAll("textarea[data-field]").forEach(autosize);
}

/** Grow a text box to fit its text. */
function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

async function previewDrafts() {
  if (!content.frameReady || !content.elements.size) return;
  const values = {};
  const els = [...content.elements.values()];
  if (!content.sanitize && els.some((el) => el.firoMode === "html")) content.sanitize = await loadSanitizer();
  for (const [key, el] of content.elements) {
    const v = storedValue(key);
    if (v != null) values[key] = el.firoMode === "html" ? content.sanitize(v) : v;
  }
  const pageId = content.page.id === "footer" ? "__page" : content.page.id;
  applyContent({ [content.page.id]: values }, pageId, frameDoc(), new Set(els));
}

function updateContentBar() {
  const dirty = contentDirty();
  $("content-save").disabled = !dirty;
  $("content-discard").disabled = !dirty;
  const d = content.savedDoc || {};
  $("content-status").textContent = dirty ? "Unsaved changes"
    : d.updated_ms && d.fields ? `Last saved ${timeText(d.updated_ms)}${d.updated_by ? ` by ${d.updated_by}` : ""}` : "";
  renderPagePills();
}

function markField(key) {
  const f = document.querySelector(`.cfield[data-key="${CSS.escape(key)}"]`);
  if (!f) return;
  const edited = storedValue(key) != null;
  f.querySelector(".edited").hidden = !edited;
  f.querySelector("[data-reset]").hidden = !edited;
}

$("content-fields").addEventListener("input", (e) => {
  const key = e.target.dataset.field;
  if (!key) return;
  content.drafts[key] = e.target.value;
  autosize(e.target);
  markField(key);
  updateContentBar();
  previewDrafts();
});

$("content-fields").addEventListener("focusin", (e) => {
  const el = content.elements.get(e.target.dataset.field);
  if (!el) return;
  frameDoc().querySelectorAll(".firo-edit-focus").forEach((x) => x.classList.remove("firo-edit-focus"));
  el.classList.add("firo-edit-focus");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
});

$("content-fields").addEventListener("click", (e) => {
  const b = e.target.closest("[data-reset]");
  if (!b) return;
  const key = b.dataset.reset;
  const ta = $(`cf-${key}`);
  ta.value = content.elements.get(key).firoDefault;
  autosize(ta);
  content.drafts[key] = "";
  markField(key);
  updateContentBar();
  previewDrafts();
  ta.focus();
});

$("content-discard").addEventListener("click", () => {
  if (!confirm("Discard your unsaved changes?")) return;
  content.drafts = {};
  renderContentFields();
  updateContentBar();
  previewDrafts();
});

$("content-save").addEventListener("click", async () => {
  const fields = {};
  if (!content.sanitize) content.sanitize = await loadSanitizer();
  for (const [key, el] of content.elements) {
    const v = storedValue(key);
    if (v != null) fields[key] = el.firoMode === "html" ? content.sanitize(v) : v;
  }
  const data = { fields, updated_ms: Date.now(), updated_by: user.email || user.uid };
  if (content.savedDoc.posts_managed) data.posts_managed = true;
  $("content-save").disabled = true;
  try {
    await setDoc(doc(db, COLLECTIONS.content, content.page.id), data);
    content.savedDoc = data;
    content.saved = { ...fields };
    content.drafts = {};
    renderContentFields();
    updateContentBar();
    toast("Website updated", "success");
  } catch (err) {
    console.error(err);
    toast("Save failed. Check that the latest security rules are published.", "error", 8000);
    updateContentBar();
  }
});

tabHooks.content = () => {
  if (!content.page) openContentPage(CONTENT_PAGES[0]);
  else sizeFrame();
};

/* ── Team (control-room staff) ─────────────────────────────── */
let requests = [];
onSnapshot(collection(db, COLLECTIONS.staff), (snap) => {
  const staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (b.added_ms || 0) - (a.added_ms || 0));
  $("staff-rows").innerHTML = staff.map((m) => `
    <tr>
      <td><strong>${esc(m.email || m.name || "—")}</strong></td>
      <td class="text-muted" style="font-family:ui-monospace,Consolas,monospace;font-size:.85rem;">${esc(m.uid)}</td>
      <td class="text-dim">${esc(formatDate(m.added_ms))}</td>
      <td style="text-align:right;"><button class="btn btn-sm btn-danger" data-remove-staff="${esc(m.uid)}"><i class="fa-solid fa-user-minus"></i> Remove</button></td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No staff yet. Admins already have full access.</td></tr>`;
}, listenerError("team"));

onSnapshot(collection(db, COLLECTIONS.requests), (snap) => {
  requests = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (b.requested_ms || 0) - (a.requested_ms || 0));
  setBadge("count-requests", requests.length);
  $("request-rows").innerHTML = requests.map((r) => `
    <tr>
      <td><strong>${esc(r.email || "—")}</strong><br /><span class="text-muted" style="font-family:ui-monospace,Consolas,monospace;font-size:.8rem;">${esc(r.uid)}</span></td>
      <td class="text-dim">${esc(timeText(r.requested_ms))}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-leaf" data-approve="${esc(r.uid)}"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-sm btn-danger" data-decline="${esc(r.uid)}"><i class="fa-solid fa-xmark"></i> Decline</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="3" class="empty">No pending requests.</td></tr>`;
}, listenerError("access requests"));

$("request-rows").addEventListener("click", async (e) => {
  const ok = e.target.closest("[data-approve]"), no = e.target.closest("[data-decline]");
  const uid = ok?.dataset.approve || no?.dataset.decline;
  if (!uid) return;
  const r = requests.find((x) => x.uid === uid) || {};
  if (no && !confirm(`Decline the request from ${r.email || uid}?`)) return;
  try {
    const batch = writeBatch(db);
    if (ok) batch.set(doc(db, COLLECTIONS.staff, uid), { email: r.email || "", added_ms: Date.now(), added_by: user.email || user.uid });
    batch.delete(doc(db, COLLECTIONS.requests, uid));
    await batch.commit();
    toast(ok ? `${r.email || "User"} can now use the control room` : "Request declined", "success");
  } catch (err) { console.error(err); toast("Could not update the request. Check the security rules are published.", "error"); }
});

$("staff-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = $("staff-uid").value.trim();
  const label = $("staff-email").value.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return toast("That doesn't look like a user ID.", "error");
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

/* ── Start on the last tab used ─────────────────────────────── */
let startTab = "messages";
try { startTab = sessionStorage.getItem("firo_admin_tab") || "messages"; } catch {}
openTab(startTab);
