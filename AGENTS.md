# AGENTS.md — AI agent instructions for `@wave-rf/astro-themed-mermaid`

Context for AI coding agents (Claude Code, Copilot, Cursor, etc.) working on this repo. `CLAUDE.md` is a thin pointer here.

## Operating Rules

The non-negotiables, ordered by how often agents miss them. These override convenience: if a rule blocks you, satisfy it; don't work around it.

1. **Validate locally before every push** — `pnpm run verify` (Biome + `node --test`). Don't use CI as your first feedback loop ([§Local-First Validation](#local-first-validation)).
2. **A PR-branch push needs every pre-push reviewer satisfied** — run **`/prepush`**: it reads `scripts/pre-push-reviewers.sh`, runs the reviewers the change needs in parallel (fresh context), skips the rest *on the record*, and loops until each it ran returns `ship_it` ([§Agent PR Discipline](#agent-pr-discipline)).
3. **Every public-surface change updates its docs in the same PR** — a changed `themedMermaid` option / export / default must update `index.d.ts` **and** `README.md`; a changed invariant updates its README/`example/` note ([§Documentation Sync](#documentation-sync)). The `CHANGELOG.md` is **auto-generated** — don't hand-edit it; just use the right Conventional-Commit type.
4. **Address and resolve every review finding** — fix it or track it in an issue; never silently drop one ([§Review Response](#review-response)).
5. **Drafts only; valid title** — `gh pr create --draft` (never `gh pr ready`/approve); the PR **title** must pass Conventional Commits — check with `scripts/lint-pr-title.sh "<title>"` before creating ([§Agent PR Discipline](#agent-pr-discipline)).
6. **Never force-push or rebase a PR branch** — to absorb upstream, `git merge origin/main` ([§Branch Maintenance](#branch-maintenance)).
7. **Never hand-write markers or `--no-verify`** — if you're tempted, the gate is wrong-shaped for your situation; fix that instead ([§Don't bypass the gates](#dont-bypass-the-gates)).

## Project Overview

A small, **pure-ESM** Astro/Starlight **build-time** plugin. It renders Mermaid diagrams with [`rehype-mermaid`](https://github.com/remcohaszing/rehype-mermaid) (inline SVG, SSR'd in headless Chromium at build), then **rewrites the emitted SVG** to be theme-aware: `<br></br>` → `<br>`, baked colors → the consumer's `var(--…)` references, forced-white label color stripped, cluster-title pills re-centered + lifted, viewBox padded.

There is **no build step**: `index.mjs` (the whole implementation), the hand-written `index.d.ts`, and `styles.css` are what publish. No network, runtime, or auth surface — it runs only at the consumer's build time.

`themedMermaid(config)` returns four wiring pieces: `remarkInjectClassdefs` (remark plugin), `rehypeMermaidOptions` (raw rehype-mermaid options) and `rehypeMermaid` (the cached drop-in rehype plugin), and `integration` (the Astro integration that does the SVG rewrite at `astro:build:done`).

## Key Invariants

What must stay true. Preserve the named invariant when you touch its code; each is guarded by a `node:test` case — keep the guard meaningful.

1. **Color-agnostic** — the module **defines no colors**. Colors enter only as the right-hand side of `colorReplacements` (the consumer's `var(--…)`). Don't introduce a hex/rgb literal into the module's logic (`styles.css` and `example/` are the consumer-side surface and are exempt).
2. **SVG rewriting is regex over Mermaid's output**, scoped by `aria-roledescription` (`SVG_BLOCK_RE` = all diagram types; `FLOWCHART_SVG_RE` = flowcharts). Developed against **Mermaid v11.x**. A regex change must not **over-match** (touch non-Mermaid HTML — see #3) or **under-match** (miss a diagram), and must avoid catastrophic backtracking. A change that assumes a different Mermaid output shape needs a test + a README/`example/` note.
3. **The `astro:build:done` hook is idempotent and touches only Mermaid output.** Re-running must not double-rewrite; a page with no Mermaid must come out byte-identical (even a `<pre><code>` sample that contains a literal Mermaid-looking string).
4. **Render cache is content-addressed and best-effort.** `diagramKey` = `sha256(diagram source + render options + package/toolchain versions)` — every input that changes output must be in the key, or a stale entry ships. A corrupt/unreadable/unwritable entry degrades to a normal render, **never** a failed build; `cache: false` never touches disk. Stored entries are re-id'd to content-derived ids so two builds can't collide on one page.
5. **The fully-cached fast path must not import `rehype-mermaid`.** `rehype-mermaid` is a peer dep; a document whose diagrams all hit the cache must skip the browser *and* not import it (the import is dynamic, on miss only). Don't hoist that import to module top-level.
6. **classDef injection** (`remarkInjectClassdefs`) fires only on `mermaid` code blocks starting with `flowchart`/`graph`, after the header line — not other diagram types, not non-mermaid code.
7. **Font + label measurement** — an inlined `@font-face` is named for the **primary family**, not the whole CSS font stack; `measurementCss` must reach the build-time render page, and its selectors must be **bare** (no `svg[aria-roledescription…]` ancestor — a no-op at measure time).
8. **`PAD_TOP` (22px in `index.mjs`) is paired with the CSS `translateY(-17px)`** that lifts the cluster-title pill. Change one → revisit the other, or the pill clips.
9. **`securityLevel` defaults to `"strict"`** — don't silently loosen it.
10. **ESM + Node ≥ 20** (`package.json` `engines`) — no CommonJS, no newer-only syntax/APIs.

## Build & Test Commands

```bash
pnpm install            # resolve deps (no committed lockfile — it's a library)
pnpm run setup          # one-time: install git hooks (git config core.hooksPath .githooks)
pnpm test               # node --test
pnpm run check          # biome check . (lint + format check) — the CI gate
pnpm run format         # biome format --write . (auto-fix formatting)
pnpm run lint           # biome lint .
pnpm run verify         # biome check . && node --test, then write the tree marker
```

Biome owns JS/TS/JSON formatting + lint (CSS is intentionally out of scope so `styles.css` stays hand-tuned). Run `pnpm run format` to fix formatting; the Claude format-on-save hook keeps edited files clean automatically.

## Local-First Validation

**Validate locally before pushing.** `pnpm run verify` runs the same gates as CI (Biome + `node --test`). On success it writes the tree-keyed marker `tmp/verify-passed-tree-<TREE>` (`tmp/` is gitignored).

Enforced via git hooks (installed by `pnpm run setup`; apply to humans and agents alike):

- **`.githooks/pre-commit`** runs `pnpm run verify` unless the current tree's marker already exists (cached).
- **`.githooks/pre-push`** requires `tmp/verify-passed-tree-<TREE>` for each pushed commit's tree. Tree-keyed, so `verify → commit → push` needs no re-run when the tree is unchanged. Skipped on CI (`$CI` set).

Bypass (`--no-verify`) is for human WIP only; agents must not (§Don't bypass the gates).

## Release Process

Releases are **automated by release-please** from Conventional Commits — you rarely touch a version by hand. The flow:

1. Land PRs with Conventional-Commit titles (squash-merge → the title is the commit release-please parses).
2. release-please maintains an open **release PR** that bumps `package.json` `version`, updates `CHANGELOG.md`, and updates `.release-please-manifest.json`. During 0.x: **breaking (`feat!`/`BREAKING CHANGE`) → minor**, **`feat`/`fix` → patch** (see `release-please-config.json`), so `^0.x` consumers safely auto-update.
3. **Merging the release PR** ships it: release-please tags `vX.Y.Z` + creates the GitHub Release, and the same `publish-npm.yml` run publishes to npm (`latest`, or `alpha`/`beta`/`rc`/`next` for a prerelease) with provenance via OIDC.
4. Independently, **every push to `main`** publishes a content-addressed `0.0.0-dev.<hash>` under the **`dev`** dist-tag (never the `latest` consumers get).

Use **`/release`** to inspect the pending release. Don't hand-edit `CHANGELOG.md` / `version` / the manifest — release-please owns them. **First-time setup** (npm org, one-time manual publish, OIDC trusted publisher, optional PAT, branch protection) lives in [`RELEASING.md`](RELEASING.md).

## Review Response

Every review finding gets a substantive reply and is addressed — fixed, or tracked in an issue — before merge. Decide: accept, push back (with reasoning), or defer (open a tracking issue and link it). Never silently drop a finding, including ones outside the lane of whichever reviewer raised it. Bot reviewers (if configured) re-engage via their own trigger (e.g. `@coderabbitai review` in a PR comment — `gh pr comment` is allowed for agents).

## Branch Maintenance

To absorb upstream `main` into a PR branch — **merge, don't rebase**:

```bash
git fetch origin main
git merge origin/main --no-edit
```

Force-pushes (`--force`, `--force-with-lease`) are blocked by `.claude/settings.json` and by branch protection, and would lose inline review-thread anchors. Rebase requires a force-push, so it's wrong for the same reason. The `pre-push` hook will block until `pnpm run verify` re-runs after the merge (the merge commit's tree is new) — that's intended. If the merge conflicts, surface it to a human rather than auto-resolving.

## Agent PR Discipline

Agents follow the universal git hooks (pre-commit + pre-push in `.githooks/`). On top of that, PR-workflow rules with no human analog are checked by `.claude/hooks/agent-bash-gate.sh`. The gate is a guard rail against accidents, not adversarial enforcement.

### Drafts only

Create PRs with `gh pr create --draft`. Only humans flip draft → ready (`gh pr ready` is blocked) and only humans approve / request changes (`gh pr review --approve`/`--request-changes` are blocked). Adding/removing human reviewers is humans-only.

**PR title format** — the title becomes the squash-merge subject on `main` (which release-please parses), and is gated by the required `pr-title` check. Conventional Commits: `<type>(optional-scope)(optional-!): <subject>`, **≤ 72 chars**, subject lowercase-first, no trailing period. Types: `feat fix docs refactor test chore ci deps build perf revert style`. Validate before creating: `scripts/lint-pr-title.sh "<title>"`. The same script backs the local gate and the CI check, so they never drift.

### Pre-push self-review is mandatory on PR branches

Before pushing a non-main branch, **every** reviewer in `scripts/pre-push-reviewers.sh` must have a marker for HEAD — earned by **running** it (fresh context; writes its marker on `VERDICT: ship_it`) or by a **logged skip** (`scripts/skip-pre-push-review.sh <name> "<reason>"`) when it's genuinely out of lane. The list is the single source of truth — read it; don't hardcode it. The one-command form is **`/prepush`**. Today the gating reviewers are:

- **`pre-push-reviewer`** (code) — the full diff vs `main`, the latest commit, open PR comments/reviews, CI status, linked issues.
- **`docs-reviewer`** (docs) — `README.md`/`CONTRIBUTING.md`/`index.d.ts` JSDoc/`example/` for accuracy-vs-code, runnable examples, clarity, **plus** code↔docs sync (code that changed but whose docs didn't).

**`ship_it` requires zero findings at any severity** — a single `[MAY]` forces `iterate`. The orchestrator loops: address every finding, commit, re-invoke the reviewer(s) in fresh context, until all say `ship_it`. The push gate (`agent-bash-gate.sh`) lists any missing markers; `git push` succeeds only when every listed reviewer has one. On `block`, stop and surface it to the user.

### Adding a pre-push reviewer

The set is meant to grow (security is the obvious next). With **no** hook edits (they read the list at push time):

1. Write the subagent at `.claude/agents/<name>.md` (model it on `pre-push-reviewer.md`; end with the parseable `VERDICT: ship_it|iterate|block` line under the same strict rubric).
2. Add `<name>` to `scripts/pre-push-reviewers.sh` — *after* step 1 (a name with no agent file blocks every push until it exists).

The marker `tmp/<name>-passed-<HEAD>` is then required automatically, `review-marker.sh` writes it on `ship_it`, and `/prepush` launches it alongside the rest.

### Don't bypass the gates

- `--no-verify` is for human WIP; agents don't use it.
- Markers are written by tooling, never by hand: `tmp/verify-passed-tree-*` by `pnpm run verify`; `tmp/<reviewer>-passed-*` by the `review-marker.sh` SubagentStop hook on `ship_it`, or by `scripts/skip-pre-push-review.sh` for a deliberately-skipped reviewer (which logs the reason). Don't `touch`/`Write`/`Edit` a marker. To skip, use the skip command so it's recorded.

These are policy, not mechanically enforced — an agent can edit the gate itself. Trust beats whack-a-mole.

## Documentation Sync

Every change to the public surface updates its docs in the same PR:

| Change | Files to update |
| ------ | --------------- |
| Add/modify a `themedMermaid` option or its default | `index.d.ts` (the type + JSDoc), `README.md` (Config table + relevant section) |
| Add/modify an export or the returned wiring pieces | `index.d.ts`, `README.md` (Usage), `example/` |
| Change an invariant (`PAD_TOP`↔`translateY`, supported Mermaid version, cache keying) | `README.md` (the relevant note), `example/` |
| Change the package name / `exports` / `engines` / peer deps | `README.md` (Install + Usage), `package.json` |
| Any change | a Conventional-Commit message (release-please writes `CHANGELOG.md`) |

Before finishing, grep the identifiers you touched (option names, the constant) across `README.md`/`index.d.ts`/`example/` to catch staleness. Prose quality + code↔docs sync are gated by the `docs-reviewer`.

## Worktree workflow (`wt`)

This repo is set up for [Worktrunk](https://github.com/) (`wt`, config in `.config/wt.toml`): `wt switch --create <branch>` seeds `node_modules/` from main (per `.worktreeinclude`), runs `pnpm install`, and installs the git hooks (`pnpm run setup`). `.worktrees/` is gitignored. `wt` is an external tool (install it separately); without it, the manual equivalent is `git worktree add` + `pnpm install` + `pnpm run setup`.

## File Structure

```text
index.mjs               → the entire implementation (factory + remark/rehype/integration wiring + render cache)
index.d.ts              → hand-written public types (the API reference; ships)
styles.css              → the bundled stylesheet (ships; paired with PAD_TOP — see #8)
example/                → copy-pasteable reference config + stylesheet (not published)
test/plugin.test.mjs    → node:test suite — the guard against Mermaid-version drift
scripts/                → shell + node tooling (PR-title lint, reviewer manifest, markers, dev-version, repo setup)
.githooks/              → universal pre-commit + pre-push (installed via pnpm run setup)
.claude/                → settings, review subagents, /prepush + /release commands, gate/marker/format hooks
.github/                → CI, pr-title, publish (release-please + OIDC), dependabot; prompts/ review rubrics
release-please-config.json, .release-please-manifest.json  → release automation
```

## CI / Automation

- **`ci.yml`** — Biome `check` + `node --test` on every PR/push (Node 20, the declared floor).
- **`pr-title.yml`** — Conventional-Commit title check (required).
- **`publish-npm.yml`** — release-please + OIDC publish to `latest`/prerelease, and the `@dev` content-addressed channel on every main push.
- **`dependabot.yml` + `dependabot-automerge.yml`** — weekly grouped dep/action bumps; patch/minor auto-merge after CI, major held for review.
- Third-party actions are pinned to commit SHAs with version comments where verified (`googleapis/release-please-action`, `dependabot/fetch-metadata` are on major tags pending a SHA pin).
