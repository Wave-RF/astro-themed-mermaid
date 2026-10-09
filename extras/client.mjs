// Browser-side lightbox for `diagramZoom` (injected as a Vite-bundled page
// script by ./zoom.mjs — import `@wave-rf/astro-themed-mermaid/zoom` instead of
// using this directly). Dense diagrams read small inline; clicking one opens a
// lightbox that always FITS the viewport (small diagrams scale up, capped 2.5x;
// oversized ones scale down — no scrollbars by default). Diagrams larger than
// the stage also get a 1:1 toggle: natural size with pan + edge fades.
//
// Event delegation on `document` plus a window flag keep init idempotent and
// safe across Astro view-transition navigations.

import { diagramSlug, downloadName, pngUrl, resolveTheme } from "./shared.mjs";

const FLAG = "__astroThemedMermaidZoomInit";

/** @param {import('./zoom.mjs').DiagramZoomOptions & {base?: string}} opts fully resolved options */
export function initDiagramZoom(opts) {
  if (typeof window === "undefined" || window[FLAG]) return;
  window[FLAG] = true;

  const { selector: DIAGRAM, labels, base, outDir, themes, png } = opts;
  let overlay = null;
  let lastTrigger = null;
  // Which build-time PNG variant Copy/Download target: solid card (false) or the
  // transparent export (true). Sticky across opens.
  let exportTransparent = false;

  function close() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.documentElement.style.removeProperty("overflow");
    const t = lastTrigger;
    lastTrigger = null;
    // Let the fade-out run before hiding (keeps it out of the a11y tree).
    window.setTimeout(() => overlay?.setAttribute("hidden", ""), 180);
    if (t && typeof t.focus === "function") t.focus();
  }

  // ---- PNG export ----
  // Build-time assets live at <base>/<outDir>/<slug>/<index>-<theme>[-transparent].png.
  // The build step and this code index diagrams by the SAME selector + DOM order.
  function currentTheme() {
    const el = document.querySelector(opts.themeTarget) || document.documentElement;
    const prefersDark = !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return resolveTheme(el.getAttribute(opts.themeAttr), themes, prefersDark);
  }
  function urlFor(transparent) {
    return pngUrl({
      base,
      outDir,
      slug: overlay.__slug,
      index: overlay.__index,
      theme: currentTheme(),
      transparent,
    });
  }

  let toastTimer = null;
  function showToast(msg, isError) {
    const el = overlay.querySelector(".mermaid-zoom__toast");
    el.textContent = msg;
    el.classList.toggle("is-error", !!isError);
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 1600);
  }

  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function grabPng(mode) {
    const name = downloadName({
      prefix: opts.filenamePrefix,
      slug: overlay.__slug,
      index: overlay.__index,
      transparent: exportTransparent,
    });
    try {
      const res = await fetch(urlFor(exportTransparent));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      // Copy uses the async-clipboard image API; where it's missing (e.g.
      // Firefox) fall back to a download so the button still does something.
      if (mode === "copy" && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
        showToast(labels.copied);
      } else {
        saveBlob(blob, name);
        showToast(labels.downloaded);
      }
    } catch {
      showToast(labels.unavailable, true);
    }
  }

  // Reveal copy/download only once the PNG is confirmed present for the current
  // theme (`astro dev` runs no build hook, so it has none). Copy also needs the
  // clipboard-image API, else it just duplicates download — hide it then.
  function refreshPngButtons() {
    const copyBtn = overlay.querySelector(".mermaid-zoom__copy");
    const dlBtn = overlay.querySelector(".mermaid-zoom__dl");
    const bgBtn = overlay.querySelector(".mermaid-zoom__bg");
    copyBtn.hidden = true;
    dlBtn.hidden = true;
    bgBtn.hidden = true;
    if (!png) return;
    // Probe the solid base (always built alongside the transparent variant).
    fetch(urlFor(false), { method: "HEAD" })
      .then((r) => {
        dlBtn.hidden = !r.ok;
        copyBtn.hidden = !(r.ok && navigator.clipboard && window.ClipboardItem);
        bgBtn.hidden = !r.ok;
      })
      .catch(() => {});
  }

  // The export-bg toggle only changes which PNG copy/download fetch. To make the
  // choice visible, transparent mode swaps the stage backing to a checkerboard.
  function applyExportBg() {
    const stage = overlay.querySelector(".mermaid-zoom__stage");
    const bgBtn = overlay.querySelector(".mermaid-zoom__bg");
    stage.classList.toggle("is-transparent", exportTransparent);
    bgBtn.setAttribute("aria-pressed", String(exportTransparent));
  }

  const icon = (inner, size = 19, extra = "") =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" ` +
    `stroke="currentColor" stroke-width="2" ${extra}>${inner}</svg>`;

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "mermaid-zoom";
    overlay.setAttribute("hidden", "");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", labels.dialog);
    const btn = (cls, label, inner, extra = "", hidden = true) =>
      `<button class="mermaid-zoom__${cls}" type="button" ${hidden ? "hidden" : ""} ${extra} aria-label="${escapeAttr(label)}">${inner}</button>`;
    overlay.innerHTML =
      '<div class="mermaid-zoom__tools">' +
      btn("one", labels.natural, "1:1", 'aria-pressed="false"') +
      btn(
        "bg",
        labels.transparent,
        icon(
          '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M4 4h8v8H4zM12 12h8v8h-8z" fill="currentColor"/>'
        ),
        'aria-pressed="false"'
      ) +
      btn(
        "copy",
        labels.copy,
        icon(
          '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
          19,
          'stroke-linecap="round" stroke-linejoin="round"'
        )
      ) +
      btn(
        "dl",
        labels.download,
        icon(
          '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/>',
          19,
          'stroke-linecap="round" stroke-linejoin="round"'
        )
      ) +
      btn(
        "close",
        labels.close,
        icon('<path d="M6 6l12 12M18 6L6 18"/>', 22, 'stroke-linecap="round"'),
        "",
        false
      ) +
      "</div>" +
      '<div class="mermaid-zoom__toast" role="status" aria-live="polite" hidden></div>' +
      '<div class="mermaid-zoom__stage"></div>';
    overlay.addEventListener("click", (e) => {
      const oneBtn = e.target.closest(".mermaid-zoom__one");
      if (oneBtn) {
        overlay.__setMode?.(oneBtn.getAttribute("aria-pressed") !== "true");
        return;
      }
      // Flip which PNG variant copy/download target (and preview it).
      if (e.target.closest(".mermaid-zoom__bg")) {
        exportTransparent = !exportTransparent;
        applyExportBg();
        showToast(exportTransparent ? labels.exportTransparent : labels.exportSolid);
        return;
      }
      // Copy / download act on the PNG and must NOT fall through to the close
      // test below (their icon <svg> would otherwise confuse it).
      if (e.target.closest(".mermaid-zoom__copy")) return void grabPng("copy");
      if (e.target.closest(".mermaid-zoom__dl")) return void grabPng("download");
      if (e.target.closest(".mermaid-zoom__close")) return void close();
      // Backdrop / stage padding click closes; clicks on the diagram don't.
      if (!e.target.closest("svg")) close();
    });
    document.body.appendChild(overlay);
  }

  // Edge fades for a 1:1 pan: stamp whether more content lies beyond either
  // horizontal edge; zoom.css paints the fades from these attributes.
  function stampFades(stage) {
    stage.toggleAttribute(
      "data-more",
      stage.scrollWidth - stage.clientWidth - stage.scrollLeft > 8
    );
    stage.toggleAttribute("data-more-start", stage.scrollLeft > 8);
  }

  function open(svg) {
    if (!overlay) buildOverlay();
    // Identify which build-time PNG backs this diagram (slug + DOM index), then
    // probe so the copy/download buttons only show when it exists.
    overlay.__slug = diagramSlug(location.pathname, base);
    overlay.__index = [...document.querySelectorAll(DIAGRAM)].indexOf(svg);
    refreshPngButtons();
    applyExportBg();
    const stage = overlay.querySelector(".mermaid-zoom__stage");
    stage.replaceChildren();
    // The stage is reused across opens — clear a prior pan session's fades.
    stage.removeAttribute("data-more");
    stage.removeAttribute("data-more-start");
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
    if (!stage.__fadeBound) {
      stage.__fadeBound = true;
      stage.addEventListener("scroll", () => stampFades(stage), { passive: true });
    }

    // Re-id the clone rather than cloneNode-ing as-is: a Mermaid SVG scopes its
    // entire inline <style> (font-family, themed fills) by the root id and
    // references markers/gradients via url(#id-…). Two elements sharing that id
    // is invalid and resolves refs to the wrong one — the clone then falls back
    // to a wider font and its labels clip. Rewriting every occurrence of the id
    // to a unique one keeps the clone self-contained.
    const oldId = svg.getAttribute("id");
    let markup = svg.outerHTML;
    if (oldId) markup = markup.split(oldId).join(`${oldId}-zoom`);
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    const clone = holder.firstElementChild;
    clone.classList.remove("mermaid-zoomable");
    clone.removeAttribute("tabindex");
    // viewBox carries the intrinsic size; fall back to the rendered size.
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    const natW = vb.length === 4 && vb[2] ? vb[2] : svg.getBoundingClientRect().width;
    const natH = vb.length === 4 && vb[3] ? vb[3] : svg.getBoundingClientRect().height;
    // Fit inside the stage's CONTENT box: its max-width/height (94vw/90vh)
    // include its own padding. Read the padding from computed style rather than
    // duplicating the CSS values here.
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const fit = Math.min(
      (window.innerWidth * 0.94 - padX) / natW,
      (window.innerHeight * 0.9 - padY) / natH
    );
    // ALWAYS fit the diagram to the stage — scaling UP small diagrams (cap 2.5x)
    // and DOWN oversized ones — so the default view never grows scrollbars.
    // Oversized diagrams get a 1:1 toggle instead. Floor the pixel sizes so
    // fractional rounding can't tip a perfect fit into a 1px overflow.
    const fitScale = Math.min(fit, 2.5);
    const sizeTo = (scale) => {
      clone.style.width = `${Math.floor(natW * scale)}px`;
      clone.style.height = `${Math.floor(natH * scale)}px`;
    };
    sizeTo(fitScale);
    clone.style.maxWidth = "none";
    clone.style.minWidth = "0";
    stage.appendChild(clone);

    const oneBtn = overlay.querySelector(".mermaid-zoom__one");
    oneBtn.hidden = !(fit < 0.98); // 1:1 only buys anything when fit shrank it
    oneBtn.setAttribute("aria-pressed", "false");
    overlay.__setMode = (natural) => {
      sizeTo(natural ? 1 : fitScale);
      oneBtn.setAttribute("aria-pressed", String(natural));
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
      requestAnimationFrame(() => stampFades(stage));
    };

    overlay.removeAttribute("hidden");
    // Next frame so the un-hide paints before the open transition.
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    document.documentElement.style.overflow = "hidden";
    overlay.querySelector(".mermaid-zoom__close").focus();
  }

  document.addEventListener("click", (e) => {
    if (overlay && !overlay.hasAttribute("hidden")) return; // already open
    const svg = e.target.closest(DIAGRAM);
    if (!svg) return;
    lastTrigger = svg;
    open(svg);
  });

  document.addEventListener("keydown", (e) => {
    if (overlay && !overlay.hasAttribute("hidden")) {
      if (e.key === "Escape") close();
      return;
    }
    // Enter/Space on a focused diagram opens it.
    if (e.key === "Enter" || e.key === " ") {
      const svg = e.target.closest?.(DIAGRAM);
      if (svg) {
        e.preventDefault();
        lastTrigger = svg;
        open(svg);
      }
    }
  });

  // Make diagrams keyboard-focusable + hint the interaction (idempotent; re-run
  // after every view-transition navigation for the new page's DOM).
  function enhance() {
    for (const svg of document.querySelectorAll(DIAGRAM)) {
      if (svg.dataset.mermaidZoom) continue;
      svg.dataset.mermaidZoom = "1";
      svg.classList.add("mermaid-zoomable");
      svg.setAttribute("tabindex", "0");
      svg.setAttribute("aria-keyshortcuts", "Enter");
    }
  }
  document.addEventListener("astro:page-load", enhance);
  if (document.readyState !== "loading") enhance();
  else document.addEventListener("DOMContentLoaded", enhance);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
