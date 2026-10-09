// `astro-themed-mermaid` dev tools: `audit` and `screenshot`.
//
// Both load the BUILT site (`astro build` output) over file:// in headless
// Chromium, with the real stylesheet applied (absolute asset hrefs are routed
// back into the output dir), so what you measure is what will be served. Run
// them from the project root after a build. Playwright must be installed in
// the project (optional peer dependency).

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { loadChromium, routeDistAssets, themeInitScript } from "../extras/browser.mjs";
import {
  DEFAULT_SELECTOR,
  DEFAULT_THEME_ATTR,
  DEFAULT_THEMES,
  diagramSlug,
  MARKER_ATTR,
} from "../extras/shared.mjs";

export const USAGE = `astro-themed-mermaid <command> [options]

Commands
  audit        Measure rendered flowcharts: edge-label centering, cylinder label
               offset, cluster-title straddle, node fill/text WCAG contrast.
               Writes <out>/audit.json and prints it.
  screenshot   Screenshot every diagram (per page, per theme) for visual checks.
               Writes <out>/<page>-<theme>-<n>.png.

Options (both commands)
  --dist <dir>              Built site (default: dist)
  --out <dir>               Output dir (default: screenshots)
  --pages <slug,slug,...>   Page slugs to include (default: every built page
                            that contains a diagram)
  --selector <css>          Diagram selector (default: ${DEFAULT_SELECTOR})
  --themes <a,b>            Theme names (default: ${DEFAULT_THEMES.join(",")})
  --theme-attr <name>       Attribute set on <html> (default: ${DEFAULT_THEME_ATTR})
  --theme-storage-key <k>   localStorage key the site reads its theme from
                            (Starlight: starlight-theme)
  --base <path>             Astro \`base\` the site was built with (default: none)
  --scale <n>               Device scale factor, screenshot only (default: 2)
  -h, --help                Show this help
`;

export const CLI_DEFAULTS = Object.freeze({
  dist: "dist",
  out: "screenshots",
  pages: null,
  selector: DEFAULT_SELECTOR,
  themes: DEFAULT_THEMES,
  themeAttr: DEFAULT_THEME_ATTR,
  themeStorageKey: null,
  base: "",
  scale: 2,
});

const splitList = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Parse argv (after the command) into resolved options. Pure. */
export function parseCliOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dist: { type: "string" },
      out: { type: "string" },
      pages: { type: "string" },
      selector: { type: "string" },
      themes: { type: "string" },
      "theme-attr": { type: "string" },
      "theme-storage-key": { type: "string" },
      base: { type: "string" },
      scale: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  const scale = values.scale === undefined ? CLI_DEFAULTS.scale : Number(values.scale);
  if (!(scale > 0)) throw new Error(`--scale must be a positive number (got ${values.scale})`);
  const themes = values.themes ? splitList(values.themes) : CLI_DEFAULTS.themes;
  if (themes.length === 0) throw new Error("--themes must name at least one theme");
  return {
    help: !!values.help,
    dist: values.dist ?? CLI_DEFAULTS.dist,
    out: values.out ?? CLI_DEFAULTS.out,
    pages: values.pages ? splitList(values.pages) : CLI_DEFAULTS.pages,
    selector: values.selector ?? CLI_DEFAULTS.selector,
    themes,
    themeAttr: values["theme-attr"] ?? CLI_DEFAULTS.themeAttr,
    themeStorageKey: values["theme-storage-key"] ?? CLI_DEFAULTS.themeStorageKey,
    base: values.base ?? CLI_DEFAULTS.base,
    scale,
  };
}

/** Slug of a built HTML file path relative to the dist dir. Pure. */
export function slugFromHtmlPath(rel) {
  return diagramSlug(rel.split(sep).join("/"));
}

async function* walkHtml(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walkHtml(p);
    else if (ent.name.endsWith(".html")) yield p;
  }
}

/** Built pages (slug + file) that contain a diagram, or just the named slugs. */
export async function discoverPages(dist, only) {
  const found = [];
  for await (const file of walkHtml(dist)) {
    const slug = slugFromHtmlPath(relative(dist, file));
    if (only && !only.includes(slug)) continue;
    const html = await readFile(file, "utf8");
    if (html.includes(MARKER_ATTR) || html.includes('aria-roledescription="'))
      found.push({ slug, file });
  }
  found.sort((a, b) => a.slug.localeCompare(b.slug));
  if (only) {
    const missing = only.filter((s) => !found.some((f) => f.slug === s));
    if (missing.length) throw new Error(`no built page with a diagram for: ${missing.join(", ")}`);
  }
  return found;
}

/** Launch Chromium and give `fn` a themed context factory. */
export async function withThemedPages(opts, scale, fn) {
  const chromium = loadChromium(process.cwd());
  const browser = await chromium.launch();
  try {
    const distDir = resolve(opts.dist);
    const open = async (theme) => {
      const ctx = await browser.newContext({
        viewport: { width: 2000, height: 1400 },
        deviceScaleFactor: scale,
        colorScheme: theme === "light" || theme === "dark" ? theme : undefined,
      });
      await ctx.addInitScript(themeInitScript, {
        t: theme,
        attr: opts.themeAttr,
        key: opts.themeStorageKey,
      });
      const page = await ctx.newPage();
      await routeDistAssets(page, distDir, opts.base);
      return { ctx, page };
    };
    return await fn(open);
  } finally {
    await browser.close();
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  if (command !== "audit" && command !== "screenshot") {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }
  const opts = parseCliOptions(rest);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const mod = command === "audit" ? await import("./audit.mjs") : await import("./screenshot.mjs");
  await mod.run(opts);
  return 0;
}
