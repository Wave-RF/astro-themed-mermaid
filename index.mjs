// astro-themed-mermaid — build-time Mermaid plumbing for Astro / Starlight docs.
//
// Renders diagrams at build time via rehype-mermaid (inline SVG), then rewrites
// the emitted SVG so it (a) survives Chromium's HTML parser, (b) responds to
// light/dark themes through CSS variables, and (c) gets a layer of visual
// polish — cluster-title pills centered over the subgraph border and lifted
// above edges, edge-label pills, themed colors.
//
// COLOR-AGNOSTIC by design: this module holds NO brand colors. The consumer
// supplies the Mermaid theme, the classDef palette, and the hex→CSS-var
// replacement map. The actual displayed colors live wherever those CSS vars are
// defined (e.g. the host site's stylesheet), so one site's palette change flows
// through without touching this plugin. See README.md.
//
// One factory, three pieces to wire up:
//   const mermaid = themedMermaid({ themeVariables, classDefs, colorReplacements, font, flowchart, sequence });
//   markdown.remarkPlugins: [mermaid.remarkInjectClassdefs]
//   markdown.rehypePlugins: [[rehypeMermaid, mermaid.rehypeMermaidOptions]]
//   integrations: [..., mermaid.integration]

import { readFileSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";

// `classDef` is valid in flowchart/graph diagrams only; other diagram types
// (sequence, class, state, gantt, …) parse it as an error, so the classDef
// injection only fires when a block opens with a flowchart/graph header.
const FLOWCHART_HEADER_RE = /^\s*(?:flowchart|graph)\b/;

// Match a whole Mermaid SVG by its aria-roledescription. Two scopes: every
// diagram type we touch, and flowcharts specifically (cluster work).
const SVG_BLOCK_RE =
  /<svg\b[^>]*aria-roledescription="(?:flowchart|sequence|class|state|gantt|pie|er)[^"]*"[\s\S]*?<\/svg>/g;
const FLOWCHART_SVG_RE =
  /<svg\b[^>]*aria-roledescription="flowchart[^"]*"[\s\S]*?<\/svg>/g;

/**
 * @param {object} config
 * @param {Record<string,string>} [config.themeVariables] - Mermaid `base` theme
 *   variables (build-time colors). Passed through to mermaid untouched.
 * @param {string[]} [config.classDefs] - `classDef …` lines injected after the
 *   header of every flowchart/graph block, so source diagrams can use `:::name`
 *   without restating the palette.
 * @param {string[][]} [config.colorReplacements] - `[from, to]`
 *   pairs. Each baked `from` color (hex/rgba exactly as Mermaid serializes it)
 *   is rewritten to `to` (typically `var(--…)`) across the emitted SVG, so
 *   runtime CSS drives the colors. This is the ONLY place colors enter, and
 *   they come from the caller — the plugin defines none.
 * @param {{family?:string, woff2?:string}} [config.font] - Font used for SSR
 *   measurement. If `woff2` (an absolute path) is given it's inlined as a
 *   data URL with font-display:block so Chromium measures with the real font.
 * @param {object} [config.flowchart] - Mermaid flowchart config (non-color).
 * @param {object} [config.sequence] - Mermaid sequence config (non-color).
 * @param {string} [config.securityLevel] - Mermaid securityLevel (default strict).
 */
export function themedMermaid(config = {}) {
  const {
    themeVariables = {},
    classDefs = [],
    colorReplacements = [],
    font = {},
    flowchart = {},
    sequence = {},
    securityLevel = "strict",
  } = config;

  // --- build-time font inlining --------------------------------------------
  // Mermaid measures node widths in the build-time Chromium against whatever
  // font is available. If the declared font isn't actually loaded there, labels
  // are measured against a fallback (~Arial) and overflow at runtime (Inter is
  // ~6-8% wider per char). Inlining the woff2 with font-display:block makes
  // Chromium load it synchronously before measuring. (fontsource's own CSS uses
  // font-display:swap, which doesn't block, so it can't substitute for this.)
  let fontFamily = font.family || '"Arial", sans-serif';
  let fontCssDataUrl;
  if (font.woff2) {
    try {
      const b64 = readFileSync(font.woff2).toString("base64");
      // The @font-face `font-family` DESCRIPTOR must be a single family name —
      // but `font.family` is typically a full CSS stack (e.g. '"Inter Variable",
      // ui-sans-serif, system-ui, sans-serif'). Register the inlined woff2 under
      // just the FIRST family so Chromium provides it under the same name
      // mermaidConfig.fontFamily resolves first. Passing the whole stack here
      // names the face after the stack STRING, so the real family is never
      // registered: measurement silently falls back to a narrower font, boxes
      // come out too small, and labels clip on the right at runtime.
      const primaryFamily =
        (font.family || "").split(",")[0].trim().replace(/^["']|["']$/g, "") ||
        "sans-serif";
      const inlineCss = [
        "@font-face{",
        `font-family:${JSON.stringify(primaryFamily)};`,
        `src:url(data:font/woff2;base64,${b64}) format('woff2-variations');`,
        "font-weight:100 900;font-style:normal;font-display:block;}",
      ].join("");
      fontCssDataUrl =
        "data:text/css;base64," + Buffer.from(inlineCss).toString("base64");
    } catch {
      // Font file not on disk (e.g. fresh clone, no install). Fall back to the
      // default family so the build still succeeds.
      fontFamily = '"Arial", sans-serif';
    }
  }

  const rehypeMermaidOptions = {
    strategy: "inline-svg",
    ...(fontCssDataUrl ? { css: fontCssDataUrl } : {}),
    mermaidConfig: {
      // `fontFamily` must sit at the top level — mermaid-isomorphic hard-codes
      // arial here if absent and ignores the same key in themeVariables.
      fontFamily,
      theme: "base",
      themeVariables: { fontFamily, ...themeVariables },
      flowchart,
      sequence,
      securityLevel,
    },
  };

  function remarkInjectClassdefs() {
    return (tree) => {
      if (classDefs.length === 0) return;
      visit(tree, "code", (node) => {
        if (node.lang !== "mermaid") return;
        const lines = node.value.split("\n");
        const headerIdx = lines.findIndex((l) => l.trim().length > 0);
        if (headerIdx < 0) return;
        if (!FLOWCHART_HEADER_RE.test(lines[headerIdx])) return;
        const indent = lines[headerIdx].match(/^\s*/)[0];
        const injected = classDefs.map((l) => indent + "    " + l);
        lines.splice(headerIdx + 1, 0, ...injected);
        node.value = lines.join("\n");
      });
    };
  }

  // --- SVG post-processing (the polish) ------------------------------------

  // Swap baked colors for CSS vars across the whole SVG body — both the
  // <style> block and inline style="fill:#…" attributes. The ONLY color step,
  // and it's driven entirely by the caller's `colorReplacements`.
  //
  // Replacements are applied in array order, each one global. Order only
  // matters if a `from` could appear inside an earlier pair's `to`; keep the
  // `from` values disjoint (distinct full-length hex/rgba tokens) and order is
  // irrelevant — which is the normal case for Mermaid's serialized colors.
  function applyColorReplacements(html) {
    if (colorReplacements.length === 0) return html;
    return html.replace(SVG_BLOCK_RE, (svg) => {
      let patched = svg;
      for (const [from, to] of colorReplacements) patched = patched.replaceAll(from, to);
      return patched;
    });
  }

  // Mermaid stamps nodeLabels with inline `color: rgb(255,255,255) !important`
  // (and `#fff` on the inner span). Inline !important beats our CSS !important
  // by source order, so default-themed nodes render white-on-white in light
  // mode. Strip the forced white; classDef nodes still get white via their own
  // scoped `.classname …` rule in the SVG, which is intended.
  //
  // Scoped to the SVG block so a literal `color: rgb(255,255,255) !important`
  // elsewhere on the page (e.g. inside a code sample) is never touched.
  function stripForcedWhite(html) {
    return html.replace(SVG_BLOCK_RE, (svg) =>
      svg
        .replaceAll(/color:\s*rgb\(255,\s*255,\s*255\)\s*!important;?\s*/g, "")
        .replaceAll(/color:\s*#fff\s*!important;?\s*/g, "")
    );
  }

  // Move each cluster-label group to the END of its SVG so it paints on top of
  // edges/nodes (SVG paint order is source order; no z-index). Mermaid emits the
  // label inside its subgraph's <g class="root" transform="translate(X,Y)">,
  // and edges crossing the cluster's top border are drawn later than the label.
  // Lifting the label out of that wrapper drops its local-coord transform, so we
  // compose the nearest preceding subgraph-root translate into the label's.
  function liftClusterLabels(html) {
    return html.replace(FLOWCHART_SVG_RE, (svg) => {
      const rootOpens = [];
      const rootOpenRe =
        /<g class="root"\s+transform="translate\(([-\d.]+),\s*([-\d.]+)\)[^"]*"[^>]*>/g;
      let rm;
      while ((rm = rootOpenRe.exec(svg)) !== null) {
        rootOpens.push({ end: rm.index + rm[0].length, tx: parseFloat(rm[1]), ty: parseFloat(rm[2]) });
      }
      const labels = [];
      const labelRe =
        /<g class="cluster-label"\s+transform="translate\(([-\d.]+),\s*([-\d.]+)\)([^"]*)"([\s\S]*?)<\/g>/g;
      const stripped = svg.replace(labelRe, (match, lx, ly, tail, body, off) => {
        let parent = { tx: 0, ty: 0 };
        for (const r of rootOpens) {
          if (r.end <= off) parent = r;
        }
        const absX = parseFloat(lx) + parent.tx;
        const absY = parseFloat(ly) + parent.ty;
        labels.push(
          `<g class="cluster-label" transform="translate(${absX}, ${absY})${tail}"${body}</g>`
        );
        return "";
      });
      if (labels.length === 0) return svg;
      // Anchor before the </g> that's followed by <defs>, <linearGradient>, or </svg>.
      return stripped.replace(
        /(<\/g>)(<defs\b|<linearGradient\b|<\/svg>)/,
        labels.join("") + "$1$2"
      );
    });
  }

  // Expand each flowchart's viewBox upward (so the cluster-title pill, shifted
  // up to straddle the border in CSS, isn't clipped) and re-center each
  // cluster-label horizontally over its rect (Mermaid left-aligns it).
  //
  // NOTE: PAD_TOP is paired with the CSS that lifts the pill (the companion
  // `styles.css` shifts `.cluster-label foreignObject` up by 17px). If you
  // change one, revisit the other — they are two halves of one effect.
  function centerClusterTitles(html) {
    return html.replace(FLOWCHART_SVG_RE, (svg) => {
      let patched = svg.replace(
        /viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/,
        (_m, vx, vy, vw, vh) => {
          const PAD_TOP = 22;
          return `viewBox="${vx} ${parseFloat(vy) - PAD_TOP} ${vw} ${parseFloat(vh) + PAD_TOP}"`;
        }
      );
      // Negative lookahead stops the pre-label scan at the next cluster, so an
      // untitled subgraph fails to match instead of grabbing the next one's label.
      patched = patched.replace(
        /<g class="cluster[^"]*"[^>]*>((?:(?!<g class="cluster)[\s\S])*?<g class="cluster-label"[^>]*>[\s\S]*?<\/g>)/g,
        (match, body) => {
          const rectMatch = body.match(/<rect[^>]+x="([-\d.]+)"[^>]+y="([-\d.]+)"[^>]+width="([\d.]+)"/);
          if (!rectMatch) return match;
          const rectX = parseFloat(rectMatch[1]);
          const rectY = parseFloat(rectMatch[2]);
          const rectW = parseFloat(rectMatch[3]);
          const foMatch = body.match(/<g class="cluster-label"[\s\S]*?<foreignObject\s+width="([\d.]+)"/);
          if (!foMatch) return match;
          const foW = parseFloat(foMatch[1]);
          const fixed = body.replace(
            /(<g class="cluster-label"[^>]*\btransform=")translate\([^)]+\)/,
            `$1translate(${rectX + rectW / 2 - foW / 2}, ${rectY})`
          );
          return match.replace(body, fixed);
        }
      );
      return patched;
    });
  }

  function integration() {
    async function walk(dir) {
      const out = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = joinPath(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.name.endsWith(".html")) out.push(full);
      }
      return out;
    }
    return {
      name: "astro-themed-mermaid",
      hooks: {
        "astro:build:done": async ({ dir, logger }) => {
          const files = await walk(fileURLToPath(dir));
          let brFixes = 0;
          let themeFixes = 0;
          let centeredFiles = 0;
          for (const file of files) {
            let html = await readFile(file, "utf8");
            let changed = false;
            // <br></br> → <br>: Mermaid emits the former; per HTML5 the void
            // end tag inserts a duplicate <br>, so Chrome renders an extra line
            // and the foreignObject (sized for N lines) overflows.
            if (html.includes("<br></br>")) {
              html = html.replaceAll("<br></br>", "<br>");
              brFixes++;
              changed = true;
            }
            if (html.includes("#mermaid-")) {
              const recolored = applyColorReplacements(html);
              const stripped = stripForcedWhite(recolored);
              const centered = centerClusterTitles(stripped);
              const lifted = liftClusterLabels(centered);
              if (lifted !== html) {
                html = lifted;
                themeFixes++;
                if (centered !== stripped) centeredFiles++;
                changed = true;
              }
            }
            if (changed) await writeFile(file, html);
          }
          logger.info(
            `patched ${brFixes} <br></br> + ${themeFixes} theme + ${centeredFiles} cluster-center`
          );
        },
      },
    };
  }

  return {
    rehypeMermaidOptions,
    remarkInjectClassdefs,
    integration: integration(),
  };
}
