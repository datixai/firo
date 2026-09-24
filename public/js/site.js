/**
 * site.js
 * ─────────────────────────────────────────────────────────────
 * Shared layout for the public website: navigation bar, footer,
 * jungle background, scroll-reveal animations and toasts.
 *
 * Usage in a page:
 *   <body class="site" data-page="home">
 *     <header id="site-header"></header>
 *     <main> … </main>
 *     <footer id="site-footer"></footer>
 *     <script type="module">
 *       import { initSite } from "/js/site.js";
 *       initSite();
 *     </script>
 * ─────────────────────────────────────────────────────────────
 */

import { initJungleBackground } from "/js/jungle-bg.js";
import { esc } from "/js/common.js";
import { loadSiteContent } from "/js/content.js";

export const NAV_LINKS = [
  { page: "home",    href: "/",        label: "Home" },
  { page: "about",   href: "/about",   label: "About" },
  { page: "products", href: "/products", label: "Products" },
  { page: "blog",    href: "/blog",    label: "Blog" },
  { page: "volunteers", href: "/volunteers", label: "Volunteers" },
  { page: "report",  href: "/report",  label: "Report a Fire", cls: "nav-report" },
  { page: "donate",  href: "/donate",  label: "Donate" },
];

function renderHeader(activePage) {
  const header = document.getElementById("site-header");
  if (!header) return;
  header.className = "site-header";
  header.innerHTML = `
    <nav class="container nav" aria-label="Main">
      <a class="brand" href="/" aria-label="FIRO home">
        <img class="brand-mark" src="/assets/logo-mark.png" alt="" width="34" height="39" />
        <span class="brand-name">FIRO</span>
      </a>
      <ul class="nav-links" id="nav-links">
        ${NAV_LINKS.map((l) => `
          <li><a href="${l.href}" class="${l.cls || ""} ${l.page === activePage ? "active" : ""}"
                 ${l.page === activePage ? 'aria-current="page"' : ""}>
            ${esc(l.label)}</a></li>`).join("")}
      </ul>
      <div class="nav-actions">
        <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">
          <i class="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
      </div>
    </nav>`;

  const toggle = header.querySelector("#nav-toggle");
  const links = header.querySelector("#nav-links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML = `<i class="fa-solid ${open ? "fa-xmark" : "fa-bars"}" aria-hidden="true"></i>`;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && links.classList.contains("open")) toggle.click();
  });
}

function renderFooter() {
  const footer = document.getElementById("site-footer");
  if (!footer) return;
  footer.className = "site-footer";
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-about">
          <a class="brand" href="/">
            <img class="brand-mark" src="/assets/logo-mark.png" alt="" width="34" height="39" />
            <span class="brand-name">FIRO</span>
          </a>
          <p data-edit="about">Edge-AI wildfire detection for the forests of Azad Jammu &amp; Kashmir.
             Cameras with on-device AI spot fire on-site and alert the Forest Department in seconds.</p>
          <div class="footer-flags">
            <span class="footer-flag"><img src="/assets/flags/ajk.jpg" alt="Flag of Azad Jammu and Kashmir" width="30" height="20" loading="lazy" />Azad Jammu Kashmir</span>
            <span class="footer-flag"><img src="/assets/flags/pakistan.svg" alt="Flag of Pakistan" width="30" height="20" loading="lazy" />Pakistan</span>
          </div>
        </div>
        <div>
          <h4 data-edit="col1">Explore</h4>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/about">About FIRO</a></li>
            <li><a href="/products">Products</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/volunteers">Volunteers</a></li>
            <li><a href="/donate">Donate</a></li>
          </ul>
        </div>
        <div>
          <h4 data-edit="col2">Act</h4>
          <ul>
            <li><a href="/report">Report a fire</a></li>
            <li><a href="/logs">Public event log</a></li>
          </ul>
        </div>
        <div>
          <h4 data-edit="col3">Emergency</h4>
          <ul>
            <li><span class="text-dim">Rescue:</span> <a href="tel:1122">1122</a></li>
            <li><span class="text-dim">Report online:</span> <a href="/report">/report</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span class="footer-legal">
          <a class="footer-credit" href="https://datixai.com" target="_blank" rel="noopener">Developed by Datix AI</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <button type="button" class="link-btn" data-cookie-settings>Cookie settings</button>
        </span>
        <span data-edit="tagline">Built for the forests of Azad Kashmir <i class="chinar text-leaf" aria-hidden="true"></i></span>
      </div>
    </div>`;
}

/* ── Quotes that drift in while scrolling the home page ────── */
// Real, attributed quotes only.
const HOME_QUOTES = [
  { text: "Forests are the lungs of our land, purifying the air and giving fresh strength to our people.", by: "Franklin D. Roosevelt" },
  { text: "A society grows great when old men plant trees in whose shade they know they shall never sit.", by: "Greek proverb" },
  { text: "Until you dig a hole, you plant a tree, you water it and make it survive, you haven't done a thing. You are just talking.", by: "Wangari Maathai" },
  { text: "The creation of a thousand forests is in one acorn.", by: "Ralph Waldo Emerson" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", by: "Chinese proverb" },
];
const QUOTE_VISIBLE_MS = 3200;

function initScrollQuotes(quotes) {
  if (!quotes.length) return;
  const el = document.createElement("aside");
  el.className = "quote-float";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<p class="quote-float-text"></p><p class="quote-float-by"></p>`;
  document.body.appendChild(el);

  let next = 0, hideTimer = null, ticking = false;
  const show = (q) => {
    el.querySelector(".quote-float-text").textContent = `\u201C${q.text}\u201D`;
    el.querySelector(".quote-float-by").textContent = q.by;
    el.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.classList.remove("show");
      // If the reader has already scrolled past the next point, show that quote after a short pause
      setTimeout(check, 1400);
    }, QUOTE_VISIBLE_MS);
  };
  // One quote each time the reader passes another sixth of the page
  const check = () => {
    ticking = false;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0 || next >= quotes.length || el.classList.contains("show")) return;
    if (window.scrollY >= (scrollable * (next + 1)) / (quotes.length + 1)) show(quotes[next++]);
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(check); }
  }, { passive: true });
}

/** Fade elements with class "reveal" in as they scroll into view. */
export function initReveal(root = document) {
  const items = root.querySelectorAll(".reveal:not(.visible)");
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  items.forEach((el) => io.observe(el));
}

/** Small notification in the bottom-right corner. type: "info" | "success" | "error" */
export function toast(message, type = "info", ms = 4200) {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** "12 March 2026" style date from a millisecond timestamp. */
export function formatDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** Build the header, footer and background. Call once per page. */
/* ── SEO: canonical link, social tags and structured data ─────── */
const AREAS = [
  ["AdministrativeArea", "Azad Jammu and Kashmir"], ["AdministrativeArea", "Jammu and Kashmir"],
  ["AdministrativeArea", "Ladakh"], ["AdministrativeArea", "Gilgit-Baltistan"],
  ["Country", "Pakistan"], ["Country", "India"], ["Country", "United Kingdom"], ["Country", "United States"],
  ["Country", "Canada"], ["Country", "Italy"], ["Country", "Germany"], ["Country", "Greece"],
  ["Country", "Spain"], ["Country", "Portugal"], ["Country", "Turkey"], ["Country", "Australia"],
];

function addJsonLd(id, data) {
  if (document.getElementById(id)) return;
  const el = document.createElement("script");
  el.type = "application/ld+json";
  el.id = id;
  el.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
  document.head.appendChild(el);
}

function setHeadTag(tag, key, keyValue, attr, value, overwrite = false) {
  let el = document.head.querySelector(`${tag}[${key}="${keyValue}"]`);
  if (el && !overwrite) return;
  if (!el) { el = document.createElement(tag); el.setAttribute(key, keyValue); document.head.appendChild(el); }
  el.setAttribute(attr, value);
}

function applySeo(page) {
  const origin = location.origin;
  const url = origin + (location.pathname.replace(/\/+$/, "") || "/");
  const desc = document.querySelector('meta[name="description"]')?.content || "";
  setHeadTag("link", "rel", "canonical", "href", url, true);
  setHeadTag("meta", "property", "og:url", "content", url, true);
  setHeadTag("meta", "property", "og:site_name", "content", "FIRO");
  setHeadTag("meta", "property", "og:type", "content", "website");
  setHeadTag("meta", "property", "og:locale", "content", "en_GB");
  setHeadTag("meta", "property", "og:title", "content", document.title);
  setHeadTag("meta", "property", "og:description", "content", desc);
  setHeadTag("meta", "name", "twitter:card", "content", "summary");
  const img = document.head.querySelector('meta[property="og:image"]');
  if (!img) setHeadTag("meta", "property", "og:image", "content", `${origin}/assets/logo.png`);
  else if (img.content.startsWith("/")) img.content = origin + img.content;

  addJsonLd("ld-org", {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "FIRO",
    alternateName: "FIRO Wildfire Early Warning",
    url: `${origin}/`,
    logo: `${origin}/assets/logo.png`,
    description: "FIRO is a wildfire early-warning system from Azad Jammu and Kashmir, Pakistan. Cameras with on-device AI detect forest fires and smoke in seconds. FIRO sells fire detection cameras, AI models, software, dashboards and hardware setup.",
    foundingLocation: { "@type": "Place", name: "Azad Jammu and Kashmir, Pakistan" },
    areaServed: AREAS.map(([type, name]) => ({ "@type": type, name })),
    knowsAbout: ["Wildfire detection", "Forest fire early warning", "Edge AI", "Computer vision",
                 "Fire and smoke detection", "Forest conservation", "Disaster management"],
    contactPoint: { "@type": "ContactPoint", contactType: "sales", telephone: "+92-340-8226347", availableLanguage: ["English", "Urdu"] },
    parentOrganization: { "@type": "Organization", name: "Datix AI", url: "https://datixai.com" },
  });
  if (page === "home") {
    addJsonLd("ld-site", { "@context": "https://schema.org", "@type": "WebSite", name: "FIRO", url: `${origin}/`, publisher: { "@id": `${origin}/#organization` } });
  }
}

/** FAQ structured data from the questions on the page (after any text edited in the admin panel). */
function addFaqJsonLd() {
  const items = [...document.querySelectorAll(".faq details")].map((d) => ({
    q: d.querySelector("summary")?.textContent.trim(), a: d.querySelector("p")?.textContent.trim(),
  })).filter((x) => x.q && x.a);
  if (!items.length) return;
  addJsonLd("ld-faq", {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
  });
}

/* ── Cookies and terms ──────────────────────────────────────── */
// FIRO has no ads, analytics or tracking: only storage the site needs to work.
// The banner records the visitor's choice and acceptance of the Terms.
const CONSENT_KEY = "firo_consent_v1";

export function getConsent() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || "null"); } catch { return null; }
}

function showConsentBanner() {
  document.getElementById("consent")?.remove();
  const el = document.createElement("div");
  el.id = "consent";
  el.className = "consent glass";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Cookies and terms");
  el.innerHTML = `
    <div class="consent-text">
      <strong><i class="fa-solid fa-cookie-bite" aria-hidden="true"></i> Cookies and terms</strong>
      <p>FIRO uses only the cookies and storage needed to run this website, with no ads or tracking.
        By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>
    <div class="consent-actions">
      <button type="button" class="btn btn-sm" data-consent="essential">Essential only</button>
      <button type="button" class="btn btn-sm btn-leaf" data-consent="all">Accept all</button>
    </div>`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-consent]");
    if (!b) return;
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: b.dataset.consent, terms: true, ms: Date.now() })); } catch {}
    el.classList.add("hide");
    setTimeout(() => el.remove(), 300);
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
}

function initConsent() {
  if (!getConsent()) showConsentBanner();
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cookie-settings]")) return;
    e.preventDefault();
    showConsentBanner();
  });
}

export function initSite() {
  const page = document.body.dataset.page || "";
  applySeo(page);
  renderHeader(page);
  renderFooter();
  initJungleBackground();
  initReveal();
  if (page === "home") initScrollQuotes(HOME_QUOTES);
  // Text edited in Admin → Website content (the admin preview waits on this promise)
  window.__firoContent = loadSiteContent(page).catch((err) => console.warn("[FIRO] Site content:", err));
  window.__firoContent.then(addFaqJsonLd);
  if (window.self === window.top) initConsent();   // not inside the admin preview
}
