import type { AstroIntegration } from "astro";

export interface ThemedMermaidFont {
  /** Font family used for build-time SSR measurement (and runtime fallback). */
  family?: string;
  /**
   * Absolute path to a `.woff2`. Inlined into the build-time Chromium with
   * `font-display: block` so Mermaid measures label widths with the real font
   * instead of a fallback (which overflows at runtime).
   */
  woff2?: string;
}

export interface ThemedMermaidConfig {
  /** Mermaid `base` theme variables (build-time colors), passed through untouched. */
  themeVariables?: Record<string, string>;
  /**
   * `classDef …` lines injected after the header of every flowchart/graph block,
   * so source diagrams can use `:::name` without restating the palette.
   */
  classDefs?: string[];
  /**
   * `[from, to]` pairs. Each baked `from` color (hex/rgba exactly as Mermaid
   * serializes it) is rewritten to `to` (typically `var(--…)`) across the
   * emitted SVG, so runtime CSS drives the colors. The ONLY place colors enter.
   */
  colorReplacements?: Array<[string, string]>;
  /** Font used for SSR measurement. */
  font?: ThemedMermaidFont;
  /** Mermaid flowchart config (non-color), e.g. `{ curve: "basis", useMaxWidth: true }`. */
  flowchart?: Record<string, unknown>;
  /** Mermaid sequence config (non-color). */
  sequence?: Record<string, unknown>;
  /** Mermaid `securityLevel` (default `"strict"`). */
  securityLevel?: string;
  /**
   * Directory for the per-diagram render cache used by `rehypeMermaid`
   * (relative paths resolve against the working directory), or `false` to
   * disable caching. Defaults to `node_modules/.cache/astro-themed-mermaid`.
   * Entries are keyed on diagram source + render options + package versions,
   * so theme/toolchain changes invalidate automatically; it is always safe to
   * delete the directory.
   */
  cache?: false | string;
}

export interface ThemedMermaid {
  /**
   * Options for rehype-mermaid:
   * `rehypePlugins: [[rehypeMermaid, mermaid.rehypeMermaidOptions]]`.
   * Prefer `rehypeMermaid` (below), which adds render caching.
   */
  rehypeMermaidOptions: Record<string, unknown>;
  /**
   * Drop-in rehype plugin — add to `markdown.rehypePlugins` directly (no
   * options tuple). Wraps rehype-mermaid with a content-addressed per-diagram
   * render cache: a document whose diagrams are all cached never launches the
   * render browser. See the `cache` config option.
   */
  rehypeMermaid: () => (tree: unknown, file?: unknown) => Promise<void> | undefined;
  /** Remark plugin — add to `markdown.remarkPlugins`. Injects `classDefs`. */
  remarkInjectClassdefs: () => (tree: unknown) => void;
  /** Astro integration — add to `integrations`. Rewrites the built SVGs. */
  integration: AstroIntegration;
}

/**
 * Build-time, theme-aware Mermaid plumbing for Astro / Starlight. Color-agnostic:
 * supply the theme, classDef palette, and hex→CSS-var replacement map; the
 * displayed colors live in your stylesheet.
 */
export function themedMermaid(config?: ThemedMermaidConfig): ThemedMermaid;
