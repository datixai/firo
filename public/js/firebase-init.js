/**
 * firebase-init.js
 * ─────────────────────────────────────────────────────────────
 * Single source of Firebase initialisation for ALL dashboard pages.
 *
 * Config is fetched at runtime from /api/config:
 *   • on Vercel      → api/config.py serverless function (env vars)
 *   • locally        → scripts/dev_server.py (same code)
 *
 * Usage in any HTML page (type="module"):
 *
 *   import { initFirebase, fireLogsPath } from "/js/firebase-init.js";
 *   const { app, auth, db, config, settings } = await initFirebase();
 *   const logs = collection(db, ...fireLogsPath(config));
 * ─────────────────────────────────────────────────────────────
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously }
                          from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const CONFIG_ENDPOINT = "/api/config";

// Firestore collection written by the Raspberry Pi
export const FIRE_LOGS_COLLECTION = "fire_logs";

// Website collections (top-level)
export const COLLECTIONS = {
  reports:  "reports",           // public fire incident reports
  messages: "contact_messages",  // contact form messages
  posts:    "blog_posts",        // blog articles (doc id = slug)
  admins:   "admins",            // doc id = admin user's UID
};

// ─────────────────────────────────────────────────────────────
let _firebaseApp   = null;
let _configCache   = null;

/**
 * Fetch runtime config from /api/config.
 * Result is cached so only one network request is ever made.
 */
async function fetchConfig() {
  if (_configCache) return _configCache;

  const res = await fetch(CONFIG_ENDPOINT, { cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(
      `[FIRO] Could not load config from ${CONFIG_ENDPOINT} — HTTP ${res.status}. ${detail}`
    );
  }

  _configCache = await res.json();
  return _configCache;
}

/**
 * Initialize Firebase once and return shared instances.
 * Safe to call multiple times — returns the same instances.
 *
 * @returns {{ app, auth, db, config, settings }}
 *   config   → Firebase web config (includes projectId)
 *   settings → dashboard settings (e.g. whatsappNumber)
 */
export async function initFirebase() {
  const { firebase: config, ...settings } = await fetchConfig();

  if (!_firebaseApp) {
    _firebaseApp = initializeApp(config);
  }

  return {
    app:  _firebaseApp,
    auth: getAuth(_firebaseApp),
    db:   getFirestore(_firebaseApp),
    config,
    settings,
  };
}

/** Path segments of the fire_logs collection: artifacts/{projectId}/public/data/fire_logs */
export function fireLogsPath(config) {
  return ["artifacts", config.projectId, "public", "data", FIRE_LOGS_COLLECTION];
}

/**
 * Resolve with the current user, signing in anonymously if nobody is
 * signed in. Used by public pages (logs, report, contact) so visitors
 * can read/write without an account, without replacing a logged-in
 * officer's session.
 */
export function ensureUser(auth) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) return resolve(user);
      try { resolve((await signInAnonymously(auth)).user); }
      catch (err) { reject(err); }
    });
  });
}
