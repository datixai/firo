/**
 * content.js — editable website text
 * ─────────────────────────────────────────────────────────────
 * Elements marked  data-edit="key"  in the public pages can be
 * changed from Admin → Website content. Changes are stored in
 * Firestore:  site_content/{page}  →  { fields: { key: value } }
 * (page = home | about | blog | report | contact | footer).
 *
 * Only changed fields are stored; everything else keeps the text
 * written in the HTML. The last content seen is cached in the
 * browser so repeat visits show it without a flash.
 *
 * Two kinds of field:
 *   text  plain text (icons inside the element are kept)
 *   html  text with simple formatting (bold, italic, links),
 *         sanitised before it is shown
 * ─────────────────────────────────────────────────────────────
 */

import { initFirebase, COLLECTIONS } from "/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const CONTENT_COLLECTION = COLLECTIONS.content;
const CACHE_KEY = "firo_site_content_v1";
const PURIFY_URL = "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs";
const ALLOWED = { ALLOWED_TAGS: ["strong", "b", "em", "i", "span", "a", "br", "small", "code"], ALLOWED_ATTR: ["href", "class", "target", "rel"] };

/** Which content document an element belongs to. */
export function docIdFor(el, page) {
  return el.closest("#site-footer") ? "footer" : page;
}

export function editableElements(root = document) {
  return [...root.querySelectorAll("[data-edit]")];
}

const textNodes = (el) => [...el.childNodes].filter((n) => n.nodeType === 3);
const clean = (s) => s.replace(/\s+/g, " ").trim();

/** Record the original text of each element (once), before anything changes it. */
export function rememberDefaults(root = document) {
  for (const el of editableElements(root)) {
    if (el.firoMode) continue;
    const onlyIcons = [...el.children].every((c) => c.tagName === "I");
    el.firoMode = onlyIcons ? "text" : "html";
    el.firoDefault = onlyIcons ? clean(textNodes(el).map((n) => n.textContent).join(" ")) : clean(el.innerHTML);
  }
}

let purify = null;
export async function loadSanitizer() {
  if (!purify) purify = (await import(PURIFY_URL)).default;
  return (html) => purify.sanitize(html, ALLOWED);
}

function setText(el, value) {
  const nodes = textNodes(el).filter((n) => n.textContent.trim());
  const hasIcon = el.children.length > 0;
  const text = hasIcon ? ` ${value} ` : value;
  if (nodes.length) {
    nodes[0].textContent = text;
    nodes.slice(1).forEach((n) => { n.textContent = " "; });
  } else {
    el.appendChild(el.ownerDocument.createTextNode(text));
  }
}

/**
 * Show values on the page. values = { home: { key: value }, footer: { … } }.
 * html values must already be sanitised. Fields without a value go back to the default.
 * only: optional Set of elements to update (the admin preview updates one page's fields).
 */
export function applyContent(values, page, root = document, only = null) {
  rememberDefaults(root);
  for (const el of editableElements(root)) {
    if (only && !only.has(el)) continue;
    const v = values?.[docIdFor(el, page)]?.[el.dataset.edit];
    const value = typeof v === "string" && v.trim() ? v : el.firoDefault;
    if (el.firoMode === "text") setText(el, value);
    else if (clean(el.innerHTML) !== value) el.innerHTML = value;
  }
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeCache(update) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...update })); } catch {}
}

/** Read one content document: { fields, …}  (empty object if missing or unreadable). */
export async function fetchContentDoc(db, id) {
  try {
    const snap = await getDoc(doc(db, CONTENT_COLLECTION, id));
    return snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn(`[FIRO] Could not load site content "${id}":`, err);
    return null;
  }
}

/** Sanitise the html-mode fields of one document for the elements on this page. */
async function sanitizeFields(fields, id, page, root) {
  const out = {};
  const htmlKeys = new Set(editableElements(root)
    .filter((el) => el.firoMode === "html" && docIdFor(el, page) === id).map((el) => el.dataset.edit));
  const sanitize = [...htmlKeys].some((k) => fields[k]) ? await loadSanitizer() : null;
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v !== "string") continue;
    out[k] = htmlKeys.has(k) ? sanitize(v) : v;
  }
  return out;
}

/**
 * Public pages: apply saved text for this page and the footer.
 * Resolves when the latest content is on the page.
 */
export async function loadSiteContent(page) {
  rememberDefaults();
  const ids = [...new Set(editableElements().map((el) => docIdFor(el, page)))];
  if (!ids.length) return;
  applyContent(readCache(), page);

  let db;
  try { ({ db } = await initFirebase()); } catch { return; }
  const docs = await Promise.all(ids.map((id) => fetchContentDoc(db, id)));
  const values = {};
  for (let i = 0; i < ids.length; i++) {
    if (docs[i] === null) continue;          // offline: keep the cached text
    values[ids[i]] = await sanitizeFields(docs[i].fields, ids[i], page, document);
  }
  applyContent({ ...readCache(), ...values }, page);
  writeCache(values);
}
