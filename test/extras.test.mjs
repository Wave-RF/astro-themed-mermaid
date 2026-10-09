import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  diagramHash,
  diagramPng,
  extractDiagramSvgs,
  PNG_DEFAULTS,
  resolvePngOptions,
  stylesFingerprint,
} from "../extras/png.mjs";
import {
  DEFAULT_SELECTOR,
  diagramSlug,
  downloadName,
  normalizeBase,
  pngFileName,
  pngRelPath,
  pngUrl,
  resolveTheme,
} from "../extras/shared.mjs";
import { DEFAULT_LABELS, diagramZoom, resolveZoomOptions, ZOOM_DEFAULTS } from "../extras/zoom.mjs";
import { contrast, relLum, rgbToHex, wcagLevel } from "../tools/audit.mjs";
import { parseCliOptions, slugFromHtmlPath } from "../tools/cli.mjs";
import { screenshotName } from "../tools/screenshot.mjs";

test("slug: root, nested, trailing slash, .html, and Astro base", () => {
  assert.equal(diagramSlug("/"), "index");
  assert.equal(diagramSlug(""), "index");
  assert.equal(diagramSlug("/guide/intro/"), "guide/intro");
  assert.equal(diagramSlug("/guide/intro.html"), "guide/intro");
  assert.equal(diagramSlug("/guide/index.html"), "guide");
  assert.equal(diagramSlug("/docs/guide/", "/docs"), "guide");
  assert.equal(diagramSlug("/docs/", "docs/"), "index");
  assert.equal(diagramSlug("/docsy/a/", "/docs"), "docsy/a", "base must match a whole segment");
  assert.equal(normalizeBase("/"), "");
  assert.equal(normalizeBase("docs/"), "/docs");
});

test("png path + url building (the layout the lightbox fetches)", () => {
  assert.equal(pngFileName(0, "dark"), "0-dark.png");
  assert.equal(pngFileName(3, "light", true), "3-light-transparent.png");
  assert.equal(
    pngRelPath({ slug: "guide/intro", index: 2, theme: "dark" }),
    "diagrams/guide/intro/2-dark.png"
  );
  assert.equal(
    pngRelPath({ outDir: "/img/d/", slug: "index", index: 0, theme: "light", transparent: true }),
    "img/d/index/0-light-transparent.png"
  );
  assert.equal(
    pngUrl({ base: "/docs", slug: "a", index: 1, theme: "dark" }),
    "/docs/diagrams/a/1-dark.png"
  );
  assert.equal(pngUrl({ slug: "a", index: 1, theme: "dark" }), "/diagrams/a/1-dark.png");
  assert.equal(downloadName({ slug: "a/b", index: 0 }), "a-b-diagram-1.png");
  assert.equal(
    downloadName({ prefix: "acme", slug: "a", index: 1, transparent: true }),
    "acme-a-diagram-2-transparent.png"
  );
});

test("theme resolution: attribute wins, then OS preference, then first theme", () => {
  assert.equal(resolveTheme("light", ["light", "dark"], true), "light");
  assert.equal(resolveTheme(null, ["light", "dark"], true), "dark");
  assert.equal(resolveTheme("auto", ["light", "dark"], false), "light");
  assert.equal(resolveTheme(null, ["sepia", "night"], true), "sepia");
});

test("PNG option defaults + validation", () => {
  const c = resolvePngOptions();
  assert.equal(c.selector, DEFAULT_SELECTOR);
  assert.deepEqual(c.themes, ["light", "dark"]);
  assert.equal(c.themeAttr, "data-theme");
  assert.equal(c.themeStorageKey, null);
  assert.equal(c.surfaceVar, "--mermaid-surface");
  assert.equal(c.outDir, "diagrams");
  assert.equal(c.scale, 2);
  assert.deepEqual(
    c.variants.map((v) => v.suffix),
    ["", "-transparent"]
  );
  assert.equal(resolvePngOptions({ pad: 8 }).pad, 8);
  assert.equal(
    resolvePngOptions({ pad: undefined }).pad,
    PNG_DEFAULTS.pad,
    "undefined keeps default"
  );
  assert.throws(() => resolvePngOptions({ themes: [] }), /themes/);
  assert.throws(() => resolvePngOptions({ selector: "" }), /selector/);
  assert.throws(() => resolvePngOptions({ scale: -1 }), /scale/);
  assert.equal(diagramPng().name, "astro-themed-mermaid-png");
});

test("PNG cache hash tracks diagrams, css bundle, theme and settings only", () => {
  const html = (prose, css = "/_astro/a.css") =>
    `<link rel="stylesheet" href="${css}"><p>${prose}</p><svg aria-roledescription="flowchart-v2"><g/></svg>`;
  const h = (page, theme = "dark", cfg) => diagramHash(page, theme, cfg);
  assert.equal(h(html("one")), h(html("two")), "prose edits must not bust the cache");
  assert.notEqual(h(html("x")), h(html("x"), "light"));
  assert.notEqual(h(html("x")), h(html("x", "/_astro/b.css")));
  assert.notEqual(h(html("x")), h(html("x"), "dark", { ...PNG_DEFAULTS, pad: 1 }));
  assert.notEqual(
    h(html("x")),
    diagramHash(html("x").replace("<g/>", "<g><g/></g>"), "dark", PNG_DEFAULTS)
  );
});

test("PNG cache hash sees inline styles, public css, and nested svgs", () => {
  const page = (style, svg = "<g/>") =>
    `<head><style>${style}</style></head><svg aria-roledescription="flowchart-v2">${svg}</svg>`;
  assert.notEqual(
    diagramHash(page(":root{--mermaid-surface:#111}"), "dark"),
    diagramHash(page(":root{--mermaid-surface:#222}"), "dark"),
    "inlined css change must bust the cache"
  );
  const linked = '<link rel="stylesheet" href="/theme.css"><svg aria-roledescription="x"></svg>';
  assert.notEqual(
    diagramHash(linked, "dark", undefined, () => "a{color:red}"),
    diagramHash(linked, "dark", undefined, () => "a{color:blue}"),
    "linked (public/) css content must bust the cache"
  );
  assert.equal(
    stylesFingerprint('<link rel="stylesheet" href="https://x/y.css">'),
    stylesFingerprint("")
  );
  const nested = '<svg aria-roledescription="a"><svg><g/></svg><text>tail</text></svg><p/>';
  assert.deepEqual(extractDiagramSvgs(nested), [nested.slice(0, nested.length - 4)]);
  assert.notEqual(
    diagramHash(page("", "<svg/><text>1</text>"), "dark"),
    diagramHash(page("", "<svg/><text>2</text>"), "dark"),
    "content after an inner </svg> is part of the diagram"
  );
});

test("PNG option validation rejects zero scale/maxDim but allows zero pad", () => {
  assert.throws(() => resolvePngOptions({ scale: 0 }), /scale/);
  assert.throws(() => resolvePngOptions({ maxDim: 0 }), /maxDim/);
  assert.equal(resolvePngOptions({ pad: 0 }).pad, 0);
});

test("lightbox and PNG integration agree on the diagram selector", async () => {
  // Same default by construction (one constant)...
  assert.equal(resolvePngOptions().selector, resolveZoomOptions().selector);
  assert.equal(PNG_DEFAULTS.selector, ZOOM_DEFAULTS.selector);
  // ...and the same on-disk theme/out-dir defaults the lightbox fetches from.
  assert.equal(resolvePngOptions().outDir, resolveZoomOptions().outDir);
  assert.deepEqual(resolvePngOptions().themes, resolveZoomOptions().themes);
  assert.equal(resolvePngOptions().themeAttr, resolveZoomOptions().themeAttr);
  // Neither module hardcodes its own copy of the selector literal.
  for (const f of ["../extras/png.mjs", "../extras/zoom.mjs", "../extras/client.mjs"]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /svg\[aria-roledescription\]/, `${f} must use DEFAULT_SELECTOR`);
  }
});

test("zoom options: defaults, labels merge, base, validation", () => {
  const c = resolveZoomOptions({}, "/docs/");
  assert.equal(c.base, "/docs");
  assert.equal(c.png, true);
  assert.equal(c.css, true);
  assert.equal(c.themeTarget, "html");
  assert.deepEqual(c.labels, DEFAULT_LABELS);
  const d = resolveZoomOptions({ labels: { copy: "Kopieren" }, png: false });
  assert.equal(d.labels.copy, "Kopieren");
  assert.equal(d.labels.close, DEFAULT_LABELS.close);
  assert.equal(d.png, false);
  assert.throws(() => resolveZoomOptions({ selector: "" }), /selector/);
});

test("zoom integration injects the client script with serialized options", () => {
  const injected = [];
  const integ = diagramZoom({ selector: ".post svg[aria-roledescription]", css: false });
  assert.equal(integ.name, "astro-themed-mermaid-zoom");
  integ.hooks["astro:config:setup"]({
    config: { base: "/docs" },
    injectScript: (stage, code) => injected.push({ stage, code }),
  });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].stage, "page");
  assert.match(injected[0].code, /zoom\/client/);
  assert.doesNotMatch(injected[0].code, /zoom\.css/, "css:false must not import the stylesheet");
  const arg = injected[0].code.match(/initDiagramZoom\((.*)\);/s)[1];
  const parsed = JSON.parse(arg);
  assert.equal(parsed.selector, ".post svg[aria-roledescription]");
  assert.equal(parsed.base, "/docs");
  const withCss = [];
  diagramZoom().hooks["astro:config:setup"]({
    config: { base: "/" },
    injectScript: (_s, code) => withCss.push(code),
  });
  assert.match(withCss[0], /zoom\.css/);
});

test("package wiring: subpath exports, bin, optional playwright peer", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const k of ["./png", "./zoom", "./zoom/client", "./zoom.css", "./shared"]) {
    assert.ok(pkg.exports[k], `missing export ${k}`);
  }
  assert.ok(pkg.bin["astro-themed-mermaid"]);
  assert.equal(pkg.peerDependenciesMeta.playwright.optional, true);
  assert.ok(!pkg.dependencies.playwright, "playwright must not be a hard dependency");
  for (const k of ["extras", "bin", "tools"]) assert.ok(pkg.files.includes(k), `files: ${k}`);
});

test("CLI: option parsing and defaults", () => {
  const d = parseCliOptions([]);
  assert.equal(d.dist, "dist");
  assert.equal(d.out, "screenshots");
  assert.equal(d.pages, null);
  assert.equal(d.selector, DEFAULT_SELECTOR);
  assert.deepEqual(d.themes, ["light", "dark"]);
  const o = parseCliOptions([
    "--dist",
    "build",
    "--pages",
    "a, b/c",
    "--themes",
    "light",
    "--theme-storage-key",
    "starlight-theme",
    "--scale",
    "1",
  ]);
  assert.equal(o.dist, "build");
  assert.deepEqual(o.pages, ["a", "b/c"]);
  assert.deepEqual(o.themes, ["light"]);
  assert.equal(o.themeStorageKey, "starlight-theme");
  assert.equal(o.scale, 1);
  assert.throws(() => parseCliOptions(["--scale", "0"]), /scale/);
  assert.throws(() => parseCliOptions(["--nope"]));
  assert.equal(slugFromHtmlPath("guide/intro/index.html"), "guide/intro");
  assert.equal(slugFromHtmlPath("index.html"), "index");
  assert.equal(slugFromHtmlPath("about.html"), "about");
  assert.equal(screenshotName("guide/intro", "dark", 2), "guide-intro-dark-2.png");
});

test("audit: contrast math", () => {
  assert.equal(rgbToHex("rgb(255, 0, 128)"), "#ff0080");
  assert.equal(rgbToHex("not-a-color"), "not-a-color");
  assert.equal(+contrast("#000000", "#ffffff").toFixed(1), 21);
  assert.equal(relLum("#fff") > 0.99, true);
  assert.equal(relLum("garbage"), null, "unparseable color is unknown, never a made-up number");
  assert.equal(contrast("oklch(0.5 0.1 200)", "#fff"), null);
  assert.equal(wcagLevel(null), "unknown");
  assert.equal(wcagLevel(21), "AAA");
  assert.equal(wcagLevel(4.6), "AA");
  assert.equal(wcagLevel(3.1), "AA-large");
  assert.equal(wcagLevel(2), "FAIL");
});

test("core module stays free of a hard browser dependency", async () => {
  const src = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /["']playwright["']/);
});
