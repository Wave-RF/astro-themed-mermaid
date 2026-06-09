# Contributing

Thanks for contributing to `@wave-rf/astro-themed-mermaid`.

## Setup

```sh
pnpm install      # resolve deps (there's no committed lockfile — it's a library)
pnpm run setup    # one-time: install the git hooks (pre-commit + pre-push)
```

Node ≥ 20. The package is pure ESM with no build step — `index.mjs`, `index.d.ts`, and `styles.css` are what ship.

## Develop

```sh
pnpm test          # node --test
pnpm run check     # Biome lint + format check (what CI runs)
pnpm run format    # auto-fix formatting
pnpm run verify    # check + test together (the local gate; what the hooks run)
```

Biome owns JS/TS/JSON style; `styles.css` is hand-tuned and intentionally out of Biome's scope. The `node:test` suite in `test/plugin.test.mjs` is the guard against Mermaid-version drift — **add a test** for any new rewrite pass, option, or cache behavior, and don't weaken the existing regression guards. See [AGENTS.md §Key Invariants](AGENTS.md#key-invariants) for what must stay true (the color-agnostic rule, the regex-over-Mermaid-SVG coupling, the `PAD_TOP`↔CSS pairing, the render cache).

## Pull requests

- **Title must be [Conventional Commits](https://www.conventionalcommits.org/):** `<type>(scope): subject`, ≤ 72 chars, lowercase subject, no trailing period. Types: `feat fix docs refactor test chore ci deps build perf revert style`. A breaking change uses `feat!:` (or a `BREAKING CHANGE:` body footer). The title becomes the squash-merge commit and **drives the version bump** — check it with `scripts/lint-pr-title.sh "<title>"`.
- Run `pnpm run verify` before pushing; the pre-push hook requires it.
- Update `index.d.ts` + `README.md` when you change the public surface (see [AGENTS.md §Documentation Sync](AGENTS.md#documentation-sync)). **Don't** hand-edit `CHANGELOG.md` — it's generated from commit messages.
- PRs merge via **squash**; required checks (`ci`, `pr-title`) must pass.

## Releases

Automated — you don't bump versions or tag by hand. Merges to `main` accumulate into a release PR (maintained by release-please); merging that PR publishes to npm. During 0.x, breaking changes bump the minor and features/fixes bump the patch, so `^0.x` consumers auto-update safely. Maintainers: see [RELEASING.md](RELEASING.md).
