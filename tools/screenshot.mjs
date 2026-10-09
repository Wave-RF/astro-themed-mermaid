// `astro-themed-mermaid screenshot` — one PNG per diagram, per page, per theme,
// for visual regression. Loads the real built HTML (not a stub page with
// hand-copied CSS, which silently mis-renders the polish styles), so what you
// see is what the site will serve. Output: <out>/<page>-<theme>-<n>.png.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverPages, withThemedPages } from "./cli.mjs";

/** `<slug with / as ->-<theme>-<n>.png` (n is 1-based). Pure. */
export function screenshotName(slug, theme, n) {
  return `${slug.replace(/\//g, "-")}-${theme}-${n}.png`;
}

export async function run(opts) {
  const pages = await discoverPages(resolve(opts.dist), opts.pages);
  if (pages.length === 0) {
    console.log("no built pages with diagrams found");
    return;
  }
  const out = resolve(opts.out);
  await mkdir(out, { recursive: true });
  await withThemedPages(opts, opts.scale, async (open) => {
    for (const theme of opts.themes) {
      const { ctx, page } = await open(theme);
      for (const p of pages) {
        await page.goto(pathToFileURL(p.file).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts?.ready);
        const count = await page.$$eval(opts.selector, (svgs) => svgs.length);
        for (let i = 0; i < count; i++) {
          // Scroll the i-th svg into view, then clip the PAGE screenshot to its
          // bbox. Screenshotting the SVG element directly drops document CSS for
          // its foreignObject HTML content; clipping the page does not.
          const box = await page.evaluate(
            ({ selector, idx }) => {
              const svg = document.querySelectorAll(selector)[idx];
              svg.scrollIntoView({ block: "center" });
              const r = svg.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            },
            { selector: opts.selector, idx: i }
          );
          const name = screenshotName(p.slug, theme, i + 1);
          await page.screenshot({
            path: resolve(out, name),
            clip: {
              x: Math.max(0, box.x - 20),
              y: Math.max(0, box.y - 20),
              width: box.w + 40,
              height: box.h + 40,
            },
          });
          console.log(`ok ${opts.out}/${name}`);
        }
      }
      await ctx.close();
    }
  });
}
