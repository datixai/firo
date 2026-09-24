/**
 * admin.js — FIRO admin panel (/admin)
 * ─────────────────────────────────────────────────────────────
 * Access: signed-in user whose UID has a document in the
 * "admins" collection. Firestore rules enforce the same check
 * (see firestore.rules), so hiding the page is not the only guard.
 *
 * Tabs: contact messages · blog posts · website content (text on
 * the public pages) · control-room team. Fire reports are handled
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
    missing.forEach((p) => batch.set(doc(db, COLLECTIONS.posts, p.slug), { ...p, updated_ms: Date.now() }));
    batch.set(ref, { posts_managed: true, updated_ms: Date.now(), updated_by: user.email || user.uid }, { merge: true });
    await batch.commit();
    if (missing.length) toast(`The ${missing.length} built-in articles are now listed in Blog, so you can edit or delete them.`, "info", 7000);
  } catch (err) {
    console.error("[FIRO] Could not set up blog management:", err);
  }
}

function renderPosts() {
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

/* ── Website content ────────────────────────────────────────── */
// Each page's text lives in site_content/{id}; the footer is shared by every page.
const CONTENT_PAGES = [
  { id: "home",    label: "Home",          url: "/" },
  { id: "about",   label: "About",         url: "/about" },
  { id: "blog",    label: "Blog",          url: "/blog" },
  { id: "report",  label: "Report a Fire", url: "/report" },
  { id: "contact", label: "Contact",       url: "/contact" },
  { id: "footer",  label: "Footer",        url: "/" },
];
const KIND_LABELS = {
  title: "Heading", heading: "Title", text: "Text", item: "List item", button: "Button", label: "Label",
  number: "Number", caption: "Caption", role: "Role", initials: "Initials",
  about: "About text", col: "Column heading", tagline: "Tagline",
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
      g = { section, title: page.id === "footer" ? "Footer (every page)" : head ? plain(head.firoDefault) : `Section ${groups.length + 1}`, els: [] };
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
