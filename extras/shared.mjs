// Pure helpers shared by the PNG integration (png.mjs), the zoom lightbox
// (zoom.mjs + client.mjs) and the dev tools (tools/*). No Node-only or
// browser-only imports: this file is bundled into the browser by Vite (via
// client.mjs) AND loaded by Node, and `node --test` exercises it directly.
//
// The contract the PNG integration and the lightbox share is the diagram
// SELECTOR and the on-disk path scheme. Both sides import them from here, so
// "diagram index N" means the same diagram on both sides by construction.

/**
 * Attribute the package's own `rehypeMermaid` stamps on every `<svg>` it
 * renders (fresh or from cache), and that the build-time integration adds to any
 * Mermaid SVG that reached the page unstamped. It is what tells "a diagram this
 * package rendered" apart from any other SVG, so the PNG export, the lightbox
 * and the CLI tools all select on it.
 */
export const MARKER_ATTR = "data-themed-mermaid";

/** The same attribute as a hast property name (what the rehype pass sets). */
export const MARKER_PROP = "dataThemedMermaid";

/**
 * Selector matching every diagram this package rendered. Narrow it (e.g.
 * `article svg[data-themed-mermaid]`) to restrict to a content area; pass the
 * SAME value to `diagramPng` and `diagramZoom`.
 */
export const DEFAULT_SELECTOR = `svg[${MARKER_ATTR}]`;

/** Prefix of the per-diagram PNG URL attributes (`data-png-<theme>[-transparent]`). */
export const PNG_ATTR_PREFIX = "data-png-";

/** Attribute name carrying the PNG URL for a theme/variant. */
export function pngAttrName(theme, transparent = false) {
  return `${PNG_ATTR_PREFIX}${theme}${transparent ? TRANSPARENT_SUFFIX : ""}`;
}

/** Directory (under the build output) PNGs are written to, and served from. */
export const DEFAULT_OUT_DIR = "diagrams";

/** Filename suffix of the transparent-background variant. */
export const TRANSPARENT_SUFFIX = "-transparent";

/** Theme names rendered / probed by default. */
export const DEFAULT_THEMES = ["light", "dark"];

/** Attribute the host site sets on the theme target to select a theme. */
export const DEFAULT_THEME_ATTR = "data-theme";

/** Each diagram is rasterized once per variant. */
export const DEFAULT_VARIANTS = [
  { suffix: "", transparent: false },
  { suffix: TRANSPARENT_SUFFIX, transparent: true },
];

/** Strip leading/trailing slashes. */
export function trimSlashes(s) {
  return String(s ?? "").replace(/^\/+|\/+$/g, "");
}

/** Normalize an Astro `base` ("", "/", "docs", "/docs/") to "" or "/docs". */
export function normalizeBase(base) {
  const t = trimSlashes(base);
  return t ? `/${t}` : "";
}

/**
 * Page slug used in PNG paths: the page pathname minus the site `base`, with
 * slashes, a trailing `index.html`/`.html` and the empty root normalized.
 * `/` -> "index", `/guide/intro/` -> "guide/intro", `/docs/a.html` (base
 * `/docs`) -> "a".
 */
export function diagramSlug(pathname, base = "") {
  let p = String(pathname ?? "");
  const b = normalizeBase(base);
  if (b && (p === b || p.startsWith(`${b}/`))) p = p.slice(b.length);
  p = trimSlashes(p)
    .replace(/(^|\/)index\.html$/, "")
    .replace(/\.html$/, "");
  return trimSlashes(p) || "index";
}

/** `<index>-<theme>[-transparent].png` */
export function pngFileName(index, theme, transparent = false) {
  return `${index}-${theme}${transparent ? TRANSPARENT_SUFFIX : ""}.png`;
}

/** Path of a PNG relative to the build output dir: `<outDir>/<slug>/<file>`. */
export function pngRelPath({ outDir = DEFAULT_OUT_DIR, slug, index, theme, transparent = false }) {
  return `${trimSlashes(outDir)}/${slug}/${pngFileName(index, theme, transparent)}`;
}

/** Site URL of a PNG (what the lightbox fetches): `<base>/<outDir>/<slug>/<file>`. */
export function pngUrl({ base = "", ...rest }) {
  return `${normalizeBase(base)}/${pngRelPath(rest)}`;
}

/** Suggested download name: `[prefix-]<slug with / as ->-diagram-<n>[-transparent].png`. */
export function downloadName({ prefix = "", slug, index, transparent = false }) {
  const parts = [trimSlashes(prefix), slug.replace(/\//g, "-"), "diagram", String(index + 1)];
  return `${parts.filter(Boolean).join("-")}${transparent ? TRANSPARENT_SUFFIX : ""}.png`;
}

/**
 * Pick the theme name to request a PNG for. `attrValue` is the host's theme
 * attribute (or null). If it names a known theme, use it; otherwise follow the
 * OS preference (`prefersDark`), falling back to the first/last configured
 * theme when the OS answer isn't one of them.
 */
export function resolveTheme(attrValue, themes = DEFAULT_THEMES, prefersDark = false) {
  if (attrValue && themes.includes(attrValue)) return attrValue;
  const want = prefersDark ? "dark" : "light";
  if (themes.includes(want)) return want;
  return themes[0];
}
