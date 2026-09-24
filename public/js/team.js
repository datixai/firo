/**
 * team.js
 * ─────────────────────────────────────────────────────────────
 * "The people behind FIRO" on /about. Members live in Firestore
 * ("team_members", managed in Admin → Our team). Until the admin
 * panel has taken over the list (site_content/about has
 * team_managed: true), or when Firestore is unreachable, the
 * built-in members below are shown.
 * ─────────────────────────────────────────────────────────────
 */

import { COLLECTIONS } from "/js/firebase-init.js";
import { collection, query, where, getDocs, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const ASSETS = "https://raw.githubusercontent.com/datixai/datixaiweb-assets/main/datixaiwebassests";

export const STARTER_TEAM = [
  {
    id: "ahmed-ali",
    name: "Ahmed Ali",
    role: "Founder & CEO",
    bio: "Ahmed is dedicated to building intelligent systems that do more than just process information: they empower innovation. Under his leadership, Datix AI bridges the gap between complex data analysis and tangible business impact, ensuring every solution is built for scale and long-term success.",
    photo: `${ASSETS}/Ahmed%20Ali.jpeg`,
    published: true,
    order: 1,
  },
  {
    id: "nabeel-ali",
    name: "Nabeel Ali",
    role: "Founding Advisor & Mentor",
    bio: "A specialist in Embedded Systems and Computer Architecture with over a decade of research and teaching experience at the University of Kotli. As the intellectual catalyst behind Datix AI, his guidance in hardware-software integration and system logic remains the cornerstone of the startup's technical strategy.",
    photo: `${ASSETS}/Nabeel%20Ali.jpg`,
    published: true,
    order: 2,
  },
  {
    id: "seher-ishtiaq",
    name: "Seher Ishtiaq",
    role: "Social Media Manager",
    bio: "Seher is a social media strategist with an audience of 250K YouTube subscribers and 70K TikTok followers, driving real growth and engagement for Datix AI's digital presence.",
    photo: `${ASSETS}/seherpic.jpg`,
    published: true,
    order: 3,
  },
];

const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name));

/** Published team members, in display order. */
export async function loadTeam(db) {
  if (db) {
    try {
      const snap = await getDocs(query(collection(db, COLLECTIONS.team), where("published", "==", true)));
      if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
      const managed = await getDoc(doc(db, COLLECTIONS.content, "about"));
      if (managed.exists() && managed.data().team_managed === true) return [];
    } catch (err) {
      console.warn("[FIRO] Could not load the team, showing the built-in list.", err);
    }
  }
  return STARTER_TEAM.filter((m) => m.published).sort(byOrder);
}

/** Only https image links are used for photos. */
export const safeImage = (url) => (/^https:\/\/\S+$/i.test(url || "") ? url : "");
