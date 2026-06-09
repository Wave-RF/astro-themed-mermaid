<!--
PR title MUST be Conventional Commits (the required `pr-title` check, and the
squash-merge subject release-please parses for the version bump):
  <type>(optional-scope)(optional-!): <lowercase subject, no trailing period>   (<= 72 chars)
  types: feat fix docs refactor test chore ci deps build perf revert style
  breaking change: add `!` (e.g. `feat!: …`) or a `BREAKING CHANGE:` body footer.
-->

## Summary

<!-- What changed and why. -->

## Test plan

<!-- How you verified it. `pnpm run verify` (Biome + node --test) at minimum. -->

## Checklist

- [ ] `pnpm run verify` passes locally (Biome + `node --test`)
- [ ] Public surface changes (`themedMermaid` options / exports) are reflected in `index.d.ts` **and** `README.md`
- [ ] Changed invariants (e.g. `PAD_TOP` ↔ CSS `translateY`, the supported Mermaid version) noted in the README / `example/`
- [ ] A new behavior or rewrite pass has a `node:test` case guarding it
