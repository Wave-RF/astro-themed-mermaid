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
//   markdown.rehypePlugins: [mermaid.rehypeMermaid]   // cached; or the uncached
//     spelling [[rehypeMermaid, mermaid.rehypeMermaidOptions]] — see README
//   integrations: [..., mermaid.integration]

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve as joinPath } from "node:path";
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
const FLOWCHART_SVG_RE = /<svg\b[^>]*aria-roledescription="flowchart[^"]*"[\s\S]*?<\/svg>/g;

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
 * @param {string} [config.measurementCss] - Extra CSS injected into the
 *   build-time render page so Mermaid measures labels with the SAME metrics
 *   (font-weight / letter-spacing / padding) your stylesheet displays them at —
 *   otherwise labels whose display weight differs from the measured one clip on
 *   the right. Selectors must NOT include the `svg[aria-roledescription…]`
 *   ancestor (Mermaid measures before that wrapper exists); use bare
 *   `.nodeLabel p`, `.edgeLabel p`, etc.
 * @param {object} [config.flowchart] - Mermaid flowchart config (non-color).
 * @param {object} [config.sequence] - Mermaid sequence config (non-color).
 * @param {string} [config.securityLevel] - Mermaid securityLevel (default strict).
 * @param {object} [config.mermaidConfig] - Escape hatch for arbitrary NON-COLOR
 *   Mermaid settings this module doesn't enumerate (e.g. `gantt`, `er`, `pie`,
 *   `htmlLabels`, `maxTextSize`). Merged BENEATH the module's own config, so the
 *   color-agnostic invariant holds: theme/themeVariables/fontFamily/
 *   securityLevel/flowchart/sequence always win over a same-named key here.
 */
export function themedMermaid(config = {}) {
  const {
    themeVariables = {},
    classDefs = [],
    colorReplacements = [],
    font = {},
    measurementCss = "",
    flowchart = {},
    sequence = {},
    securityLevel = "strict",
    mermaidConfig = {},
    cache = join("node_modules", ".cache", "astro-themed-mermaid"),
  } = config;

  // --- build-time measurement CSS ------------------------------------------
  // Mermaid sizes each label's box by MEASURING the label DOM in the build-time
  // Chromium, then the host browser DISPLAYS it. Anything that makes display
  // wider than measurement clips the last glyph (foreignObject crops to its
  // box). Two independent culprits, two pieces of injected CSS:
  //
  //   1. The FONT. If the declared font isn't loaded in the build Chromium,
  //      labels are measured against a fallback (~Arial) and overflow at
  //      runtime (Inter is ~6-8% wider per char). Inlining the woff2 with
  //      font-display:block makes Chromium load it synchronously before
  //      measuring. (fontsource's own CSS uses font-display:swap, which doesn't
  //      block, so it can't substitute for this.)
  //
  //   2. Label METRICS — font-weight / letter-spacing / padding. If your
  //      stylesheet renders node labels at, say, weight 500 but Mermaid
  //      measured them at the default 400, every box is ~1px too narrow and the
  //      last letter clips. Pass those rules as `measurementCss` so the build
  //      measures what the browser shows. IMPORTANT: Mermaid measures the label
  //      BEFORE it's parented by the final `svg[aria-roledescription="flowchart…"]`,
  //      so write these selectors WITHOUT that ancestor — e.g. `.nodeLabel p`,
  //      not `svg[aria-roledescription^="flowchart"] .nodeLabel p` (the latter
  //      matches at display time but NOT at measure time, so it's a no-op here).
  let fontFamily = font.family || '"Arial", sans-serif';
  const cssParts = [];
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
        (font.family || "")
          .split(",")[0]
          .trim()
          .replace(/^["']|["']$/g, "") || "sans-serif";
      cssParts.push(
        [
          "@font-face{",
          `font-family:${JSON.stringify(primaryFamily)};`,
          `src:url(data:font/woff2;base64,${b64}) format('woff2-variations');`,
          "font-weight:100 900;font-style:normal;font-display:block;}",
        ].join("")
      );
    } catch {
      // Font file not on disk (e.g. fresh clone, no install). Fall back to the
      // default family so the build still succeeds.
      fontFamily = '"Arial", sans-serif';
    }
  }
  // Caller's label-metric rules, injected after the @font-face so they can
  // depend on the inlined font being available.
  if (measurementCss) cssParts.push(measurementCss);
  const measurementCssDataUrl = cssParts.length
    ? `data:text/css;base64,${Buffer.from(cssParts.join("")).toString("base64")}`
    : undefined;

  const rehypeMermaidOptions = {
    strategy: "inline-svg",
    ...(measurementCssDataUrl ? { css: measurementCssDataUrl } : {}),
    mermaidConfig: {
      // Caller's non-color escape-hatch settings sit BENEATH the module's own,
      // so the color-agnostic invariant holds — the keys below always win.
      ...mermaidConfig,
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
        const injected = classDefs.map((l) => `${indent}    ${l}`);
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
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic global regex.exec() iteration
      while ((rm = rootOpenRe.exec(svg)) !== null) {
        rootOpens.push({
          end: rm.index + rm[0].length,
          tx: parseFloat(rm[1]),
          ty: parseFloat(rm[2]),
        });
      }
      const labels = [];
      const labelRe =
        /<g class="cluster-label"\s+transform="translate\(([-\d.]+),\s*([-\d.]+)\)([^"]*)"([\s\S]*?)<\/g>/g;
      const stripped = svg.replace(labelRe, (_match, lx, ly, tail, body, off) => {
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
        `${labels.join("")}$1$2`
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
          const rectMatch = body.match(
            /<rect[^>]+x="([-\d.]+)"[^>]+y="([-\d.]+)"[^>]+width="([\d.]+)"/
          );
          if (!rectMatch) return match;
          const rectX = parseFloat(rectMatch[1]);
          const rectY = parseFloat(rectMatch[2]);
          const rectW = parseFloat(rectMatch[3]);
          const foMatch = body.match(
            /<g class="cluster-label"[\s\S]*?<foreignObject\s+width="([\d.]+)"/
          );
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

  // --- Render cache (content-addressed, per diagram) ------------------------
  // Rendering goes through Chromium (mermaid-isomorphic), which dominates the
  // build time of a docs site that hasn't touched its diagrams — i.e. almost
  // every build. `rehypeMermaid` (the export below) wraps rehype-mermaid with
  // a disk cache keyed on sha256(diagram source + render options + package
  // versions): a file whose diagrams all hit is spliced from cache and never
  // touches rehype-mermaid (so no browser launches at all); a file with any
  // miss is delegated to rehype-mermaid wholesale, then the rendered SVGs are
  // harvested back into the cache. Cache entries are the rendered hast
  // elements as JSON — what rehype-mermaid would have spliced — so hits are
  // byte-identical to fresh renders. The SVG post-processing above is
  // untouched: it runs on built HTML at astro:build:done either way.
  //
  // Entry ids are rewritten to `mermaid-c<key>` at store time: render-time ids
  // (`mermaid-0`, `mermaid-1`, …) are per-batch sequential, so entries cached
  // from different builds could collide on one page (url(#…) refs are
  // document-global). The rewritten id keeps the `mermaid-` prefix because the
  // build:done patcher gates theme rewriting on seeing `#mermaid-`.
  //
  // Cache reads/writes are best-effort: any fs or parse error degrades to a
  // normal render, never a failed build. Only the inline-svg strategy without
  // the `dark` option is cached (this package always configures exactly that);
  // anything else delegates straight through.

  const cacheDir = cache === false ? null : joinPath(cache);

  // Versions participate in the key so a toolchain bump invalidates stale
  // renders. Best-effort: resolve each package's entry, then climb to its own
  // package.json (handles pnpm's nested .pnpm layout); failures key as
  // "unknown" rather than failing the build.
  function packageVersion(specifier, fromDir) {
    try {
      const req = createRequire(fromDir ? join(fromDir, "noop.js") : import.meta.url);
      let dir = dirname(req.resolve(specifier));
      while (true) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
          if (pkg.name === specifier) return { version: pkg.version, dir };
        } catch {
          // keep climbing
        }
        const parent = dirname(dir);
        if (parent === dir) return { version: "unknown", dir: null };
        dir = parent;
      }
    } catch {
      return { version: "unknown", dir: null };
    }
  }

  let versionsMemo;
  function toolchainVersions() {
    if (versionsMemo) return versionsMemo;
    let self = "unknown";
    try {
      self = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
    } catch {
      // keyed as unknown
    }
    const rehype = packageVersion("rehype-mermaid");
    const isomorphic = packageVersion("mermaid-isomorphic", rehype.dir ?? undefined);
    const mermaidPkg = packageVersion("mermaid", isomorphic.dir ?? undefined);
    versionsMemo = {
      self,
      "rehype-mermaid": rehype.version,
      "mermaid-isomorphic": isomorphic.version,
      mermaid: mermaidPkg.version,
    };
    return versionsMemo;
  }

  // Deterministic JSON: objects by sorted key, so option-object key order
  // never shifts the hash.
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function diagramKey(diagram) {
    return createHash("sha256")
      .update(stableStringify({ d: diagram, o: rehypeMermaidOptions, v: toolchainVersions() }))
      .digest("hex")
      .slice(0, 32);
  }

  function readCacheEntry(key) {
    if (!cacheDir) return null;
    try {
      const parsed = JSON.parse(readFileSync(join(cacheDir, `${key}.json`), "utf8"));
      // Shape check so a corrupt/foreign file degrades to a render, not a crash.
      return parsed && parsed.type === "element" && parsed.tagName === "svg" ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeCacheEntry(key, svgElement) {
    if (!cacheDir) return;
    try {
      let json = JSON.stringify(svgElement);
      // Re-id the entry (see section comment). The render-time id appears in
      // properties.id, the scoped <style> selectors, and url(#…) marker refs —
      // all plain `${prefix}-${n}` tokens, so a textual replace covers them.
      const id = svgElement.properties?.id;
      if (typeof id === "string" && id) json = json.replaceAll(id, `mermaid-c${key.slice(0, 12)}`);
      mkdirSync(cacheDir, { recursive: true });
      const tmp = join(cacheDir, `${key}.${process.pid}.tmp`);
      writeFileSync(tmp, json);
      renameSync(tmp, join(cacheDir, `${key}.json`)); // atomic-ish vs parallel pages
    } catch {
      // Cache is an optimization; never fail the build over it.
    }
  }

  // Mermaid block detection, mirroring rehype-mermaid's rules (MIT, © Remco
  // Haszing) so hit/miss decisions agree exactly with what it would render:
  // a <pre class="mermaid">, a <pre> whose only non-whitespace child is a
  // <code class="language-mermaid">, or such a <code> outside any <pre>.
  function hasClass(node, name) {
    const className = node.properties?.className;
    const list = typeof className === "string" ? className.split(/\s+/) : className;
    return Array.isArray(list) && list.includes(name);
  }

  function textContent(node) {
    if (node.type === "text") return node.value;
    if (!node.children) return "";
    return node.children.map(textContent).join("");
  }

  function findMermaidInstances(tree) {
    const found = [];
    visit(tree, "element", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;
      if (node.tagName === "pre") {
        if (hasClass(node, "mermaid")) {
          found.push({ parent, index, diagram: textContent(node) });
          return;
        }
        let code;
        for (const child of node.children) {
          if (child.type === "text") {
            if (/\w/.test(child.value)) return; // non-whitespace sibling → not ours
          } else if (
            child.type === "element" &&
            child.tagName === "code" &&
            hasClass(child, "language-mermaid")
          ) {
            if (code) return; // two code children → not ours
            code = child;
          } else {
            return; // any other sibling → not ours
          }
        }
        if (code) found.push({ parent, index, diagram: textContent(code) });
      } else if (
        node.tagName === "code" &&
        hasClass(node, "language-mermaid") &&
        parent.tagName !== "pre"
      ) {
        found.push({ parent, index, diagram: textContent(node) });
      }
    });
    return found;
  }

  // Exposed seam so tests can exercise hit/miss/harvest without a browser.
  // rehype-mermaid (and through it mermaid-isomorphic → playwright) is loaded
  // lazily on the first miss: a fully cached build never imports the render
  // stack at all, and consumers without playwright installed can still import
  // this package for the remark plugin / integration.
  function createCachedRehypeMermaid({ delegate } = {}) {
    const loadInner =
      delegate ?? (() => import("rehype-mermaid").then((m) => m.default(rehypeMermaidOptions)));
    const cacheable =
      (rehypeMermaidOptions.strategy ?? "inline-svg") === "inline-svg" &&
      !rehypeMermaidOptions.dark;
    return function rehypeMermaidCached() {
      let innerPromise; // one rehype-mermaid instance per processor, like the uncached spelling
      const inner = () => (innerPromise ??= Promise.resolve(loadInner()));
      return async (tree, file) => {
        if (!cacheable || !cacheDir) return (await inner())(tree, file);
        const instances = findMermaidInstances(tree);
        if (instances.length === 0) return; // nothing to do — and no browser (parity with rehype-mermaid)

        for (const instance of instances) {
          instance.key = diagramKey(instance.diagram);
          instance.cached = readCacheEntry(instance.key);
        }

        if (instances.every((i) => i.cached)) {
          for (const { parent, index, cached } of instances) parent.children[index] = cached;
          return; // full hit: rehype-mermaid never runs, Chromium never launches
        }

        // Any miss: let rehype-mermaid render the whole file (one browser
        // batch either way), then harvest each replacement from the position
        // we recorded — it replaces 1:1 in place, so (parent, index) is stable.
        await (await inner())(tree, file);
        for (const { parent, index, key } of instances) {
          const rendered = parent.children[index];
          if (rendered?.type === "element" && rendered.tagName === "svg")
            writeCacheEntry(key, rendered);
        }
      };
    };
  }

  return {
    rehypeMermaidOptions,
    rehypeMermaid: createCachedRehypeMermaid(),
    remarkInjectClassdefs,
    integration: integration(),
    _internals: { createCachedRehypeMermaid, diagramKey, findMermaidInstances },
  };
}
