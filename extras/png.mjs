// Build-time PNG export for Mermaid diagrams (`@wave-rf/astro-themed-mermaid/png`).
//
// The main plugin renders each diagram to inline, theme-reactive SVG. Inline SVG
// reads well (selectable text, real structure, colors follow the light/dark
// toggle) but you can't right-click "Copy/Save image" an inline <svg>, and it
// doesn't drop into a slide deck. This integration ALSO emits a PNG of every
// diagram, which the zoom lightbox (`/zoom`) surfaces as Copy/Download buttons.
//
// Why a post-build pass and not the SVG plugin: the plugin is deliberately
// color-agnostic — its SVGs carry `var(--mermaid-*)` placeholders resolved at
// runtime from the host stylesheet, so at plugin time there are no concrete
// colors and no light/dark split. A WYSIWYG light+dark PNG has to be rasterized
// where the stylesheet is applied and a theme is set: against the BUILT page in
// a real browser.
//
// How a diagram is captured: navigate to the built page (stylesheet + fonts
// load, theme is set), read each diagram's SVG markup, then render that SVG
// ALONE — replace the page <body> with just the diagram on a padded card and
// screenshot it. No site chrome sits behind the card, so the transparent variant
// needs no per-element hiding and no knowledge of the host theme's DOM. The
// diagram keeps its look because its colors come from :root custom properties
// and its label fonts from document @font-face — both in <head>, left intact.
//
// Output: <outDir>/<slug>/<index>-<theme>[-transparent].png, where <slug> is the
// page path and <index> is the diagram's position among `selector` matches —
// the same selector the lightbox uses (both default to DEFAULT_SELECTOR from
// ./shared.mjs), so both sides agree on which PNG belongs to which diagram.
//
// Playwright is an OPTIONAL peer dependency, loaded lazily from the consumer's
// project only when a diagram actually needs rendering.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findHtml, loadChromium, routeDistAssets, themeInitScript } from "./browser.mjs";
import {
  DEFAULT_OUT_DIR,
  DEFAULT_SELECTOR,
  DEFAULT_THEME_ATTR,
  DEFAULT_THEMES,
  DEFAULT_VARIANTS,
  diagramSlug,
  pngFileName,
  pngRelPath,
} from "./shared.mjs";

// Bump to invalidate every cached PNG after a change to the render routine.
const RENDER_VERSION = "1";

/** Env var that, when "1", skips the export (e.g. fast CI jobs, dev loops). */
export const SKIP_ENV = "ASTRO_THEMED_MERMAID_SKIP_PNG";

/**
 * @typedef {object} DiagramPngOptions
 * @property {string} [selector] CSS selector matching each diagram on a built page. MUST match the lightbox's. Default `svg[aria-roledescription]`.
 * @property {string[]} [themes] Theme names, one PNG set each. Default `["light","dark"]`.
 * @property {string} [themeAttr] Attribute set on `<html>` to select a theme. Default `data-theme`.
 * @property {string|null} [themeStorageKey] localStorage key the host reads its theme from (Starlight: `starlight-theme`). Default `null` (none).
 * @property {string} [surfaceVar] CSS custom property holding the solid card background. Default `--mermaid-surface`.
 * @property {number} [scale] Device scale factor. Default `2`.
 * @property {number} [pad] Card padding in CSS px. Default `28`.
 * @property {number} [maxDim] Cap on a diagram's CSS-px long edge. Default `2400`.
 * @property {Array<{suffix:string,transparent:boolean}>} [variants] Variants rendered per diagram. Default solid + `-transparent`.
 * @property {string} [outDir] Directory under the build output. Default `diagrams`.
 * @property {false|string} [cacheDir] Render cache dir (relative to the project root), or `false`. Default `node_modules/.cache/astro-themed-mermaid-png`.
 * @property {string} [skipEnv] Env var that skips the export when `"1"`. Default `ASTRO_THEMED_MERMAID_SKIP_PNG`.
 */

export const PNG_DEFAULTS = Object.freeze({
  selector: DEFAULT_SELECTOR,
  themes: DEFAULT_THEMES,
  themeAttr: DEFAULT_THEME_ATTR,
  themeStorageKey: null,
  surfaceVar: "--mermaid-surface",
  scale: 2,
  pad: 28,
  maxDim: 2400,
  variants: DEFAULT_VARIANTS,
  outDir: DEFAULT_OUT_DIR,
  cacheDir: "node_modules/.cache/astro-themed-mermaid-png",
  skipEnv: SKIP_ENV,
});

/** Merge options over defaults and validate. Pure. */
export function resolvePngOptions(options = {}) {
  const cfg = { ...PNG_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) cfg[k] = v;
  if (!Array.isArray(cfg.themes) || cfg.themes.length === 0) {
    throw new TypeError("diagramPng: `themes` must be a non-empty array");
  }
  if (!Array.isArray(cfg.variants) || cfg.variants.length === 0) {
    throw new TypeError("diagramPng: `variants` must be a non-empty array");
  }
  if (typeof cfg.selector !== "string" || !cfg.selector) {
    throw new TypeError("diagramPng: `selector` must be a non-empty string");
  }
  for (const k of ["scale", "pad", "maxDim"]) {
    const min = k === "pad" ? 0 : Number.MIN_VALUE;
    if (!(typeof cfg[k] === "number" && cfg[k] >= min && Number.isFinite(cfg[k]))) {
      throw new TypeError(
        `diagramPng: \`${k}\` must be ${k === "pad" ? "a non-negative" : "a positive"} number`
      );
    }
  }
  return cfg;
}

/**
 * Every Mermaid diagram `<svg>` in `html`, whole (nesting-aware: a diagram that
 * contains inner `<svg>` icons ends at its own closing tag). Pure.
 */
export function extractDiagramSvgs(html) {
  const out = [];
  const open = /<svg\b[^>]*aria-roledescription/g;
  const tag = /<(\/?)svg\b/g;
  let m = open.exec(html);
  while (m) {
    tag.lastIndex = m.index;
    let depth = 0;
    let end = html.length;
    for (let t = tag.exec(html); t; t = tag.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = html.indexOf(">", t.index) + 1;
        break;
      }
    }
    out.push(html.slice(m.index, end));
    open.lastIndex = Math.max(end, m.index + 1);
    m = open.exec(html);
  }
  return out;
}

/**
 * What styles the page: inline `<style>` text plus the contents of every linked
 * stylesheet, however it is served (hashed `/_astro/*.css`, `public/`, or
 * inlined). `readLocal(href)` returns a local stylesheet's text or null. Pure
 * apart from `readLocal`.
 */
export function stylesFingerprint(html, readLocal = () => null) {
  const parts = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) parts.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/rel=["']?stylesheet/i.test(m[0])) continue;
    const href = m[0].match(/href=["']?([^"'\s>]+)/i)?.[1];
    if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue;
    parts.push(`${href}:${readLocal(href.split(/[?#]/)[0]) ?? ""}`);
  }
  return createHash("sha1").update(parts.join("\u0000")).digest("hex");
}

/**
 * Hash of only what changes the rendered PNG: the diagram markup, the page's
 * styles (see stylesFingerprint), the theme, the render settings, and
 * RENDER_VERSION. Hashing the whole page would bust the cache on unrelated prose
 * edits. Pure.
 */
export function diagramHash(html, theme, cfg = PNG_DEFAULTS, readLocal) {
  const svgs = extractDiagramSvgs(html);
  const settings = JSON.stringify([
    cfg.selector,
    cfg.themeAttr,
    cfg.themeStorageKey,
    cfg.surfaceVar,
    cfg.scale,
    cfg.pad,
    cfg.maxDim,
    cfg.variants,
  ]);
  return createHash("sha1")
    .update(
      `${RENDER_VERSION}|${theme}|${settings}|${stylesFingerprint(html, readLocal)}|${svgs.join(" ")}`
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * @param {DiagramPngOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export function diagramPng(options = {}) {
  const cfg = resolvePngOptions(options);
  let root = process.cwd();
  let base = "";
  return {
    name: "astro-themed-mermaid-png",
    hooks: {
      "astro:config:done": ({ config, logger }) => {
        root = fileURLToPath(config.root);
        base = config.base ?? "";
        // build:done hooks run in config order: if we run first we'd rasterize
        // the not-yet-themed SVG (baked colors, no light/dark split).
        const names = (config.integrations ?? []).map((i) => i.name);
        const core = names.indexOf("astro-themed-mermaid");
        const me = names.indexOf("astro-themed-mermaid-png");
        if (core !== -1 && me !== -1 && me < core) {
          logger.warn(
            "diagramPng() is listed before the themedMermaid integration; list it LAST so it sees the rewritten SVG."
          );
        }
      },
      "astro:build:done": async ({ dir, pages, logger }) => {
        if (process.env[cfg.skipEnv] === "1") {
          logger.info(`skipped (${cfg.skipEnv}=1)`);
          return;
        }
        try {
          await run({ dir, pages, logger, cfg, root, base });
        } catch (err) {
          // A browser hiccup must not fail the whole build — the site is already
          // written; we just don't get fresh PNGs this run.
          logger.warn(`diagram PNG export skipped: ${err?.stack || err}`);
        }
      },
    },
  };
}

async function run({ dir, pages, logger, cfg, root, base }) {
  const distDir = fileURLToPath(dir);

  // Resolve routes → HTML files, keep only the ones that actually have a
  // diagram. No browser is launched for the rest.
  const diagramPages = [];
  for (const { pathname } of pages ?? []) {
    const slug = diagramSlug(pathname);
    const file = findHtml(distDir, slug);
    if (!file) continue;
    const html = await readFile(file, "utf8");
    // Match the ATTRIBUTE form a real diagram emits (`aria-roledescription="…"`);
    // the bare token can also appear as a selector string in a script.
    if (!html.includes('aria-roledescription="')) continue;
    diagramPages.push({ slug, file, html });
  }
  if (diagramPages.length === 0) return;

  const readLocal = (href) => {
    try {
      const f = resolve(
        distDir,
        `.${href.startsWith("/") ? "" : "/"}${href.startsWith("/") ? href : `/${href}`}`
      );
      return readFileSync(f, "utf8");
    } catch {
      return null;
    }
  };

  const cacheDir = cfg.cacheDir === false ? null : join(root, cfg.cacheDir);
  const manifestPath = cacheDir && join(cacheDir, "manifest.json");
  const manifest = cacheDir ? readJson(manifestPath) : {};

  // Split work into cache hits (just copy bytes into the fresh output) and
  // misses (need Chromium). The output dir is wiped each build, so even cached
  // diagrams must be re-placed — the cache only saves the screenshot.
  const toCopy = [];
  const toRender = [];
  for (const page of diagramPages) {
    for (const theme of cfg.themes) {
      const hash = diagramHash(page.html, theme, cfg, readLocal);
      const entry = manifest[`${page.slug}|${theme}`];
      const cached =
        cacheDir &&
        entry &&
        entry.hash === hash &&
        Array.from({ length: entry.count }).every((_, i) =>
          cfg.variants.every((v) =>
            existsSync(join(cacheDir, `${hash}-${i}-${theme}${v.suffix}.png`))
          )
        );
      if (cached) toCopy.push({ ...page, theme, hash, count: entry.count });
      else toRender.push({ ...page, theme, hash });
    }
  }

  const outPath = (slug, i, theme, v) =>
    join(
      distDir,
      pngRelPath({ outDir: cfg.outDir, slug, index: i, theme, transparent: v.transparent })
    );

  for (const job of toCopy) {
    for (let i = 0; i < job.count; i++) {
      for (const v of cfg.variants) {
        try {
          await place(
            join(cacheDir, `${job.hash}-${i}-${job.theme}${v.suffix}.png`),
            outPath(job.slug, i, job.theme, v)
          );
        } catch {
          // cache entry vanished: fall back to rendering this job instead
          toRender.push({ ...job });
          break;
        }
      }
    }
  }

  let made = 0;
  const cacheOk = true;
  if (toRender.length > 0) {
    const chromium = loadChromium(root);
    const browser = await chromium.launch();
    try {
      for (const theme of cfg.themes) {
        const jobs = toRender.filter((j) => j.theme === theme);
        if (jobs.length === 0) continue;
        const ctx = await browser.newContext({
          viewport: { width: 1800, height: 1200 },
          deviceScaleFactor: cfg.scale,
          colorScheme: theme === "light" || theme === "dark" ? theme : undefined,
        });
        // Set the theme the way the host site does (optional localStorage key +
        // the attribute on <html>) before first paint, so the stylesheet's
        // per-theme branch — and thus the diagram colors — is correct.
        await ctx.addInitScript(themeInitScript, {
          t: theme,
          attr: cfg.themeAttr,
          key: cfg.themeStorageKey,
        });
        const page = await ctx.newPage();
        // `load`, not `networkidle`: some pages hold a long-lived connection that
        // never goes idle. Diagrams are pre-rendered static SVG, so `load` +
        // fonts.ready is all we need.
        page.setDefaultNavigationTimeout(20000);
        // Cap non-navigation actions too, so one wedged capture fails fast into
        // the per-job catch instead of stalling 30s.
        page.setDefaultTimeout(20000);
        await routeDistAssets(page, distDir, base);

        for (const job of jobs) {
          try {
            await page.goto(pathToFileURL(job.file).href, { waitUntil: "load" });
            await page.evaluate(() => document.fonts?.ready);
            // Read every diagram's markup + intrinsic size NOW, before the first
            // render empties the body (rendering one destroys the others).
            const diagrams = await extractDiagrams(page, cfg.selector);
            for (let i = 0; i < diagrams.length; i++) {
              for (const v of cfg.variants) {
                const buf = await renderPng(page, diagrams[i], v, cfg);
                await write(outPath(job.slug, i, theme, v), buf);
                if (cacheDir)
                  await write(join(cacheDir, `${job.hash}-${i}-${theme}${v.suffix}.png`), buf);
                made++;
              }
            }
            // In-memory only; flushed once after every theme finishes (a
            // mid-run kill just re-renders next build).
            if (cacheOk)
              manifest[`${job.slug}|${theme}`] = { hash: job.hash, count: diagrams.length };
          } catch (err) {
            // One stubborn page shouldn't sink the rest of the export.
            logger.warn(`diagram PNGs: ${job.slug} [${theme}] skipped — ${err?.message || err}`);
          }
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
    if (cacheDir) {
      await write(manifestPath, JSON.stringify(manifest, null, 2)).catch((err) =>
        logger.warn(`diagram PNGs: render cache not saved — ${err?.message || err}`)
      );
    }
  }

  const reused = toCopy.reduce((n, j) => n + j.count * cfg.variants.length, 0);
  logger.info(
    `diagram PNGs: ${made} rendered, ${reused} cached → ${cfg.outDir}/ (${cfg.themes.join(", ")} × ${cfg.variants.map((v) => v.suffix || "solid").join("+")})`
  );
}

// Read each diagram's SVG outerHTML + intrinsic size from the live (still-intact)
// page. Must run before any renderPng() call, which empties the <body>.
function extractDiagrams(page, selector) {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((svg) => {
      const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const rect = svg.getBoundingClientRect();
      return {
        markup: svg.outerHTML,
        natW: vb.length === 4 && vb[2] ? vb[2] : rect.width,
        natH: vb.length === 4 && vb[3] ? vb[3] : rect.height,
      };
    });
  }, selector);
}

// Render ONE diagram to PNG: drop its SVG onto a padded card (surface bg, or
// transparent for the export variant), replace the whole <body> with just that
// card, and screenshot it. <head> is untouched, so the diagram's themed fills
// (:root custom properties) and label fonts (@font-face) still resolve; the
// SVG's own scoped <style> carries the rest.
async function renderPng(page, diagram, { transparent }, cfg) {
  const box = await page.evaluate(
    ({ markup, natW, natH, transparent, pad, maxDim, surfaceVar }) => {
      const long = Math.max(natW, natH);
      const scale = long > maxDim ? maxDim / long : 1;

      const card = document.createElement("div");
      card.id = "__atm_pngshot";
      card.style.cssText =
        `position:fixed;left:0;top:0;padding:${pad}px;` +
        (transparent ? "background:transparent;" : `background:var(${surfaceVar});`) +
        "display:inline-block;box-sizing:content-box;line-height:0;margin:0;border:0;";
      card.innerHTML = markup;
      const clone = card.firstElementChild;
      clone.style.maxWidth = "none";
      clone.style.minWidth = "0";
      clone.style.display = "block";
      clone.style.width = `${Math.round(natW * scale)}px`;
      clone.style.height = `${Math.round(natH * scale)}px`;

      // The card is now the ENTIRE body — no chrome behind it. Reset the
      // html/body background too: their opaque themed bg would otherwise show
      // through a transparent card.
      document.documentElement.style.background = "transparent";
      document.body.style.cssText = "margin:0;padding:0;background:transparent;";
      document.body.replaceChildren(card);

      // Clip to the card's MEASURED rect rather than assuming top-left.
      const r = card.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.left)),
        y: Math.max(0, Math.floor(r.top)),
        width: Math.ceil(r.width),
        height: Math.ceil(r.height),
      };
    },
    {
      markup: diagram.markup,
      natW: diagram.natW,
      natH: diagram.natH,
      transparent,
      pad: cfg.pad,
      maxDim: cfg.maxDim,
      surfaceVar: cfg.surfaceVar,
    }
  );

  // Grow the viewport if the card overflows it, else the clip is truncated.
  const vp = page.viewportSize();
  const needW = box.x + box.width + 4;
  const needH = box.y + box.height + 4;
  if (vp.width < needW || vp.height < needH) {
    await page.setViewportSize({
      width: Math.max(vp.width, needW),
      height: Math.max(vp.height, needH),
    });
  }
  return page.screenshot({ type: "png", clip: box, omitBackground: transparent });
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

async function write(p, data) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

async function place(src, dst) {
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}

export { DEFAULT_SELECTOR, pngFileName, pngRelPath };
