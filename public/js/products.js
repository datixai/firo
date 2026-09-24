/**
 * products.js
 * ─────────────────────────────────────────────────────────────
 * Products on /products and /products/<slug>. Products live in
 * Firestore ("products", doc id = slug, managed in Admin → Products).
 * Until the admin panel has taken over the list (site_content/products
 * has products_managed: true), or when Firestore is unreachable, the
 * built-in products below are shown.
 *
 * "Buy on WhatsApp" opens a chat with SALES_WHATSAPP and a message
 * that already contains the product's details.
 * ─────────────────────────────────────────────────────────────
 */

import { COLLECTIONS } from "/js/firebase-init.js";
import { collection, query, where, getDocs, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/** Sales WhatsApp number, international format without "+". */
export const SALES_WHATSAPP = "923408226347";

/** kind: "software" or "hardware" (used for the Software / Hardware filter). */
export const PRODUCT_CATEGORIES = {
  model:     { label: "AI models",              kind: "software", icon: "fa-brain" },
  software:  { label: "Detection software",     kind: "software", icon: "fa-code" },
  dashboard: { label: "Dashboards",             kind: "software", icon: "fa-chart-line" },
  hardware:  { label: "Hardware",               kind: "hardware", icon: "fa-microchip" },
  config:    { label: "Hardware configuration", kind: "hardware", icon: "fa-screwdriver-wrench" },
};

export const categoryOf = (p) => PRODUCT_CATEGORIES[p?.category] || PRODUCT_CATEGORIES.software;

/** Only https links or images uploaded in the admin panel. */
export const safePhoto = (url) =>
  (/^https:\/\/\S+$/i.test(url || "") || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url || "") ? url : "");

/** All photos of a product (main photo first), without empty or unsafe ones. */
export const photosOf = (p) => [p.photo, ...(p.gallery || [])].map(safePhoto).filter(Boolean);

export const STARTER_PRODUCTS = [
  {
    slug: "firo-edge-fire-camera",
    name: "FIRO Edge Fire Detection Camera",
    category: "hardware",
    summary: "A forest camera with on-device AI that spots smoke and fire on-site and sends an alert in seconds, even where the internet is weak.",
    description: `The FIRO Edge Fire Detection Camera watches a stretch of forest around the clock and checks every frame with an AI model that runs **on the device itself**. When it sees fire or smoke it sends an alert with a photo, the time and the camera's location to your control room and phones.

Because the AI runs on-site, the camera only needs a small amount of data to send an alert, so it works in remote valleys with weak mobile signal.

### Who it is for
- Forest and wildlife departments
- National parks, reserves and private forests
- Communities and NGOs protecting forests near villages
- Farms, plantations and orchards at risk from wildfire

### What you get
- Camera unit with a small single-board computer and the FIRO detection software
- Weather-resistant housing and mounting kit
- Setup of alerts to your dashboard and phones

Tell us about your site and we will recommend the right setup.`,
    specs: [
      { k: "Detection", v: "Fire and smoke, on the device" },
      { k: "Alerts", v: "Dashboard, WhatsApp and email" },
      { k: "Connectivity", v: "Wi-Fi or 4G" },
      { k: "Power", v: "Mains or solar (on request)" },
    ],
    price: "On request",
    photo: "", gallery: [],
    published: true, order: 1,
  },
  {
    slug: "firo-fire-smoke-detection-model",
    name: "FIRO Fire & Smoke Detection Model",
    category: "model",
    summary: "A lightweight AI model trained to recognise wildfire flames and smoke in camera images, built to run in real time on low-cost devices.",
    description: `A computer-vision model trained on forest and landscape images to tell **fire**, **smoke** and **normal scenes** apart. It is small enough to run in real time on low-cost edge devices, with no cloud connection needed.

### Use it to
- Add wildfire detection to your own cameras or drones
- Screen images from lookout towers and CCTV
- Build research projects on wildfire detection

### What you get
- The trained model in an edge-ready format
- Example code for running it on a single-board computer
- Guidance on setting detection thresholds for your area

Licensing for research, NGOs and commercial use is available.`,
    specs: [
      { k: "Classes", v: "Fire, smoke, normal" },
      { k: "Runs on", v: "Single-board computers and PCs" },
      { k: "Formats", v: "Edge-ready model files" },
      { k: "Licence", v: "Research, NGO or commercial" },
    ],
    price: "On request",
    photo: "", gallery: [],
    published: true, order: 2,
  },
  {
    slug: "firo-detection-software",
    name: "FIRO Detection Software",
    category: "software",
    summary: "The software that turns a camera into a wildfire sensor: it reads the camera, runs the AI and sends alerts with photos and location.",
    description: `FIRO Detection Software runs on the device next to the camera. It reads the video, checks frames with the detection model and, when it finds fire or smoke, sends an alert with a photo, the confidence and the camera's position.

### Features
- Real-time detection on the device
- Alerts to the FIRO dashboard, with photo and location
- Keeps working and stores events when the connection drops
- Remote settings for sensitivity and alert rules

Works with the FIRO Edge Camera or with compatible cameras you already have.`,
    specs: [
      { k: "Runs on", v: "Single-board computers (Linux)" },
      { k: "Cameras", v: "USB, CSI and IP cameras" },
      { k: "Alerts", v: "Cloud dashboard, with photo and location" },
      { k: "Updates", v: "Included for the first year" },
    ],
    price: "On request",
    photo: "", gallery: [],
    published: true, order: 3,
  },
  {
    slug: "firo-control-room-dashboard",
    name: "FIRO Control Room Dashboard",
    category: "dashboard",
    summary: "A live web dashboard for forest teams: every camera, alert and public fire report on one map, with history and analytics.",
    description: `The FIRO Control Room Dashboard gives your team one place to watch the forest.

### Features
- **Live map** of cameras, alerts and public fire reports
- **Incidents** list with photos, confidence and status
- **Cameras** page showing which devices are online
- **Analytics** of fire events over time and by area
- NASA satellite fire data on the same map
- Staff accounts with access control

It works in any browser on computers, tablets and phones, and can be set up with your organisation's name and logo.`,
    specs: [
      { k: "Access", v: "Web browser, any device" },
      { k: "Users", v: "Staff accounts with roles" },
      { k: "Data", v: "Cameras, public reports and NASA satellite data" },
      { k: "Hosting", v: "Cloud, set up for you" },
    ],
    price: "On request",
    photo: "", gallery: [],
    published: true, order: 4,
  },
  {
    slug: "hardware-setup-and-configuration",
    name: "Hardware Setup & Configuration",
    category: "config",
    summary: "Our team plans, installs and configures your detection cameras on-site, and trains your staff to use them.",
    description: `Getting cameras working on a hillside takes more than hardware. We take care of it from start to finish.

### What is included
- **Site survey**: choosing camera points with the best view of the forest
- **Installation**: mounting, power (mains or solar) and connectivity
- **Configuration**: detection settings, alert contacts and the dashboard
- **Training**: showing your team how to respond to alerts
- **Support**: help after installation

Available in Azad Jammu & Kashmir and across Pakistan. For other countries, contact us for remote configuration and support.`,
    specs: [
      { k: "Service", v: "Survey, installation, configuration, training" },
      { k: "Where", v: "AJK and Pakistan on-site, worldwide remote" },
      { k: "Works with", v: "FIRO and compatible hardware" },
    ],
    price: "Quote after site survey",
    photo: "", gallery: [],
    published: true, order: 5,
  },
];

const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name));

let managedPromise = null;
function productsManaged(db) {
  if (!managedPromise) {
    managedPromise = getDoc(doc(db, COLLECTIONS.content, "products"))
      .then((snap) => snap.exists() && snap.data().products_managed === true)
      .catch(() => false);
  }
  return managedPromise;
}

/** Published products, in display order. */
export async function loadProducts(db) {
  if (db) {
    try {
      const snap = await getDocs(query(collection(db, COLLECTIONS.products), where("published", "==", true)));
      if (!snap.empty) return snap.docs.map((d) => ({ ...d.data(), slug: d.id })).sort(byOrder);
      if (await productsManaged(db)) return [];
    } catch (err) {
      console.warn("[FIRO] Could not load products, showing the built-in list.", err);
    }
  }
  return STARTER_PRODUCTS.filter((p) => p.published).sort(byOrder);
}

/** One published product by slug, or null. */
export async function loadProduct(db, slug) {
  if (!slug) return null;
  if (db) {
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.products, slug));
      if (snap.exists() && snap.data().published) return { ...snap.data(), slug: snap.id };
    } catch (err) {
      console.warn("[FIRO] Could not load product.", err);
    }
    if (await productsManaged(db)) return null;
  }
  return STARTER_PRODUCTS.find((p) => p.slug === slug && p.published) || null;
}

/** WhatsApp link with the product's details already written in the message. */
export function buyLink(product, { quantity = 1, pageUrl = "" } = {}) {
  const lines = ["Hello FIRO, I would like to buy this item:", "", `*${product.name}*`, `Category: ${categoryOf(product).label}`];
  if (product.price) lines.push(`Price: ${product.price}`);
  if (quantity > 1) lines.push(`Quantity: ${quantity}`);
  lines.push(`Product code: ${product.slug}`);
  if (pageUrl) lines.push(`Link: ${pageUrl}`);
  lines.push("", "Please send me the details and how to order.");
  return `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/** Hide product photos that fail to load (the category icon behind them shows instead). */
export function hideBrokenPhotos(root) {
  root.querySelectorAll(".has-photo img").forEach((img) => {
    const fail = () => { img.parentElement.classList.remove("has-photo"); img.remove(); };
    if (img.complete && !img.naturalWidth) fail(); else img.addEventListener("error", fail, { once: true });
  });
}

/** Card image: the product photo, or its category icon on a forest background. */
export function productImageHtml(p, esc, cls = "product-media") {
  const photo = photosOf(p)[0];
  const cat = categoryOf(p);
  return `<div class="${cls} ${photo ? "has-photo" : ""}">
    ${photo ? `<img src="${esc(photo)}" alt="${esc(p.name)}" loading="lazy" />` : ""}
    <i class="fa-solid ${cat.icon}" aria-hidden="true"></i>
  </div>`;
}
