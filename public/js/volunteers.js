/**
 * volunteers.js
 * ─────────────────────────────────────────────────────────────
 * Featured volunteers on /volunteers. Profiles live in Firestore
 * ("volunteers", managed in Admin → Volunteers). Until the admin
 * panel has taken over the list (site_content/volunteers has
 * profiles_managed: true), or when Firestore is unreachable, the
 * built-in profiles below are shown.
 * ─────────────────────────────────────────────────────────────
 */

import { COLLECTIONS } from "/js/firebase-init.js";
import { collection, query, where, getDocs, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const REGIONS = {
  ajk:      "Azad Jammu & Kashmir",
  pakistan: "Pakistan",
  world:    "World",
};

// Teacher Usman starts hidden: add his story in the admin panel, then publish.
export const STARTER_VOLUNTEERS = [
  {
    id: "teacher-usman",
    name: "Teacher Usman",
    region: "ajk",
    role: "Teacher and forest volunteer",
    story: "",
    link: "",
    photo: "",
    published: false,
    order: 1,
  },
  {
    id: "wangari-maathai",
    name: "Wangari Maathai",
    region: "world",
    role: "Founder of the Green Belt Movement, Kenya",
    story: "In 1977 she started the Green Belt Movement, which brought together women across Kenya to plant tens of millions of trees. In 2004 she became the first African woman to receive the Nobel Peace Prize.",
    link: "https://www.greenbeltmovement.org/",
    photo: "",
    published: true,
    order: 2,
  },
  {
    id: "jadav-payeng",
    name: "Jadav Payeng",
    region: "world",
    role: "The Forest Man of India",
    story: "Since 1979 he has planted trees, one by one, on a barren sandbar of the Brahmaputra river in Assam. It has grown into a forest of more than 500 hectares that is home to elephants, deer and tigers. He received the Padma Shri in 2015.",
    link: "",
    photo: "",
    published: true,
    order: 3,
  },
];

const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name));

/** Published featured volunteers, in display order. */
export async function loadVolunteers(db) {
  if (db) {
    try {
      const snap = await getDocs(query(collection(db, COLLECTIONS.volunteers), where("published", "==", true)));
      if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
      const managed = await getDoc(doc(db, COLLECTIONS.content, "volunteers"));
      if (managed.exists() && managed.data().profiles_managed === true) return [];
    } catch (err) {
      console.warn("[FIRO] Could not load volunteers, showing the built-in list.", err);
    }
  }
  return STARTER_VOLUNTEERS.filter((v) => v.published).sort(byOrder);
}

/** The volunteers' WhatsApp group link, if the admin chose to show it publicly. */
export async function loadPublicGroupLink(db) {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.volunteerSettings, "group"));
    const d = snap.exists() ? snap.data() : {};
    return d.public && /^https:\/\/chat\.whatsapp\.com\//.test(d.link || "") ? d.link : "";
  } catch {
    return "";   // not public (the rules deny reading it) or not set
  }
}

export const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
