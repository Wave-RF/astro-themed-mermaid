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
