// Node-side Playwright helpers shared by the PNG integration and the dev tools.
// Playwright is an OPTIONAL peer dependency: it is resolved from the CONSUMER's
// project root (never from this package's own location, which under a strict
// pnpm layout can't see it), and only when something actually needs a browser.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { DEFAULT_THEME_ATTR, normalizeBase } from "./shared.mjs";

export const CONTENT_TYPES = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Load Playwright's `chromium` from `root` (the consumer's project dir).
 * Uses Node's own resolver: at `astro:build:done` Vite's SSR module runner is
 * already closed, so a dynamic `import("playwright")` there throws.
 */
export function loadChromium(root = process.cwd()) {
  const require = createRequire(join(resolve(root), "package.json"));
  try {
    return require("playwright").chromium;
  } catch (err) {
    if (err?.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "@wave-rf/astro-themed-mermaid: this feature needs Playwright. Install it in your " +
          "project (`pnpm add -D playwright && pnpm exec playwright install chromium`).",
        { cause: err }
      );
    }
    throw err;
  }
}

/** Source of the context init-script that selects `theme` before first paint. */
export function themeInitArgs({ theme, attr = DEFAULT_THEME_ATTR, storageKey = null }) {
  return { t: theme, attr, key: storageKey };
}

/** Init script body (runs in the page). */
export function themeInitScript({ t, attr, key }) {
  if (key) {
    try {
      localStorage.setItem(key, t);
    } catch {
      /* private mode, etc. */
    }
  }
  document.documentElement.setAttribute(attr, t);
}

/**
 * Built pages load over file://, so their absolute asset hrefs (`/_astro/*`,
 * `/fonts/*`) resolve to the filesystem root and 404. Route every absolute
 * file:// request back into the build output (honouring Astro's `base`) so CSS,
 * fonts and images load.
 */
export async function routeDistAssets(page, distDir, base = "") {
  const root = resolve(distDir);
  const b = normalizeBase(base);
  await page.route("**/*", async (route, req) => {
    const u = new URL(req.url());
    if (u.protocol === "file:" && u.pathname.startsWith("/")) {
      let pathname = decodeURIComponent(u.pathname);
      if (b && pathname.startsWith(`${b}/`)) pathname = pathname.slice(b.length);
      const onDisk = resolve(root, `.${pathname}`);
      if ((onDisk === root || onDisk.startsWith(root + sep)) && existsSync(onDisk)) {
        const ext = onDisk.slice(onDisk.lastIndexOf("."));
        return route.fulfill({
          body: await readFile(onDisk),
          contentType: CONTENT_TYPES[ext] || "application/octet-stream",
        });
      }
    }
    return route.continue();
  });
}

/** Locate the built HTML file for a page slug. */
export function findHtml(distDir, slug) {
  for (const rel of slug === "index" ? ["index.html"] : [`${slug}/index.html`, `${slug}.html`]) {
    const p = join(distDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}
