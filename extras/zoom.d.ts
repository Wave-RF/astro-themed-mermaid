import type { AstroIntegration } from "astro";

export interface DiagramZoomLabels {
  dialog: string;
  close: string;
  natural: string;
  transparent: string;
  copy: string;
  download: string;
  copied: string;
  downloaded: string;
  unavailable: string;
  exportTransparent: string;
  exportSolid: string;
}

export interface DiagramZoomOptions {
  /**
   * CSS selector matching each diagram. MUST be the same as `diagramPng`'s
   * `selector` (both default to the same value) so diagram N is the same
   * diagram on both sides. Default `svg[aria-roledescription]`.
   */
  selector?: string;
  /** Show Copy/Download/background buttons when the build-time PNG exists. Default `true`. */
  png?: boolean;
  /** Where `diagramPng` wrote the PNGs. Default `"diagrams"`. */
  outDir?: string;
  /** Theme names PNGs exist for. Default `["light", "dark"]`. */
  themes?: string[];
  /** Attribute carrying the host's theme. Default `"data-theme"`. When unset on the page, falls back to `prefers-color-scheme`. */
  themeAttr?: string;
  /** Selector of the element carrying that attribute. Default `"html"`. */
  themeTarget?: string;
  /** Prefix for downloaded filenames. Default `""`. */
  filenamePrefix?: string;
  /** Inject the bundled `zoom.css`. Default `true`; `false` to supply your own. */
  css?: boolean;
  /** UI strings; any subset. */
  labels?: Partial<DiagramZoomLabels>;
}

export const DEFAULT_LABELS: Readonly<DiagramZoomLabels>;
export const ZOOM_DEFAULTS: Readonly<
  Required<Omit<DiagramZoomOptions, "labels">> & { labels: DiagramZoomLabels }
>;
export const DEFAULT_SELECTOR: string;
export function resolveZoomOptions(
  options?: DiagramZoomOptions,
  base?: string
): Required<Omit<DiagramZoomOptions, "labels">> & { labels: DiagramZoomLabels; base: string };

/**
 * Astro integration: injects a click-to-zoom lightbox (fit-to-viewport, 1:1
 * pan, Copy/Download of the build-time PNG) for every Mermaid diagram.
 */
export function diagramZoom(options?: DiagramZoomOptions): AstroIntegration;
