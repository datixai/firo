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
  jk:       "Jammu & Kashmir",
  ladakh:   "Ladakh",
  gb:       "Gilgit-Baltistan",
  pakistan: "Pakistan",
  world:    "World",
};

/**
 * Built-in profiles. The admin panel copies them into Firestore once, then
 * adds any new ones and updates ones nobody has edited there.
 * rev: bump when a profile's text changes.
 */
export const STARTER_VOLUNTEERS = [
  {
    id: "teacher-usman",
    rev: 2,
    name: "Teacher Usman",
    region: "ajk",
    role: "Usman Abbasi, teacher and climate activist from Kotli",
    story: "A schoolteacher from Kotli who began about ten years ago by planting trees and putting up dustbins in his neighbourhood. As springs dried up and forests thinned, he turned to rainwater harvesting and has since built wells, ponds and small dams across Azad Kashmir and Pakistan, many paid for by his YouTube channel. He also teaches people how to prevent forest fires and gives away tree saplings.",
    link: "https://www.arabnews.pk/node/2611103/pakistan",
    photo: "",
    published: true,
    order: 1,
  },
  {
    id: "bilal-ahmad-dar",
    rev: 1,
    name: "Bilal Ahmad Dar",
    region: "jk",
    role: "The boy who cleaned Wular Lake, Bandipora",
    story: "As a child he spent his days collecting plastic and waste from Wular Lake, one of the largest freshwater lakes in Asia. A video of his work went viral in 2017 and Srinagar Municipal Corporation made him its brand ambassador for a cleaner city.",
    link: "https://yourstory.com/2017/07/wular-lake-trash-bilal-dar",
    photo: "",
    published: true,
    order: 2,
  },
  {
    id: "sonam-wangchuk",
    rev: 1,
    name: "Sonam Wangchuk",
    region: "ladakh",
    role: "Engineer, educator and inventor of the Ice Stupa",
    story: "In 1988 he co-founded SECMOL to give Ladakhi students practical, hands-on schooling. In 2013 he built the first Ice Stupa, a cone-shaped artificial glacier that stores winter water and releases it in spring when farmers need it most. The idea has since spread across the Himalaya, including Gilgit-Baltistan. He received the Ramon Magsaysay Award in 2018.",
    link: "https://en.wikipedia.org/wiki/Sonam_Wangchuk_(engineer)",
    photo: "",
    published: true,
    order: 3,
  },
  {
    id: "aisha-khan",
    rev: 1,
    name: "Aisha Khan",
    region: "gb",
    role: "Founder of the Mountain and Glacier Protection Organization",
    story: "After trekking in the Karakoram in 2001 she founded MGPO. It began by cleaning the trails and campsites on the route to K2 and grew into work with mountain communities across Gilgit-Baltistan on climate resilience and glacier protection. She received Stanford's Bright Award in 2019.",
    link: "https://mgpo.org/",
    photo: "",
    published: true,
    order: 4,
  },
  {
    id: "mohammad-raza",
    rev: 1,
    name: "Mohammad Raza",
    region: "gb",
    role: "Built an Ice Stupa near Skardu",
    story: "An agriculture officer in Skardu who saw videos of the Ice Stupas of Ladakh and, in 2022, built one with his fellow villagers in Hussainabad. The ice melts slowly in spring and waters the village fields when the streams are still low.",
    link: "",
    photo: "",
    published: true,
    order: 5,
  },
  {
    id: "wangari-maathai",
    rev: 2,
    name: "Wangari Maathai",
    region: "world",
    role: "Founder of the Green Belt Movement, Kenya",
    story: "In 1977 she started the Green Belt Movement, which brought together women across Kenya to plant tens of millions of trees. In 2004 she became the first African woman to receive the Nobel Peace Prize.",
    link: "https://www.greenbeltmovement.org/",
    photo: "",
    published: true,
    order: 6,
  },
  {
    id: "jadav-payeng",
    rev: 2,
    name: "Jadav Payeng",
    region: "world",
    role: "The Forest Man of India",
    story: "Since 1979 he has planted trees, one by one, on a barren sandbar of the Brahmaputra river in Assam. It has grown into a forest of more than 500 hectares that is home to elephants, deer and tigers. He received the Padma Shri in 2015.",
    link: "",
    photo: "",
    published: true,
    order: 7,
  },
];

/** Built-in profiles that existed before new ones could be added automatically. */
export const FIRST_STARTERS = ["teacher-usman", "wangari-maathai", "jadav-payeng"];

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
