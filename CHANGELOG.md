# Changelog

All notable changes to `@wave-rf/astro-themed-mermaid` are documented here. From
the next release onward this file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commit](https://www.conventionalcommits.org/) messages — don't
hand-edit it.

The entries below predate automated releases (they map to the git tags
`v0.1.0`–`v0.3.0`).

## 0.3.0

- **feat:** `measurementCss` option so label metrics match at measure time, fixing labels that clipped when the display weight/letter-spacing differed from the measured one.

## 0.2.0

- **feat:** per-diagram render cache behind a new `rehypeMermaid` export — a document whose diagrams are all cached never launches the headless browser.

## 0.1.1

- **fix:** register the inlined `@font-face` under its primary family name, not the whole CSS font stack, so build-time measurement uses the real font.

## 0.1.0

- Initial release: build-time, theme-aware Mermaid diagrams for Astro / Starlight — color-agnostic SVG rewriting on top of `rehype-mermaid`.
