import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for the local package paths shared by every standard
// port. Package-specific extras (js-bigints, node-child-process) stay declared
// by the port and are appended in sorted order.
const commonPackages = [
  "aff", "arrays", "assert", "avar", "catenable-lists", "console", "datetime",
  "effect", "enums", "exceptions", "foldable-traversable", "foreign",
  "foreign-object", "free", "functions", "integers", "js-date", "js-promise",
  "js-promise-aff", "lazy", "node-buffer", "node-event-emitter", "node-fs",
  "node-http", "node-net", "node-path", "node-process", "node-streams", "now",
  "nullable", "numbers", "ordered-collections", "partial", "prelude",
  "quickcheck", "random", "record", "refs", "run", "spec", "spec-discovery",
  "st", "strings", "strings-extra", "unfoldable", "unsafe-coerce", "uuid",
  "variant", "yoga-json",
].map(name => [name, `../javapurs-${name}`]);
const commonNames = new Set(commonPackages.map(([name]) => name));

const root = fileURLToPath(new URL("../", import.meta.url));
const configs = () => readdirSync(resolve(root, ".."), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith("javapurs-"))
  .map(entry => resolve(root, "..", entry.name, "spago.java.yaml"))
  .filter(existsSync)
  .sort();

function parseExtraPackages(text) {
  const block = text.match(/^  extraPackages:\n([\s\S]*)$/m);
  if (!block) throw new Error("missing extraPackages block");
  return [...block[1].matchAll(/^    ([^:\n]+):\n      path: "([^"]+)"$/gm)]
    .map(([, name, path]) => [name, path]);
}

function expectedPackages(actual, self) {
  const extras = actual.filter(([name]) => !commonNames.has(name)).sort(([a], [b]) => a.localeCompare(b));
  return [...commonPackages.filter(([name]) => name !== self), ...extras];
}

function render(packages) {
  return "  extraPackages:\n" + packages
    .map(([name, path]) => `    ${name}:\n      path: "${path}"`)
    .join("\n") + "\n";
}

function rewrite(path, packages) {
  const text = readFileSync(path, "utf8");
  const block = text.match(/^  extraPackages:\n[\s\S]*$/m);
  if (!block) throw new Error(`${path}: missing extraPackages block`);
  const next = text.slice(0, block.index) + render(packages);
  if (next !== text) writeFileSync(path, next);
  return next !== text;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check");
assert.ok(args.every(arg => arg === "--write" || arg === "--check") && !(write && check),
  "usage: port-configs.mjs [--check|--write]");
let changed = 0;
for (const path of configs()) {
  const text = readFileSync(path, "utf8");
  const actual = parseExtraPackages(text);
  const self = path.split("/").at(-2).replace(/^javapurs-/, "");
  const expected = expectedPackages(actual, self);
  const missing = expected.filter(([name]) => !actual.some(([actualName]) => actualName === name));
  const extra = actual.filter(([name]) => !commonNames.has(name));
  assert.equal(missing.length, 0, `${path}: missing common packages: ${missing.map(([name]) => name).join(", ")}`);
  assert.ok(extra.every(([name, local]) => statSync(resolve(path, "..", local), { throwIfNoEntry: false })),
    `${path}: missing local extra package`);
  if (write) {
    if (rewrite(path, expected)) changed++;
  } else {
    assert.equal(render(actual), render(expected), `${path}: extraPackages order/path drift`);
  }
}
console.log(write ? `Port configs: ${changed} file(s) rewritten.` : `Port configs: ${configs().length} file(s) canonical.`);
