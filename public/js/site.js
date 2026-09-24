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
  { page: "blog",    href: "/blog",    label: "Blog" },
  { page: "report",  href: "/report",  label: "Report a Fire", cls: "nav-report" },
  { page: "contact", href: "/contact", label: "Contact" },
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
        <a class="nav-profile" href="/dashboard" title="Dashboard" aria-label="Open the monitoring dashboard">
          <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
        </a>
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
        </div>
        <div>
          <h4 data-edit="col1">Explore</h4>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/about">About FIRO</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 data-edit="col2">Act</h4>
          <ul>
            <li><a href="/report">Report a fire</a></li>
            <li><a href="/dashboard">Monitoring dashboard</a></li>
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
        <a class="footer-credit" href="https://datixai.com" target="_blank" rel="noopener">Developed by Datix AI</a>
        <span data-edit="tagline">Built for the forests of Azad Kashmir <i class="fa-solid fa-leaf text-leaf" aria-hidden="true"></i></span>
      </div>
    </div>`;
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
export function initSite() {
  const page = document.body.dataset.page || "";
  renderHeader(page);
  renderFooter();
  initJungleBackground();
  initReveal();
  // Text edited in Admin → Website content (the admin preview waits on this promise)
  window.__firoContent = loadSiteContent(page).catch((err) => console.warn("[FIRO] Site content:", err));
}
