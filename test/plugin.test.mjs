import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { themedMermaid } from "../index.mjs";

test("factory returns the three wiring pieces", () => {
  const m = themedMermaid();
  assert.equal(typeof m.remarkInjectClassdefs, "function");
  assert.equal(typeof m.rehypeMermaidOptions, "object");
  assert.equal(m.integration.name, "astro-themed-mermaid");
  assert.equal(typeof m.integration.hooks["astro:build:done"], "function");
});

test("inlined @font-face registers the PRIMARY family name, not the whole CSS stack", async () => {
  // Regression guard: font.family is a full stack, but an @font-face descriptor
  // must be a single family name. If we name the face after the stack string,
  // the real family is never registered and build-time measurement falls back
  // to a narrower font — boxes come out too small and labels clip at runtime.
  const dir = await mkdtemp(join(tmpdir(), "atm-font-"));
  const woff2 = join(dir, "x.woff2");
  await writeFile(woff2, "not-a-real-font-bytes-dont-matter-for-the-descriptor");
  const { rehypeMermaidOptions: o } = themedMermaid({
    font: { family: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', woff2 },
  });
  assert.ok(
    typeof o.css === "string" && o.css.startsWith("data:text/css;base64,"),
    "font CSS was inlined"
  );
  const css = Buffer.from(o.css.split(",")[1], "base64").toString("utf8");
  assert.match(css, /font-family:"Inter Variable";/, "@font-face uses just the primary family");
  assert.doesNotMatch(css, /ui-sans-serif/, "@font-face name is NOT the full stack");
  // mermaid still renders/measures with the full stack so runtime fallbacks work
  assert.equal(
    o.mermaidConfig.fontFamily,
    '"Inter Variable", ui-sans-serif, system-ui, sans-serif'
  );
});

test("rehypeMermaidOptions carries fontFamily at top level AND in themeVariables", () => {
  const { rehypeMermaidOptions: o } = themedMermaid({
    font: { family: "Test Font" },
    themeVariables: { primaryColor: "#123456" },
  });
  assert.equal(o.strategy, "inline-svg");
  assert.equal(o.mermaidConfig.fontFamily, "Test Font");
  assert.equal(o.mermaidConfig.themeVariables.fontFamily, "Test Font");
  assert.equal(o.mermaidConfig.themeVariables.primaryColor, "#123456");
  assert.equal(o.mermaidConfig.theme, "base");
});

test("remarkInjectClassdefs injects classDefs after a flowchart header", () => {
  const transform = themedMermaid({
    classDefs: ["classDef wh fill:#000", "classDef fail fill:#f00"],
  }).remarkInjectClassdefs();
  const node = { type: "code", lang: "mermaid", value: "flowchart TD\n  A --> B" };
  transform({ type: "root", children: [node] });
  const lines = node.value.split("\n");
  assert.match(lines[0], /flowchart TD/);
  assert.match(lines[1], /classDef wh fill:#000/);
  assert.match(lines[2], /classDef fail fill:#f00/);
  assert.match(lines[3], /A --> B/);
});

test("remarkInjectClassdefs leaves non-flowchart diagrams untouched", () => {
  const transform = themedMermaid({
    classDefs: ["classDef wh fill:#000"],
  }).remarkInjectClassdefs();
  const value = "sequenceDiagram\n  A->>B: hi";
  const node = { type: "code", lang: "mermaid", value };
  transform({ type: "root", children: [node] });
  assert.equal(node.value, value);
});

test("remarkInjectClassdefs ignores non-mermaid code blocks", () => {
  const transform = themedMermaid({
    classDefs: ["classDef wh fill:#000"],
  }).remarkInjectClassdefs();
  const value = "flowchart TD\n  A --> B";
  const node = { type: "code", lang: "js", value };
  transform({ type: "root", children: [node] });
  assert.equal(node.value, value, "a js block that happens to start with 'flowchart' is untouched");
});

// End-to-end: run the build hook over a fake Mermaid-emitted SVG and assert
// each rewrite pass fired. This is the guard against Mermaid-version drift.
test("build hook rewrites emitted SVG (br fix, color swap, forced-white strip)", async () => {
  const { integration } = themedMermaid({
    colorReplacements: [["#14171C", "var(--surface)"]],
  });
  const dir = await mkdtemp(join(tmpdir(), "atm-"));
  const html = [
    "<!doctype html><html><body>",
    '<svg aria-roledescription="flowchart-v2" id="mermaid-1">',
    "<style>#mermaid-1{background:#14171C}</style>",
    '<g class="node"><foreignObject><div>',
    '<span class="nodeLabel" style="color: rgb(255, 255, 255) !important;">Hi<br></br>there</span>',
    "</div></foreignObject></g>",
    '<rect style="fill:#14171C"></rect>',
    "</svg></body></html>",
  ].join("");
  const file = join(dir, "index.html");
  await writeFile(file, html);

  const logs = [];
  await integration.hooks["astro:build:done"]({
    dir: pathToFileURL(dir + "/"),
    logger: { info: (m) => logs.push(m) },
  });

  const out = await readFile(file, "utf8");
  assert.ok(!out.includes("<br></br>"), "<br></br> normalized to <br>");
  assert.ok(out.includes("var(--surface)"), "baked hex swapped for CSS var");
  assert.ok(!out.includes("#14171C"), "no baked hex left behind");
  assert.ok(
    !/color:\s*rgb\(255, 255, 255\)\s*!important/.test(out),
    "Mermaid's forced white stripped"
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0], /patched/);
});

// Pages with no Mermaid output must be left byte-for-byte identical, including
// any literal that looks like Mermaid's forced-white (e.g. inside a code sample).
test("build hook leaves non-mermaid HTML untouched", async () => {
  const { integration } = themedMermaid({
    colorReplacements: [["#14171C", "var(--surface)"]],
  });
  const dir = await mkdtemp(join(tmpdir(), "atm-"));
  const html =
    "<!doctype html><html><body><pre><code>" +
    "color: rgb(255, 255, 255) !important; background:#14171C" +
    "</code></pre></body></html>";
  const file = join(dir, "index.html");
  await writeFile(file, html);

  await integration.hooks["astro:build:done"]({
    dir: pathToFileURL(dir + "/"),
    logger: { info: () => {} },
  });

  assert.equal(await readFile(file, "utf8"), html, "no mermaid → no rewrites");
});

// --- render cache ------------------------------------------------------------

// A minimal hast tree with one fenced mermaid block, the shape Astro's
// markdown pipeline emits (pre > code.language-mermaid > text).
function mermaidTree(source) {
  const code = {
    type: "element",
    tagName: "code",
    properties: { className: ["language-mermaid"] },
    children: [{ type: "text", value: source }],
  };
  const pre = { type: "element", tagName: "pre", properties: {}, children: [code] };
  return { type: "root", children: [pre] };
}

// A delegate that splices a fake rendered SVG (with batch-style sequential
// ids, like mermaid-isomorphic) and counts invocations — so the cache's
// hit/miss/harvest paths run without a browser.
function fakeDelegate(calls) {
  return () => (tree) => {
    calls.count++;
    let n = 0;
    for (const node of tree.children) {
      if (node.tagName !== "pre") continue;
      const id = `mermaid-${n++}`;
      tree.children[tree.children.indexOf(node)] = {
        type: "element",
        tagName: "svg",
        properties: { id, "aria-roledescription": "flowchart-v2" },
        children: [
          {
            type: "element",
            tagName: "style",
            properties: {},
            children: [{ type: "text", value: `#${id} .node{fill:red}` }],
          },
          {
            type: "element",
            tagName: "path",
            properties: { "marker-end": `url(#${id}_flowchart-pointEnd)` },
            children: [],
          },
        ],
      };
    }
  };
}

test("render cache: miss renders + stores, hit splices without the delegate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atm-cache-"));
  const { _internals } = themedMermaid({ cache: dir });
  const calls = { count: 0 };
  const plugin = _internals.createCachedRehypeMermaid({ delegate: fakeDelegate(calls) })();

  const t1 = mermaidTree("graph TD;\n  A-->B");
  await plugin(t1, {});
  assert.equal(calls.count, 1, "first sight of the diagram renders");
  assert.equal(t1.children[0].tagName, "svg");

  const t2 = mermaidTree("graph TD;\n  A-->B");
  await plugin(t2, {});
  assert.equal(calls.count, 1, "cache hit: delegate not called again");
  const svg = t2.children[0];
  assert.equal(svg.tagName, "svg", "cached svg spliced in");
  // Stored entries are re-id'd to a content-derived id that keeps the
  // `mermaid-` prefix (the build:done patcher gates on `#mermaid-`), and the
  // rewrite must reach style selectors and url(#…) refs consistently.
  assert.match(svg.properties.id, /^mermaid-c[0-9a-f]{12}$/);
  assert.match(svg.children[0].children[0].value, /^#mermaid-c[0-9a-f]{12} /);
  assert.equal(
    svg.children[1].properties["marker-end"],
    `url(#${svg.properties.id}_flowchart-pointEnd)`
  );
});

test("render cache: source or option changes change the key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atm-cache-"));
  const a = themedMermaid({ cache: dir });
  const b = themedMermaid({ cache: dir, themeVariables: { primaryColor: "#123456" } });
  const src = "graph TD;\n  A-->B";
  assert.notEqual(a._internals.diagramKey(src), a._internals.diagramKey(src + ";C-->D"));
  assert.notEqual(a._internals.diagramKey(src), b._internals.diagramKey(src), "options are in the key");
  assert.equal(a._internals.diagramKey(src), themedMermaid({ cache: dir })._internals.diagramKey(src), "key is deterministic");
});

test("render cache: corrupt entry degrades to a render, cache:false never touches disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atm-cache-"));
  const { _internals } = themedMermaid({ cache: dir });
  const calls = { count: 0 };
  const plugin = _internals.createCachedRehypeMermaid({ delegate: fakeDelegate(calls) })();
  const src = "graph TD;\n  A-->B";

  await writeFile(join(dir, `${_internals.diagramKey(src)}.json`), "{not json");
  const t = mermaidTree(src);
  await plugin(t, {});
  assert.equal(calls.count, 1, "corrupt entry → rendered, not crashed");
  assert.equal(t.children[0].tagName, "svg");

  const off = themedMermaid({ cache: false });
  const offCalls = { count: 0 };
  const offPlugin = off._internals.createCachedRehypeMermaid({ delegate: fakeDelegate(offCalls) })();
  const t2 = mermaidTree(src);
  await offPlugin(t2, {});
  await offPlugin(mermaidTree(src), {});
  assert.equal(offCalls.count, 2, "cache disabled → every file renders");
});

test("render cache: non-mermaid documents never render", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atm-cache-"));
  const { _internals } = themedMermaid({ cache: dir });
  const calls = { count: 0 };
  const plugin = _internals.createCachedRehypeMermaid({ delegate: fakeDelegate(calls) })();
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { className: ["language-js"] },
            children: [{ type: "text", value: "1+1" }],
          },
        ],
      },
    ],
  };
  await plugin(tree, {});
  assert.equal(calls.count, 0, "no mermaid blocks → no render call at all");
  assert.equal(tree.children[0].tagName, "pre", "tree untouched");
});
