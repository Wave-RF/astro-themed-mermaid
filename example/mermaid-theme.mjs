// Example config for astro-themed-mermaid.
//
// The DISPLAYED colors are CSS variables (see ./mermaid.css). This file maps
// Mermaid's BUILD-TIME output onto those variables:
//   - `themeVariables` / `classDefs` hand Mermaid concrete hex to bake into the
//     SVG at build time (Mermaid needs real colors to render geometry).
//   - `colorReplacements` then rewrites each baked hex → the matching
//     `var(--mermaid-*)` so the runtime stylesheet drives the colors.
// The build-time hex are essentially sentinels; only `colorReplacements`'
// right-hand side (the var names) reaches the browser. Keep the hex on the left
// in sync with what themeVariables/classDefs bake.
//
//   import { themedMermaid } from "astro-themed-mermaid";
//   import { mermaidTheme } from "./example/mermaid-theme.mjs";
//   const mermaid = themedMermaid(mermaidTheme);

export const mermaidTheme = {
  font: {
    family: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    // Absolute path to a woff2, inlined into the build Chromium for correct
    // text measurement. Resolve it however suits your repo, e.g.:
    //   woff2: fileURLToPath(new URL("../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", import.meta.url)),
  },

  // Mermaid `base` theme. Build-time hex; the ones that should respond to
  // light/dark are rewritten by colorReplacements below.
  themeVariables: {
    fontSize: "14px",
    primaryColor: "#14171C",
    primaryBorderColor: "#06B0BF",
    primaryTextColor: "#F1F3F7",
    lineColor: "#6B7280",
    clusterBkg: "rgba(6, 176, 191, 0.04)",
    clusterBorder: "rgba(6, 176, 191, 0.30)",
    titleColor: "#F1F3F7",
    edgeLabelBackground: "#14171C",
    mainBkg: "#14171C",
    background: "transparent",
    textColor: "#F1F3F7",
  },

  // Semantic node classes, injected into every flowchart so diagrams can use
  // `:::wh`, `:::fail`, etc. without restating the palette.
  classDefs: [
    "classDef client fill:#475569,stroke:#94a3b8,color:#fff,stroke-width:2px",
    "classDef store fill:#334155,stroke:#64748b,color:#fff,stroke-width:2px",
    "classDef fail fill:#7f1d1d,stroke:#dc2626,color:#fff,stroke-width:2px",
    "classDef win fill:#15803d,stroke:#22c55e,color:#fff,stroke-width:2px",
    "classDef wh fill:#0e7f8f,stroke:#5bbfcf,color:#fff,stroke-width:3px",
  ],

  // Baked hex (exactly as Mermaid serializes them) → runtime CSS variable.
  // LHS must match themeVariables/classDefs above; RHS are defined in mermaid.css.
  colorReplacements: [
    ["#14171C", "var(--mermaid-surface)"],
    ["#F1F3F7", "var(--mermaid-ink)"],
    ["#6B7280", "var(--mermaid-line)"],
    ["rgba(6, 176, 191, 0.04)", "var(--mermaid-cluster-bg)"],
    ["rgba(6, 176, 191, 0.30)", "var(--mermaid-cluster-border)"],
    ["#0e7f8f", "var(--mermaid-wh-bg)"],
    ["#5bbfcf", "var(--mermaid-wh-border)"],
    ["#7f1d1d", "var(--mermaid-fail-bg)"],
    ["#dc2626", "var(--mermaid-fail-border)"],
    ["#15803d", "var(--mermaid-win-bg)"],
    ["#22c55e", "var(--mermaid-win-border)"],
    ["#475569", "var(--mermaid-client-bg)"],
    ["#94a3b8", "var(--mermaid-client-border)"],
    ["#334155", "var(--mermaid-store-bg)"],
    ["#64748b", "var(--mermaid-store-border)"],
  ],

  flowchart: {
    curve: "basis",
    padding: 20,
    nodeSpacing: 48,
    rankSpacing: 56,
    wrappingWidth: 480,
    useMaxWidth: true,
  },
  sequence: { useMaxWidth: true, wrap: false },
};
