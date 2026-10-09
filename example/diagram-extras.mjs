// Example: wiring the optional extras next to the core plugin (astro.config.mjs).
//
//   import { defineConfig } from "astro/config";
//   import { themedMermaid } from "@wave-rf/astro-themed-mermaid";
//   import { diagramPng } from "@wave-rf/astro-themed-mermaid/png";
//   import { diagramZoom } from "@wave-rf/astro-themed-mermaid/zoom";
//   import { mermaidTheme } from "./example/mermaid-theme.mjs";
//
//   const mermaid = themedMermaid(mermaidTheme);
//   const { selector, png, zoom } = diagramExtras;
//
//   export default defineConfig({
//     markdown: { remarkPlugins: [mermaid.remarkInjectClassdefs], rehypePlugins: [mermaid.rehypeMermaid] },
//     integrations: [mermaid.integration, diagramZoom(zoom), diagramPng(png)],
//   });
//
// Also import the lightbox stylesheet once if you pass `css: false`:
//   import "@wave-rf/astro-themed-mermaid/zoom.css";

// ONE selector, handed to both integrations: the lightbox indexes diagrams by
// it, the PNG export numbers them by it, so they must agree. (This is the
// Starlight content area; omit it entirely on a plain Astro site.)
const selector = ".sl-markdown-content svg[aria-roledescription]";

export const diagramExtras = {
  selector,
  zoom: { selector, filenamePrefix: "my-site" },
  png: {
    selector,
    // Starlight resets data-theme from this localStorage key at load.
    themeStorageKey: "starlight-theme",
    // The solid export card uses --mermaid-surface (see ./mermaid.css).
  },
};
