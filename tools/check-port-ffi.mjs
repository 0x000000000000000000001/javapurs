import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portSuites } from "./port-test-runner.mjs";

assert.equal(process.argv.length, 2, "check-port-ffi.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const auxiliary = [
  "argonaut-core", "control", "js-bigints", "js-uri",
  "node-child-process", "spec-discovery", "unsafe-reference",
];
const standards = Object.keys(portSuites);
const expected = new Set([...standards, ...auxiliary]);
const text = readFileSync(join(root, "docs", "port-ffi.md"), "utf8");
const rows = new Map();
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^\| `([^`]+)` \|/);
  if (!match || !expected.has(match[1])) continue;
  assert.ok(!rows.has(match[1]), `duplicate FFI row: ${match[1]}`);
  const cells = line.split("|").map(cell => cell.trim());
  const paths = [...(cells[3] ?? "").matchAll(/`(src\/[^`]+\.java)`/g)].map(match => match[1]);
  rows.set(match[1], new Set(paths));
}
assert.deepEqual([...rows.keys()].sort(), [...expected].sort(), "FFI matrix must list every standard and auxiliary port");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".java") ? [path] : [];
  });
}

let files = 0;
for (const name of expected) {
  const directory = resolve(root, "..", portSuites[name]?.directory ?? `javapurs-${name}`);
  const javaFiles = walk(join(directory, "src"));
  for (const path of javaFiles) {
    const module = path.slice(0, -".java".length) + ".purs";
    assert.ok(statSync(module, { throwIfNoEntry: false })?.isFile(),
      `${name}: Java fragment has no adjacent PureScript module: ${relative(directory, path)}`);
  }
  const actual = new Set(javaFiles.map(path => relative(directory, path)));
  const documented = rows.get(name);
  assert.deepEqual([...documented].sort(), [...actual].sort(), `${name}: FFI matrix is stale`);
  files += actual.size;
}
console.log(`Port FFI matrix: ${standards.length} standard, ${auxiliary.length} auxiliary, ${files} Java files checked.`);
