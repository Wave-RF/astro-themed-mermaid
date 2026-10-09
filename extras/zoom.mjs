// Click-to-zoom lightbox for Mermaid diagrams (`@wave-rf/astro-themed-mermaid/zoom`).
//
// An Astro integration: it injects the lightbox script (./client.mjs) and its
// stylesheet (./zoom.css) into every page, so there is no component to mount
// in a layout or footer. All behaviour is configured here, once, and handed to
// the client as JSON.
//
// The lightbox indexes diagrams by the SAME selector the PNG integration uses
// (both default to DEFAULT_SELECTOR from ./shared.mjs), so "diagram N" is the
// same diagram on both sides and Copy/Download fetch the right file.

import {
  DEFAULT_OUT_DIR,
  DEFAULT_SELECTOR,
  DEFAULT_THEME_ATTR,
  DEFAULT_THEMES,
  normalizeBase,
} from "./shared.mjs";

/** Visible/accessible strings. Override any subset (i18n). */
export const DEFAULT_LABELS = Object.freeze({
  dialog: "Enlarged diagram",
  close: "Close enlarged diagram",
  natural: "Toggle natural size (pan to explore)",
  transparent: "Toggle transparent background for copy and download",
  copy: "Copy diagram as PNG",
  download: "Download diagram as PNG",
  copied: "Copied to clipboard",
  downloaded: "Downloaded PNG",
  unavailable: "PNG unavailable",
  exportTransparent: "Export: transparent background",
  exportSolid: "Export: solid background",
});

/**
 * @typedef {object} DiagramZoomOptions
 * @property {string} [selector] CSS selector matching each diagram. MUST match the PNG integration's. Default `svg[data-themed-mermaid]`.
 * @property {boolean} [png] Show Copy/Download/background buttons when the build-time PNG exists (needs `diagramPng`). Default `true`.
 * @property {string} [outDir] Where `diagramPng` wrote the PNGs. Default `diagrams`.
 * @property {string[]} [themes] Theme names PNGs exist for. Default `["light","dark"]`.
 * @property {string} [themeAttr] Attribute that carries the host's theme. Default `data-theme`.
 * @property {string} [themeTarget] Selector of the element carrying that attribute. Default `html`.
 * @property {string} [filenamePrefix] Prefix for downloaded filenames. Default `""`.
 * @property {boolean} [css] Inject the bundled `zoom.css`. Default `true`; set `false` to supply your own.
 * @property {Partial<typeof DEFAULT_LABELS>} [labels] UI strings.
 */

export const ZOOM_DEFAULTS = Object.freeze({
  selector: DEFAULT_SELECTOR,
  png: true,
  outDir: DEFAULT_OUT_DIR,
  themes: DEFAULT_THEMES,
  themeAttr: DEFAULT_THEME_ATTR,
  themeTarget: "html",
  filenamePrefix: "",
  css: true,
  labels: DEFAULT_LABELS,
});

/** Merge options over defaults, validate, and attach the site `base`. Pure. */
export function resolveZoomOptions(options = {}, base = "") {
  const cfg = { ...ZOOM_DEFAULTS };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) cfg[k] = v;
  if (typeof cfg.selector !== "string" || !cfg.selector) {
    throw new TypeError("diagramZoom: `selector` must be a non-empty string");
  }
  if (!Array.isArray(cfg.themes) || cfg.themes.length === 0) {
    throw new TypeError("diagramZoom: `themes` must be a non-empty array");
  }
  cfg.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
  cfg.base = normalizeBase(base);
  return cfg;
}

/**
 * @param {DiagramZoomOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export function diagramZoom(options = {}) {
  // Validate eagerly so a bad option fails at config load, not at build.
  resolveZoomOptions(options);
  return {
    name: "astro-themed-mermaid-zoom",
    hooks: {
      "astro:config:setup": ({ config, injectScript }) => {
        const cfg = resolveZoomOptions(options, config.base);
        const { css, ...clientOpts } = cfg;
        // Stylesheet via "page-ssr" (imported into every page module, so Astro
        // links it into the HTML). A CSS import inside a "page" script is built
        // but never linked into the page.
        if (css) injectScript("page-ssr", 'import "@wave-rf/astro-themed-mermaid/zoom.css";');
        injectScript(
          "page",
          [
            'import { initDiagramZoom } from "@wave-rf/astro-themed-mermaid/zoom/client";',
            `initDiagramZoom(${JSON.stringify(clientOpts)});`,
          ].join("\n")
        );
      },
    },
  };
}

export { DEFAULT_SELECTOR };
