#!/usr/bin/env node
import { main } from "../tools/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`astro-themed-mermaid: ${err?.message || err}\n`);
    process.exitCode = 1;
  }
);
