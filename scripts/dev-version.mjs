// Prints the content-addressed dev version used by the `@dev` dist-tag publish
// in .github/workflows/publish-npm.yml:
//
//   0.0.0-dev.h<sha256(published code + package.json sans version)[:12]>
//
// `0.0.0-dev.*` always sorts below any real `0.x` release and lives on its own
// dist-tag, so a `^0.3.0` consumer can never resolve to it. The hash is over the
// shipped CODE (index.mjs/index.d.ts/styles.css) + package.json with `version`
// removed, so an unchanged build maps to an already-published version and the
// workflow skips it. Mirrors the sha256().slice(0,12) content-addressing in
// index.mjs (diagramKey). If a new code file is added to the `files` allowlist,
// add it to HASHED_FILES below.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HASHED_FILES = ["index.mjs", "index.d.ts", "styles.css"];

const h = createHash("sha256");
for (const f of HASHED_FILES) {
  h.update(`${f}\0`);
  h.update(readFileSync(f));
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
delete pkg.version;
h.update("package.json\0");
h.update(JSON.stringify(pkg));

process.stdout.write(`0.0.0-dev.h${h.digest("hex").slice(0, 12)}`);
