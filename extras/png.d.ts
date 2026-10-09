import type { AstroIntegration } from "astro";

export interface DiagramPngVariant {
  /** Filename suffix, e.g. `""` or `"-transparent"`. */
  suffix: string;
  /** Render with a transparent background instead of the surface card. */
  transparent: boolean;
}

export interface DiagramPngOptions {
  /**
   * CSS selector matching each diagram on a built page. MUST be the same as the
   * lightbox's `selector` (both default to the same value). Default
   * `svg[data-themed-mermaid]`; Starlight:
   * `.sl-markdown-content svg[data-themed-mermaid]`.
   */
  selector?: string;
  /** Theme names, one PNG set each. Default `["light", "dark"]`. */
  themes?: string[];
  /** Attribute set on `<html>` to select a theme. Default `"data-theme"`. */
  themeAttr?: string;
  /**
   * localStorage key the host site reads its theme from (Starlight:
   * `"starlight-theme"`). Default `null` (don't touch localStorage).
   */
  themeStorageKey?: string | null;
  /** CSS custom property holding the solid card background. Default `"--mermaid-surface"`. */
  surfaceVar?: string;
  /** Device scale factor. Default `2`. */
  scale?: number;
  /** Card padding in CSS px. Default `28`. */
  pad?: number;
  /** Cap on a diagram's CSS-px long edge. Default `2400`. */
  maxDim?: number;
  /** Variants rendered per diagram. Default: solid + `-transparent`. */
  variants?: DiagramPngVariant[];
  /** Directory under the build output (and URL path) for the PNGs. Default `"diagrams"`. */
  outDir?: string;
  /**
   * Render cache dir (relative to the project root) or `false` to disable.
   * Default `"node_modules/.cache/astro-themed-mermaid-png"`.
   */
  cacheDir?: false | string;
  /**
   * Write `data-png-<theme>[-transparent]` attributes (site URLs, honouring
   * Astro `base` and `outDir`) onto each diagram in the built HTML, only for
   * PNGs that were actually produced. Lets a site with its own lightbox wire up
   * Copy/Download. Needs diagrams carrying the `data-themed-mermaid` marker.
   * Default `true`.
   */
  dataAttributes?: boolean;
  /** Env var that skips the export when set to `"1"`. Default `"ASTRO_THEMED_MERMAID_SKIP_PNG"`. */
  skipEnv?: string;
}

export const PNG_DEFAULTS: Readonly<Required<DiagramPngOptions>>;
export const SKIP_ENV: string;
export const DEFAULT_SELECTOR: string;
export function resolvePngOptions(options?: DiagramPngOptions): Required<DiagramPngOptions>;
export function stampPngAttributes(
  html: string,
  entries: Map<number, Record<string, string>>
): string;
export function extractDiagramSvgs(html: string): string[];
export function diagramHash(html: string, theme: string, cfg?: DiagramPngOptions): string;
export { pngFileName, pngRelPath } from "./shared.js";

/**
 * Astro integration: after the build, rasterize every Mermaid diagram to
 * light/dark (and transparent) PNGs at `<outDir>/<slug>/<index>-<theme>[-transparent].png`.
 * Needs the optional peer dependency `playwright` (with Chromium).
 */
export function diagramPng(options?: DiagramPngOptions): AstroIntegration;
