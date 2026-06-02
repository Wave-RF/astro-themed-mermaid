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
}

export interface ThemedMermaid {
  /**
   * Options for rehype-mermaid:
   * `rehypePlugins: [[rehypeMermaid, mermaid.rehypeMermaidOptions]]`.
   */
  rehypeMermaidOptions: Record<string, unknown>;
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
