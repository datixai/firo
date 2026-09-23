/**
 * blog.js
 * ─────────────────────────────────────────────────────────────
 * Read blog posts for the public website.
 * Posts live in Firestore (blog_posts, doc id = slug). While the
 * collection is empty or unreachable, the starter posts are shown.
 * ─────────────────────────────────────────────────────────────
 */

import { COLLECTIONS } from "/js/firebase-init.js";
import { STARTER_POSTS } from "/js/blog-data.js";
import { collection, query, where, getDocs, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const byNewest = (a, b) => (b.published_at || 0) - (a.published_at || 0);

/** All published posts, newest first. */
export async function loadPublishedPosts(db) {
  if (db) {
    try {
      const q = query(collection(db, COLLECTIONS.posts), where("published", "==", true));
      const snap = await getDocs(q);
      if (!snap.empty) return snap.docs.map((d) => ({ slug: d.id, ...d.data() })).sort(byNewest);
    } catch (err) {
      console.warn("[FIRO] Could not load blog posts from Firestore, showing starter posts.", err);
    }
  }
  return [...STARTER_POSTS].sort(byNewest);
}

/** One published post by slug, or null. */
export async function loadPost(db, slug) {
  if (!slug) return null;
  if (db) {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.posts, slug));
      if (snap.exists() && snap.data().published) return { slug: snap.id, ...snap.data() };
    } catch (err) {
      // Firestore denies reading drafts / missing docs; fall back to starter posts
      console.warn("[FIRO] Could not load post from Firestore.", err);
    }
  }
  return STARTER_POSTS.find((p) => p.slug === slug) || null;
}

/** Rough reading time in minutes. */
export function readingTime(markdown) {
  const words = String(markdown || "").trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
