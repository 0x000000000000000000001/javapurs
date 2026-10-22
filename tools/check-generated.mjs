import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandSync } from "./test-process.mjs";

// Rebuild the compiler and verify that tracked JS output is byte-stable.
// Functional suites are intentionally not started here.
assert.equal(process.argv.length, 2, "check-generated.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "output");

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:js|js\.map)$/.test(entry.name) ? [path] : [];
  });
}

function hashes() {
  return Object.fromEntries(files(output).sort().map(path => [
    relative(root, path),
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  ]));
}

const before = hashes();
runCommandSync(join(root, "bin/build"), [], { cwd: root, timeout: 600_000, stdio: "pipe" });
const after = hashes();
assert.deepEqual(after, before, "compiler output is not stable across a rebuild");
console.log(`Generated output: ${Object.keys(after).length} JavaScript/source-map files stable.`);
