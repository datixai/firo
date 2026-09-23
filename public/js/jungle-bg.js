/**
 * jungle-bg.js
 * ─────────────────────────────────────────────────────────────
 * Animated night-jungle background for the FIRO website.
 *
 * Layers (back → front):
 *   sky gradient + moon + light rays (CSS, see css/site.css)
 *   far canopy  → mist → mid canopy + palms → mist → near foliage
 *   fireflies + rising embers (animated canvas)
 *
 * All foliage is drawn procedurally with a seeded random generator,
 * so the scene looks the same on every visit and needs no images.
 * Respects prefers-reduced-motion (static scene, no animation).
 * ─────────────────────────────────────────────────────────────
 */

const COLORS = {
  far:  "#0e3b27",
  mid:  "#082a1b",
  near: "#03130c",
};

const DEPTHS = { far: 0.012, mid: 0.03, near: 0.065 };   // scroll parallax factors
const MOUSE_SHIFT = { far: 6, mid: 14, near: 26 };       // px of horizontal mouse parallax

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── Seeded random (mulberry32) ─────────────────────────────── */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng, min, max) => min + rng() * (max - min);

/* ── Drawing primitives ─────────────────────────────────────── */

/** Bumpy tree canopy: overlapping circles along a baseline, filled to the bottom. */
function drawCanopy(ctx, w, h, { base, amp, rMin, rMax, rng }) {
  ctx.fillRect(0, base, w, h - base);
  let x = -rMax;
  while (x < w + rMax) {
    const r = between(rng, rMin, rMax);
    const y = base - rng() * amp;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r, y, r * 2, base - y + 1);
    x += between(rng, rMin * 0.55, rMin * 1.25);
  }
}

/** A tall rainforest tree: thin trunk and a clustered crown. */
function drawEmergent(ctx, x, base, height, scale, rng) {
  const top = base - height;
  ctx.fillRect(x - 3 * scale, top + 20 * scale, 6 * scale, height);
  const blobs = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < blobs; i++) {
    const r = between(rng, 18, 34) * scale;
    const bx = x + between(rng, -45, 45) * scale;
    const by = top + between(rng, -10, 30) * scale;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Point and tangent on a quadratic Bézier curve. */
function quad(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    tx: 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    ty: 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  };
}

/** Palm / fern frond: a curved spine with leaflets on both sides. */
function drawFrond(ctx, origin, angle, length, scale, droop, leafLen, rng) {
  const end = {
    x: origin.x + Math.cos(angle) * length,
    y: origin.y + Math.sin(angle) * length + droop * length,
  };
  const ctrl = {
    x: origin.x + Math.cos(angle) * length * 0.55,
    y: origin.y + Math.sin(angle) * length * 0.55 - length * 0.18,
  };

  ctx.lineCap = "round";
  ctx.lineWidth = 2.4 * scale;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
  ctx.stroke();

  for (let t = 0.1; t <= 1.001; t += 0.055) {
    const p = quad(origin, ctrl, end, t);
    const len = Math.hypot(p.tx, p.ty) || 1;
    const ux = p.tx / len, uy = p.ty / len;          // along the spine
    const size = leafLen * scale * (1 - t * 0.72) * between(rng, 0.85, 1.1);
    for (const side of [-1, 1]) {
      // leaflet points forward-and-out, pulled down by gravity
      const lx = ux * 0.55 + -uy * side * 0.85;
      const ly = uy * 0.55 + ux * side * 0.85 + 0.55;
      const n = Math.hypot(lx, ly) || 1;
      ctx.lineWidth = Math.max(1, 2.6 * scale * (1 - t * 0.5));
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(
        p.x + (lx / n) * size * 0.6, p.y + (ly / n) * size * 0.35,
        p.x + (lx / n) * size, p.y + (ly / n) * size
      );
      ctx.stroke();
    }
  }
}

/** Palm tree with a tapered, leaning trunk and a crown of fronds. */
function drawPalm(ctx, x, base, height, lean, scale, rng) {
  const p0 = { x, y: base };
  const p2 = { x: x + lean, y: base - height };
  const p1 = { x: x + lean * 0.15, y: base - height * 0.55 };

  // Tapered trunk polygon
  const left = [], right = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = quad(p0, p1, p2, t);
    const len = Math.hypot(p.tx, p.ty) || 1;
    const nx = -p.ty / len, ny = p.tx / len;
    const wdt = (9 * (1 - t) + 3.5) * scale;
    left.push([p.x + nx * wdt, p.y + ny * wdt]);
    right.push([p.x - nx * wdt, p.y - ny * wdt]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  left.forEach(([px, py]) => ctx.lineTo(px, py));
  right.reverse().forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.closePath();
  ctx.fill();

  // Crown
  ctx.beginPath();
  ctx.arc(p2.x, p2.y, 7 * scale, 0, Math.PI * 2);
  ctx.fill();

  const fronds = 8 + Math.floor(rng() * 3);
  for (let i = 0; i < fronds; i++) {
    const spread = (i / (fronds - 1)) * Math.PI * 1.25 - Math.PI * 1.12;   // from left-down, over the top, to right-down
    const angle = spread + between(rng, -0.12, 0.12);
    const length = between(rng, 70, 115) * scale;
    drawFrond(ctx, p2, angle, length, scale, between(rng, 0.25, 0.5), 26, rng);
  }
}

/** Broad banana / monstera style leaf, with torn slits. */
function drawBigLeaf(ctx, x, y, len, width, angle, rng, slits = true) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -width, len * 0.75, -width * 0.85, len, 0);
  ctx.bezierCurveTo(len * 0.75, width * 0.85, len * 0.25, width, 0, 0);
  ctx.fill();
  // stem
  ctx.lineWidth = Math.max(2, width * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-len * 0.35, width * 0.1);
  ctx.stroke();

  if (slits) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = Math.max(1.5, width * 0.05);
    const count = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const t = between(rng, 0.25, 0.85);
      const side = rng() < 0.5 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(len * t, side * width * 0.08);
      ctx.lineTo(len * (t + 0.08), side * width * 1.1);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

/** Vine hanging from the top edge with small leaves. */
function drawVine(ctx, x, length, sway, scale, rng) {
  const p0 = { x, y: -10 };
  const p2 = { x: x + sway, y: length };
  const p1 = { x: x - sway * 0.6, y: length * 0.5 };
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();
  for (let t = 0.08; t <= 1; t += between(rng, 0.05, 0.09)) {
    const p = quad(p0, p1, p2, t);
    const side = Math.round(t * 20) % 2 === 0 ? -1 : 1;
    const leaf = between(rng, 10, 18) * scale;
    drawBigLeaf(ctx, p.x, p.y, leaf, leaf * 0.45, Math.PI / 2 + side * between(rng, 0.6, 1.1), rng, false);
  }
}

/* ── Layer painters ─────────────────────────────────────────── */

function paintFar(ctx, w, h, s) {
  const rng = makeRng(1101);
  ctx.fillStyle = ctx.strokeStyle = COLORS.far;
  drawCanopy(ctx, w, h, { base: h * 0.7, amp: h * 0.07, rMin: 16 * s, rMax: 40 * s, rng });
  const trees = Math.max(3, Math.round(w / 380));
  for (let i = 0; i < trees; i++) {
    drawEmergent(ctx, between(rng, 0.03, 0.97) * w, h * 0.7, between(rng, 0.12, 0.2) * h, s * 0.8, rng);
  }
  for (let i = 0; i < 3; i++) {
    drawPalm(ctx, between(rng, 0.1, 0.9) * w, h * 0.69, between(rng, 0.14, 0.19) * h, between(rng, -30, 30) * s, s * 0.55, rng);
  }
}

function paintMid(ctx, w, h, s) {
  const rng = makeRng(2207);
  ctx.fillStyle = ctx.strokeStyle = COLORS.mid;
  drawCanopy(ctx, w, h, { base: h * 0.8, amp: h * 0.08, rMin: 24 * s, rMax: 58 * s, rng });
  const palms = Math.max(3, Math.round(w / 330));
  for (let i = 0; i < palms; i++) {
    const x = ((i + 0.5) / palms) * w + between(rng, -60, 60) * s;
    drawPalm(ctx, x, h * 0.8, between(rng, 0.26, 0.38) * h, between(rng, -70, 70) * s, s * 0.95, rng);
  }
}

function paintNear(ctx, w, h, s) {
  const rng = makeRng(3319);
  ctx.fillStyle = ctx.strokeStyle = COLORS.near;

  // ground bushes
  drawCanopy(ctx, w, h, { base: h * 0.93, amp: h * 0.035, rMin: 22 * s, rMax: 48 * s, rng });

  // ferns rising from the ground
  for (let i = 0; i < Math.round(w / 170); i++) {
    const origin = { x: between(rng, 0, w), y: h * between(rng, 0.9, 0.93) };
    for (let f = 0; f < 6; f++) {
      drawFrond(ctx, origin, between(rng, -2.7, -0.45), between(rng, 45, 85) * s, s * 0.75, 0.12, 15, rng);
    }
  }

  // big palms framing the left and right edges
  drawPalm(ctx, w * 0.02, h * 0.95, h * 0.62, 90 * s, s * 1.7, rng);
  drawPalm(ctx, w * 0.985, h * 0.95, h * 0.55, -110 * s, s * 1.55, rng);

  // broad leaves in the bottom corners
  for (let i = 0; i < 7; i++) {
    const len = between(rng, 110, 190) * s;
    drawBigLeaf(ctx, between(rng, -20, 120) * s, h * 0.95, len, len * 0.33, between(rng, -1.5, -0.35), rng);
    drawBigLeaf(ctx, w - between(rng, -20, 120) * s, h * 0.95, len, len * 0.33, Math.PI + between(rng, 0.35, 1.5), rng);
  }

  // leaves hanging from the top corners
  for (let i = 0; i < 5; i++) {
    const len = between(rng, 90, 150) * s;
    drawBigLeaf(ctx, between(rng, -30, 60) * s, between(rng, -20, 10), len, len * 0.3, between(rng, 0.35, 1.2), rng);
    drawBigLeaf(ctx, w - between(rng, -30, 60) * s, between(rng, -20, 10), len, len * 0.3, Math.PI - between(rng, 0.35, 1.2), rng);
  }

  // hanging vines near both edges
  const vines = Math.max(3, Math.round(w / 360));
  for (let i = 0; i < vines; i++) {
    const left = i % 2 === 0;
    const x = left ? between(rng, 0.03, 0.2) * w : between(rng, 0.8, 0.97) * w;
    drawVine(ctx, x, between(rng, 0.14, 0.34) * h, between(rng, -30, 30) * s, s, rng);
  }
}

/* ── Fireflies & embers ─────────────────────────────────────── */

function makeSprite(inner, outer, size = 48) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, inner);
  grad.addColorStop(0.45, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function createParticles(canvas) {
  const ctx = canvas.getContext("2d");
  const fireflySprite = makeSprite("rgba(245,255,190,1)", "rgba(190,255,110,0.35)");
  const emberSprite = makeSprite("rgba(255,230,160,1)", "rgba(255,120,40,0.4)");
  let w = 0, h = 0, dpr = 1;
  let flies = [], embers = [];

  function spawnEmber(anywhere) {
    return {
      x: Math.random() * w,
      y: anywhere ? h * (0.4 + Math.random() * 0.6) : h + 10,
      vy: -(0.25 + Math.random() * 0.55),
      vx: (Math.random() - 0.5) * 0.2,
      size: 5 + Math.random() * 7,
      life: 1,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const flyCount = Math.round(Math.min(70, (w * h) / 22000));
    flies = Array.from({ length: flyCount }, () => ({
      x: Math.random() * w,
      y: h * (0.3 + Math.random() * 0.68),
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.25,
      size: 7 + Math.random() * 11,
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.02,
    }));
    const emberCount = Math.round(Math.min(18, w / 90));
    embers = Array.from({ length: emberCount }, () => spawnEmber(true));
  }

  function draw(moving) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    for (const f of flies) {
      if (moving) {
        f.phase += f.speed;
        f.x += f.vx + Math.sin(f.phase * 0.7) * 0.25;
        f.y += f.vy + Math.cos(f.phase * 0.5) * 0.2;
        if (f.x < -20) f.x = w + 20; else if (f.x > w + 20) f.x = -20;
        if (f.y < h * 0.2) f.vy = Math.abs(f.vy); else if (f.y > h) f.vy = -Math.abs(f.vy);
      }
      const glow = Math.pow(Math.max(0, Math.sin(f.phase)), 2);
      ctx.globalAlpha = 0.12 + glow * 0.88;
      ctx.drawImage(fireflySprite, f.x - f.size, f.y - f.size, f.size * 2, f.size * 2);
    }

    for (let i = 0; i < embers.length; i++) {
      const e = embers[i];
      if (moving) {
        e.phase += 0.03;
        e.x += e.vx + Math.sin(e.phase) * 0.3;
        e.y += e.vy;
        e.life = Math.min(1, Math.max(0, (e.y - h * 0.15) / (h * 0.6)));
        if (e.y < h * 0.12) embers[i] = spawnEmber(false);
      }
      ctx.globalAlpha = 0.85 * e.life * (0.6 + 0.4 * Math.sin(e.phase * 3));
      ctx.drawImage(emberSprite, e.x - e.size, e.y - e.size, e.size * 2, e.size * 2);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  return { resize, draw };
}

/* ── Public entry point ─────────────────────────────────────── */

export function initJungleBackground() {
  if (document.getElementById("jungle-bg")) return;

  const root = document.createElement("div");
  root.id = "jungle-bg";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="jg-rays"></div>
    <div class="jg-moon"></div>
    <canvas class="jg-layer" data-layer="far"></canvas>
    <div class="jg-mist jg-mist-1"></div>
    <canvas class="jg-layer" data-layer="mid"></canvas>
    <div class="jg-mist jg-mist-2"></div>
    <canvas class="jg-layer" data-layer="near"></canvas>
    <canvas class="jg-particles"></canvas>
    <div class="jg-vignette"></div>`;
  document.body.prepend(root);

  const layers = [...root.querySelectorAll(".jg-layer")].map((canvas) => ({
    canvas,
    name: canvas.dataset.layer,
    ctx: canvas.getContext("2d"),
  }));
  const painters = { far: paintFar, mid: paintMid, near: paintNear };
  const particles = createParticles(root.querySelector(".jg-particles"));

  let lastW = 0, lastH = 0;
  function paintLayers(force) {
    const vw = window.innerWidth, vh = window.innerHeight;
    // Mobile browsers change height when the address bar hides; ignore small changes
    if (!force && vw === lastW && Math.abs(vh - lastH) < vh * 0.2) return;
    lastW = vw; lastH = vh;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = Math.max(0.55, Math.min(1.25, vw / 1400));
    for (const layer of layers) {
      const rect = layer.canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      layer.canvas.width = Math.round(w * dpr);
      layer.canvas.height = Math.round(h * dpr);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer.ctx.clearRect(0, 0, w, h);
      // Scene is composed for the visible viewport height, canvas is taller for parallax room
      painters[layer.name](layer.ctx, w, vh, scale);
      if (h > vh) {
        layer.ctx.fillStyle = COLORS[layer.name];
        if (layer.name !== "far") layer.ctx.fillRect(0, vh * 0.93, w, h - vh * 0.93);
        else layer.ctx.fillRect(0, vh * 0.7, w, h - vh * 0.7);
      }
    }
    particles.resize();
    if (reduceMotion) particles.draw(false);
  }

  // Parallax (scroll + mouse)
  let mouseX = 0, targetMouseX = 0;
  function applyParallax() {
    const y = window.scrollY || 0;
    for (const layer of layers) {
      const shiftY = Math.min(y * DEPTHS[layer.name], window.innerHeight * 0.12);
      const shiftX = mouseX * MOUSE_SHIFT[layer.name];
      layer.canvas.style.transform = `translate3d(${shiftX.toFixed(1)}px, ${(-shiftY).toFixed(1)}px, 0)`;
    }
  }

  paintLayers(true);
  applyParallax();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { paintLayers(false); applyParallax(); }, 180);
  });

  if (reduceMotion) return;

  window.addEventListener("scroll", applyParallax, { passive: true });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
  }, { passive: true });

  function frame() {
    mouseX += (targetMouseX - mouseX) * 0.04;
    if (Math.abs(targetMouseX - mouseX) > 0.001) applyParallax();
    particles.draw(true);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
