/**
 * ops/charts.js — lightweight SVG/HTML charts for the FIRO Control Room
 * ─────────────────────────────────────────────────────────────
 * Specs: 2px lines, bars ≤ 24px with 4px rounded data-ends, 2px surface
 * gaps between stacked segments, hairline solid gridlines, crosshair +
 * tooltip on line charts, per-mark tooltips on bars/cells, table twin.
 *
 * Every chart:  const c = lineChart(el, opts);  c.update(data);  c.table()
 * Labels are set with textContent (data can come from user reports).
 * ─────────────────────────────────────────────────────────────
 */

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function htmlEl(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

/* ── Tooltip (one per page) ────────────────────────────────── */

let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = htmlEl("div", "tooltip", document.body); tipEl.setAttribute("role", "status"); }
  return tipEl;
}
/** rows: [{ color, label, value }] — value leads, label follows. */
export function showTip(x, y, head, rows) {
  const t = tip();
  t.replaceChildren();
  if (head) htmlEl("div", "tt-head", t, head);
  for (const r of rows) {
    const row = htmlEl("div", "tt-row", t);
    const k = htmlEl("span", "k", row);
    if (r.color) { const i = htmlEl("i", null, k); i.style.background = r.color; }
    k.append(document.createTextNode(r.label));
    htmlEl("b", null, row, r.value);
  }
  t.classList.add("show");
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top + h > window.innerHeight - 8) top = y - h - 14;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${Math.max(8, top)}px`;
}
export function hideTip() { if (tipEl) tipEl.classList.remove("show"); }

/* ── Helpers ───────────────────────────────────────────────── */

/** Clean y-axis ticks from 0 to a round maximum. Counts get whole-number steps. */
function niceTicks(max, count = 4, integer = true) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks.map((v) => (step >= 1 ? Math.round(v) : v));
}

/** Re-render on resize. */
function responsive(container, render) {
  let last = null;
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!last || last[0] !== w || last[1] !== h) { last = [w, h]; render(); }
  });
  ro.observe(container);
}

/** Path for a vertical bar with 4px rounded top, square bottom. */
function roundedTop(x, y, w, h, r = 4) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function emptyMessage(svg, w, h, text) {
  const t = svgEl("text", { x: w / 2, y: h / 2, "text-anchor": "middle", class: "empty-msg" }, svg);
  t.textContent = text;
}

/** Legend row (≥ 2 series). kind: "line" | "rect" */
export function renderLegend(el, series, kind = "line") {
  el.replaceChildren();
  if (series.length < 2) return;
  for (const s of series) {
    const item = htmlEl("span", null, el);
    const key = htmlEl("i", kind === "line" ? "key-line" : "key-rect", item);
    key.style.background = s.color;
    item.append(document.createTextNode(s.name));
  }
}

/* ── Line chart (trend over time) ──────────────────────────── */
/**
 * data: { series: [{ key, name, color }], points: [{ t, label, values: { key: n } }] }
 * opts: { xLabel(t) → short tick label, yFormat(v) }
 */
export function lineChart(container, opts = {}) {
  let data = { series: [], points: [] };
  const M = { t: 10, r: 18, b: 26, l: 44 };

  function render() {
    if (container.clientWidth < 80) return;   // hidden (e.g. table view shown) — skip
    container.replaceChildren();
    const W = container.clientWidth, H = container.clientHeight || 220;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.title || "Line chart" }, container);
    const { series, points } = data;
    if (!points.length || !series.length) return emptyMessage(svg, W, H, "No data in this period");

    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const maxV = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] || 0)));
    const ticks = niceTicks(maxV);
    const top = ticks[ticks.length - 1];
    const xAt = (i) => M.l + (points.length === 1 ? pw / 2 : (i / (points.length - 1)) * pw);
    const yAt = (v) => M.t + ph - (v / top) * ph;

    const grid = svgEl("g", { class: "grid tick-y" }, svg);
    for (const tv of ticks) {
      const y = Math.round(yAt(tv)) + 0.5;
      if (tv !== 0) svgEl("line", { x1: M.l, x2: W - M.r, y1: y, y2: y }, grid);
      const t = svgEl("text", { x: M.l - 8, y: y + 4, "text-anchor": "end" }, grid);
      t.textContent = (opts.yFormat || fmt)(tv);
    }
    svgEl("line", { class: "baseline", x1: M.l, x2: W - M.r, y1: Math.round(yAt(0)) + 0.5, y2: Math.round(yAt(0)) + 0.5 }, svg);

    // x ticks: ~6 labels, never colliding
    const gx = svgEl("g", { class: "tick-x" }, svg);
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(pw / 90))));
    points.forEach((p, i) => {
      if (i % every !== 0 && i !== points.length - 1) return;
      if (i === points.length - 1 && i % every !== 0 && (i % every) < every * 0.6) return;
      const t = svgEl("text", { x: xAt(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle" }, gx);
      t.textContent = p.label;
    });

    // area wash only for a single series
    if (series.length === 1) {
      const s = series[0];
      const d = points.map((p, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(p.values[s.key] || 0)}`).join("")
        + `L${xAt(points.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`;
      svgEl("path", { d, fill: s.color, "fill-opacity": 0.1 }, svg);
    }
    for (const s of series) {
      const d = points.map((p, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(p.values[s.key] || 0)}`).join("");
      svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const li = points.length - 1;
      svgEl("circle", { cx: xAt(li), cy: yAt(points[li].values[s.key] || 0), r: 4, fill: s.color, stroke: "var(--surface)", "stroke-width": 2 }, svg);
    }

    // crosshair + tooltip
    const cross = svgEl("line", { class: "crosshair", y1: M.t, y2: M.t + ph, visibility: "hidden" }, svg);
    const dots = series.map((s) => svgEl("circle", { r: 4, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = svgEl("rect", { class: "hit", x: M.l, y: M.t, width: pw, height: ph }, svg);
    const at = (i, cx, cy) => {
      const x = xAt(i);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      series.forEach((s, k) => {
        dots[k].setAttribute("cx", x); dots[k].setAttribute("cy", yAt(points[i].values[s.key] || 0));
        dots[k].setAttribute("visibility", "visible");
      });
      showTip(cx, cy, points[i].tipLabel || points[i].label,
        series.map((s) => ({ color: s.color, label: s.name, value: (opts.yFormat || fmt)(points[i].values[s.key] || 0) })));
    };
    const off = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); };
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((x - M.l) / pw) * (points.length - 1))));
      at(i, e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", off);
    // keyboard: arrows move along the series
    container.tabIndex = 0;
    let ki = points.length - 1;
    container.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      ki = Math.max(0, Math.min(points.length - 1, ki + (e.key === "ArrowRight" ? 1 : -1)));
      const r = svg.getBoundingClientRect();
      at(ki, r.left + (xAt(ki) / W) * r.width, r.top + 20);
      e.preventDefault();
    };
    container.onblur = off;
  }

  responsive(container, render);
  return {
    update(d) { data = d; render(); },
    table() {
      return {
        columns: [opts.xName || "Time", ...data.series.map((s) => s.name)],
        rows: data.points.map((p) => [p.tipLabel || p.label, ...data.series.map((s) => p.values[s.key] || 0)]),
      };
    },
  };
}

/* ── Column chart (time buckets or histogram; stacked) ─────── */
/**
 * data: { series: [{ key, name, color }], buckets: [{ label, tipLabel, values: { key: n } }] }
 */
export function columnChart(container, opts = {}) {
  let data = { series: [], buckets: [] };
  const M = { t: 12, r: 12, b: 26, l: 40 };

  function render() {
    if (container.clientWidth < 80) return;   // hidden (e.g. table view shown) — skip
    container.replaceChildren();
    const W = container.clientWidth, H = container.clientHeight || 220;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.title || "Column chart" }, container);
    const { series, buckets } = data;
    const totals = buckets.map((b) => series.reduce((s, x) => s + (b.values[x.key] || 0), 0));
    if (!buckets.length || !series.length) return emptyMessage(svg, W, H, "No data in this period");

    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const ticks = niceTicks(Math.max(1, ...totals));
    const top = ticks[ticks.length - 1];
    const band = pw / buckets.length;
    const bw = Math.max(2, Math.min(24, band * 0.68));
    const yAt = (v) => M.t + ph - (v / top) * ph;

    const grid = svgEl("g", { class: "grid tick-y" }, svg);
    for (const tv of ticks) {
      const y = Math.round(yAt(tv)) + 0.5;
      if (tv !== 0) svgEl("line", { x1: M.l, x2: W - M.r, y1: y, y2: y }, grid);
      const t = svgEl("text", { x: M.l - 8, y: y + 4, "text-anchor": "end" }, grid);
      t.textContent = fmt(tv);
    }

    const gx = svgEl("g", { class: "tick-x" }, svg);
    const every = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(pw / 56))));
    buckets.forEach((b, i) => {
      const cx = M.l + band * i + band / 2;
      if (i % every === 0) {
        const t = svgEl("text", { x: cx, y: H - 6, "text-anchor": "middle" }, gx);
        t.textContent = b.label;
      }
      // stacked segments with a 2px surface gap; rounded top on the top segment only
      let acc = 0;
      const nonZero = series.filter((s) => (b.values[s.key] || 0) > 0);
      nonZero.forEach((s, k) => {
        const v = b.values[s.key];
        const y0 = yAt(acc), y1 = yAt(acc + v);
        const gap = k > 0 ? 2 : 0;
        const h = Math.max(0, y0 - y1 - gap);
        const isTop = k === nonZero.length - 1;
        const x = cx - bw / 2;
        const attrs = { class: "mark", fill: s.color };
        if (isTop) svgEl("path", { ...attrs, d: roundedTop(x, y1, bw, h) }, svg);
        else svgEl("rect", { ...attrs, x, y: y1, width: bw, height: h }, svg);
        acc += v;
      });
      // hit target: the whole band
      const hit = svgEl("rect", { class: "hit", x: M.l + band * i, y: M.t, width: band, height: ph }, svg);
      hit.style.cursor = "default";
      hit.addEventListener("pointermove", (e) => {
        const rows = series.map((s) => ({ color: s.color, label: s.name, value: fmt(b.values[s.key] || 0) }));
        if (series.length > 1) rows.push({ label: "Total", value: fmt(totals[i]) });
        showTip(e.clientX, e.clientY, b.tipLabel || b.label, rows);
      });
      hit.addEventListener("pointerleave", hideTip);
    });
    svgEl("line", { class: "baseline", x1: M.l, x2: W - M.r, y1: Math.round(yAt(0)) + 0.5, y2: Math.round(yAt(0)) + 0.5 }, svg);
  }

  responsive(container, render);
  return {
    update(d) { data = d; render(); },
    table() {
      return {
        columns: [opts.xName || "Bucket", ...data.series.map((s) => s.name)],
        rows: data.buckets.map((b) => [b.tipLabel || b.label, ...data.series.map((s) => b.values[s.key] || 0)]),
      };
    },
  };
}

/* ── Horizontal bar list (ranked categories; optional stacking) ── */
/**
 * data: { series: [{ key, name, color }], rows: [{ label, values: { key: n } }] }
 * HTML layout so long labels wrap/ellipsis cleanly; value printed at the bar tip.
 */
export function barList(container, opts = {}) {
  let data = { series: [], rows: [] };

  function render() {
    container.replaceChildren();
    const { series, rows } = data;
    if (!rows.length) { htmlEl("div", "empty", container, opts.empty || "No data in this period"); return; }
    const totals = rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] || 0), 0));
    const max = Math.max(1, ...totals);
    const list = htmlEl("div", null, container);
    list.style.cssText = "display:grid;gap:10px;";
    rows.forEach((r, i) => {
      const row = htmlEl("div", null, list);
      row.style.cssText = "display:grid;grid-template-columns:minmax(90px,34%) 1fr auto;gap:10px;align-items:center;";
      const lab = htmlEl("div", null, row, r.label);
      lab.style.cssText = "font-size:.84rem;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      lab.title = r.label;
      const track = htmlEl("div", null, row);
      track.style.cssText = "display:flex;gap:2px;height:14px;align-items:stretch;";
      series.forEach((s, k) => {
        const v = r.values[s.key] || 0;
        if (!v) return;
        const seg = htmlEl("div", "mark", track);
        seg.style.cssText = `width:${(v / max) * 100}%;background:${s.color};min-width:3px;`;
        const last = series.slice(k + 1).every((n) => !(r.values[n.key] > 0));
        seg.style.borderRadius = last ? "0 4px 4px 0" : "0";
        seg.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, r.label,
          series.map((x) => ({ color: x.color, label: x.name, value: fmt(r.values[x.key] || 0) }))));
        seg.addEventListener("pointerleave", hideTip);
      });
      const val = htmlEl("div", "num", row, fmt(totals[i]));
      val.style.cssText = "font-weight:700;font-size:.9rem;min-width:28px;text-align:right;";
    });
  }

  render();
  return {
    update(d) { data = d; render(); },
    table() {
      return {
        columns: [opts.xName || "Category", ...data.series.map((s) => s.name)],
        rows: data.rows.map((r) => [r.label, ...data.series.map((s) => r.values[s.key] || 0)]),
      };
    },
  };
}

/* ── Heatmap (weekday × hour) ──────────────────────────────── */
/**
 * data: { rows: ["Mon", …], cols: ["00", …], values: number[rows][cols] }
 * Ordinal heat ramp (validated): var(--heat-1 … --heat-5); zero = --heat-0.
 */
export function heatmap(container, opts = {}) {
  let data = { rows: [], cols: [], values: [] };
  const STEPS = 5;

  function render() {
    if (container.clientWidth < 80) return;
    container.replaceChildren();
    const W = container.clientWidth, H = container.clientHeight || 240;
    const M = { t: 6, r: 6, b: 22, l: 38 };
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.title || "Heatmap" }, container);
    const { rows, cols, values } = data;
    const max = Math.max(0, ...values.flat());
    if (!rows.length || max === 0) return emptyMessage(svg, W, H, "No incidents in this period");

    const cw = (W - M.l - M.r) / cols.length, ch = (H - M.t - M.b) / rows.length;
    const bin = (v) => (v <= 0 ? 0 : Math.min(STEPS, Math.ceil((v / max) * STEPS)));
    rows.forEach((rl, r) => {
      const t = svgEl("text", { x: M.l - 8, y: M.t + ch * r + ch / 2 + 4, "text-anchor": "end" }, svg);
      t.textContent = rl;
      cols.forEach((cl, c) => {
        const v = values[r][c] || 0;
        const cell = svgEl("rect", {
          class: "mark", x: M.l + cw * c + 1, y: M.t + ch * r + 1,
          width: Math.max(1, cw - 2), height: Math.max(1, ch - 2), rx: 3,
          fill: `var(--heat-${bin(v)})`,
        }, svg);
        cell.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, `${rl} ${cl}:00–${cl}:59`,
          [{ label: opts.valueName || "Incidents", value: fmt(v) }]));
        cell.addEventListener("pointerleave", hideTip);
      });
    });
    cols.forEach((cl, c) => {
      if (c % 3 !== 0) return;
      const t = svgEl("text", { x: M.l + cw * c + cw / 2, y: H - 6, "text-anchor": "middle" }, svg);
      t.textContent = cl;
    });
  }

  responsive(container, render);
  return {
    update(d) { data = d; render(); },
    table() {
      return { columns: ["Day", ...data.cols.map((c) => `${c}h`)], rows: data.rows.map((r, i) => [r, ...data.values[i]]) };
    },
    /** Legend element: bins from 1 to max. */
    legend(el) {
      el.replaceChildren();
      const max = Math.max(0, ...data.values.flat());
      htmlEl("span", null, el, "Fewer");
      for (let i = 1; i <= STEPS; i++) { const sw = htmlEl("i", null, el); sw.style.background = `var(--heat-${i})`; }
      htmlEl("span", null, el, max ? `More (max ${max})` : "More");
    },
  };
}

/* ── Sparkline ─────────────────────────────────────────────── */
/** values: numbers; opts: { color, max } */
export function sparkline(container, values, opts = {}) {
  container.replaceChildren();
  const W = container.clientWidth || 120, H = container.clientHeight || 30;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", preserveAspectRatio: "none" }, container);
  if (!values.length) return;
  const max = opts.max ?? Math.max(1, ...values);
  const x = (i) => (values.length === 1 ? W / 2 : 3 + (i / (values.length - 1)) * (W - 6));
  const y = (v) => H - 3 - (v / max) * (H - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  svgEl("path", { d: `${d}L${x(values.length - 1)},${H}L${x(0)},${H}Z`, fill: opts.color || "var(--ink-3)", "fill-opacity": 0.1 }, svg);
  svgEl("path", { d, fill: "none", stroke: opts.color || "var(--ink-3)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }, svg);
  const li = values.length - 1;
  svgEl("circle", { cx: x(li), cy: y(values[li]), r: 3.5, fill: opts.color || "var(--ink-3)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
}

/* ── 100% stacked bar (part-to-whole, ≤ 5 parts) ──────────── */
/** parts: [{ label, value, color, icon }] */
export function stackedBar(container, parts) {
  container.replaceChildren();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) { htmlEl("div", "empty", container, "No reports in this period"); return; }
  const bar = htmlEl("div", null, container);
  bar.style.cssText = "display:flex;gap:2px;height:16px;margin:4px 0 14px;";
  const visible = parts.filter((p) => p.value > 0);
  visible.forEach((p, i) => {
    const seg = htmlEl("div", "mark", bar);
    seg.style.cssText = `flex:${p.value} 0 0;background:${p.color};min-width:4px;`;
    seg.style.borderRadius = `${i === 0 ? "4px 0 0 4px" : "0"}`;
    if (i === visible.length - 1) seg.style.borderRadius = visible.length === 1 ? "4px" : "0 4px 4px 0";
    seg.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, p.label,
      [{ color: p.color, label: "Reports", value: `${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)` }]));
    seg.addEventListener("pointerleave", hideTip);
  });
  const legend = htmlEl("div", null, container);
  legend.style.cssText = "display:grid;gap:8px;";
  for (const p of parts) {
    const row = htmlEl("div", null, legend);
    row.style.cssText = "display:flex;align-items:center;gap:9px;font-size:.86rem;";
    const sw = htmlEl("i", null, row);
    sw.style.cssText = `width:11px;height:11px;border-radius:3px;background:${p.color};flex-shrink:0;`;
    if (p.icon) { const ic = htmlEl("i", `fa-solid ${p.icon}`, row); ic.style.cssText = "color:var(--ink-3);width:14px;"; }
    const l = htmlEl("span", null, row, p.label); l.style.color = "var(--ink-2)";
    const v = htmlEl("b", "num", row, `${fmt(p.value)}`); v.style.marginLeft = "auto";
    const pc = htmlEl("span", "num", row, `${Math.round((p.value / total) * 100)}%`);
    pc.style.cssText = "color:var(--ink-3);min-width:38px;text-align:right;";
  }
}

/* ── Table view (accessible twin) ──────────────────────────── */
export function renderTable(container, { columns, rows }) {
  container.replaceChildren();
  const wrap = htmlEl("div", "scroll", container);
  wrap.style.cssText = "max-height:100%;overflow:auto;";
  const t = htmlEl("table", "data-table", wrap);
  const thead = htmlEl("thead", null, t);
  const hr = htmlEl("tr", null, thead);
  columns.forEach((c, i) => htmlEl("th", i ? "n" : null, hr, c));
  const tb = htmlEl("tbody", null, t);
  if (!rows.length) {
    const tr = htmlEl("tr", null, tb);
    const td = htmlEl("td", null, tr, "No data");
    td.colSpan = columns.length;
  }
  for (const r of rows) {
    const tr = htmlEl("tr", null, tb);
    r.forEach((v, i) => htmlEl("td", i ? "n" : null, tr, typeof v === "number" ? fmt(v) : String(v)));
  }
}

/**
 * Add a "Table" toggle to a chart card.
 * card: element containing .tools; chartEl: the chart container; getTable: () => {columns, rows}
 */
export function tableToggle(card, chartEl, getTable) {
  const tools = card.querySelector(".tools");
  const btn = htmlEl("button", "btn btn-sm", tools);
  btn.type = "button";
  btn.innerHTML = '<i class="fa-solid fa-table" aria-hidden="true"></i><span>Table</span>';
  btn.setAttribute("aria-pressed", "false");
  const tableEl = htmlEl("div", null, chartEl.parentElement);
  tableEl.hidden = true;
  tableEl.style.cssText = `max-height:${Math.max(200, chartEl.clientHeight || 240)}px;overflow:auto;`;
  btn.addEventListener("click", () => {
    const on = tableEl.hidden;
    if (on) renderTable(tableEl, getTable());
    tableEl.hidden = !on;
    chartEl.hidden = on;
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector("span").textContent = on ? "Chart" : "Table";
  });
  return { refresh() { if (!tableEl.hidden) renderTable(tableEl, getTable()); } };
}
