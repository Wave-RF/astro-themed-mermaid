// `astro-themed-mermaid audit` — measurements, not opinions, of the rendered
// flowcharts in the BUILT site:
//   - edge label centers vs. the nearest edge path (centering on lines)
//   - cylinder labels vs. the shape's visual body center
//   - node fill vs. label color, with WCAG contrast ratios (per class set)
//   - subgraph title pill position vs. the cluster rect border
// Writes <out>/audit.json and prints it.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverPages, withThemedPages } from "./cli.mjs";

/** Relative luminance of a hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or rgb()/rgba() color. Pure. */
export function relLum(color) {
  // Defensive: parse 3/4/6/8-digit hex and rgb()/rgba() (comma or space
  // separated), defaulting to black, so a stray value can never crash on a null
  // match or silently poison a contrast number with NaN.
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = color.match(/^#?([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      r = Number.parseInt(h[0] + h[0], 16);
      g = Number.parseInt(h[1] + h[1], 16);
      b = Number.parseInt(h[2] + h[2], 16);
    } else {
      r = Number.parseInt(h.slice(0, 2), 16);
      g = Number.parseInt(h.slice(2, 4), 16);
      b = Number.parseInt(h.slice(4, 6), 16);
    }
  } else {
    const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgb) [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  }
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two colors. Pure. */
export function contrast(c1, c2) {
  const L1 = relLum(c1);
  const L2 = relLum(c2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/** `rgb(r, g, b)` -> `#rrggbb` (other input returned unchanged). Pure. */
export function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) return rgb;
  const [, r, g, b] = m.map(Number);
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG level for a ratio. Pure. */
export function wcagLevel(ratio) {
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "FAIL";
}

// Runs in the page: measure every flowchart in `selector`'s scope.
function measure(selector) {
  const svgCenter = (el) => {
    if (!el?.getBBox) return null;
    const b = el.getBBox();
    const m = el.getScreenCTM();
    if (!m) return null;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return {
      cx: m.a * cx + m.c * cy + m.e,
      cy: m.b * cx + m.d * cy + m.f,
      w: b.width,
      h: b.height,
    };
  };
  const bbox = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
    };
  };
  const GENERIC = new Set([
    "node",
    "default",
    "flowchart-label",
    "clickable",
    "statediagram-state",
  ]);
  const diagrams = [];
  for (const svg of document.querySelectorAll(selector)) {
    if (!(svg.getAttribute("aria-roledescription") || "").startsWith("flowchart")) continue;
    const cylinders = [];
    for (const n of svg.querySelectorAll(".node:has(> path.basic.label-container)")) {
      const path = n.querySelector("path.basic.label-container");
      const label = n.querySelector(".label foreignObject");
      if (!path || !label) continue;
      const p = svgCenter(path);
      const l = svgCenter(label);
      if (!p || !l) continue;
      cylinders.push({
        text: n.querySelector(".nodeLabel p")?.textContent?.trim() || "",
        path_center_y: Math.round(p.cy),
        label_center_y: Math.round(l.cy),
        offset_y: Math.round(l.cy - p.cy),
        path_height: Math.round(p.h),
      });
    }
    const edges = [];
    for (const el of svg.querySelectorAll(".edgeLabel")) {
      const p = el.querySelector("span.edgeLabel p, .nodeLabel p");
      const text = p?.textContent?.trim();
      if (!text) continue;
      const lb = bbox(p);
      let nearest = null;
      let best = Number.POSITIVE_INFINITY;
      for (const path of svg.querySelectorAll(".flowchart-link, .edgePath .path")) {
        const r = path.getBoundingClientRect();
        const d = Math.hypot(r.x + r.width / 2 - lb.cx, r.y + r.height / 2 - lb.cy);
        if (d < best) {
          best = d;
          nearest = r;
        }
      }
      if (!nearest) continue;
      edges.push({
        text,
        dx: Math.round(lb.cx - (nearest.x + nearest.width / 2)),
        dy: Math.round(lb.cy - (nearest.y + nearest.height / 2)),
      });
    }
    const seen = new Set();
    const contrastChecks = [];
    for (const node of svg.querySelectorAll(".node")) {
      const classes = [...node.classList].filter(
        (c) => !GENERIC.has(c) && !/^(flowchart|default)-/.test(c)
      );
      const shape =
        node.querySelector("rect.basic.label-container") ||
        node.querySelector("path.basic.label-container");
      const textEl = node.querySelector(".nodeLabel p");
      if (!shape || !textEl) continue;
      const fill = getComputedStyle(shape).fill;
      const text = getComputedStyle(textEl).color;
      const key = `${classes.join(".")}|${fill}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contrastChecks.push({ class: classes.join(" ") || "(none)", fill, text });
    }
    const titles = [];
    for (const cluster of svg.querySelectorAll(".cluster")) {
      const rect = cluster.querySelector("rect");
      const labelP = cluster.querySelector(".cluster-label .nodeLabel p");
      if (!rect || !labelP) continue;
      const r = bbox(rect);
      const l = bbox(labelP);
      titles.push({
        text: labelP.textContent?.trim(),
        straddles_top: l.y < r.y && l.y + l.h > r.y,
        gap_to_rect_top: Math.round(l.y + l.h - r.y),
        title_height: Math.round(l.h),
      });
    }
    diagrams.push({ cylinders, edges, contrastChecks, titles });
  }
  return diagrams;
}

export async function run(opts) {
  const pages = await discoverPages(resolve(opts.dist), opts.pages);
  if (pages.length === 0) {
    console.log("no built pages with diagrams found");
    return;
  }
  const audit = [];
  await withThemedPages(opts, 1, async (open) => {
    for (const theme of opts.themes) {
      const { ctx, page } = await open(theme);
      for (const p of pages) {
        await page.goto(pathToFileURL(p.file).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts?.ready);
        const diagrams = await page.evaluate(measure, opts.selector);
        diagrams.forEach((d, i) => {
          for (const c of d.contrastChecks) {
            c.fill_hex = rgbToHex(c.fill);
            c.text_hex = rgbToHex(c.text);
            c.ratio = +contrast(c.fill_hex, c.text_hex).toFixed(2);
            c.wcag = wcagLevel(c.ratio);
          }
          audit.push({ page: p.slug, theme, diagram: i + 1, ...d });
        });
      }
      await ctx.close();
    }
  });
  const report = JSON.stringify(audit, null, 2);
  const out = resolve(opts.out);
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "audit.json"), report);
  console.log(report);
}
