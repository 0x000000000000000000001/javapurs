import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portSuites } from "./port-test-runner.mjs";

// Read-only consistency check for the sibling port checkouts. It deliberately
// parses only the small, stable subset of Spago YAML used by these ports.
assert.equal(process.argv.length, 2, "check-port-configs.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const ports = readdirSync(resolve(root, ".."), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith("javapurs-"))
  .map(entry => entry.name)
  .sort();

const suiteByDirectory = new Map(Object.entries(portSuites).map(([key, suite]) => [suite.directory, key]));
const auxiliary = new Set([
  "javapurs-argonaut-core",
  "javapurs-control",
  "javapurs-js-bigints",
  "javapurs-js-uri",
  "javapurs-node-child-process",
  "javapurs-spec-discovery",
  "javapurs-unsafe-reference",
]);
const expectedLauncher = /--port="?\$\{PORT#javapurs-\}"?/;
const standard = [];
const extras = [];
let localPaths = 0;

for (const name of ports) {
  const directory = resolve(root, "..", name);
  const launcher = resolve(directory, "bin/test");
  const javaConfig = resolve(directory, "spago.java.yaml");
  const config = existsSync(javaConfig) ? javaConfig : resolve(directory, "spago.yaml");
  if (!existsSync(launcher)) {
    assert.ok(auxiliary.has(name), `${name}: missing bin/test without an auxiliary classification`);
    assert.ok(existsSync(config), `${name}: auxiliary port has no Spago configuration`);
    extras.push(name);
  } else {
    assert.ok(!auxiliary.has(name), `${name}: standard port is marked auxiliary`);
    assert.ok(existsSync(javaConfig), `${name}: standard port has no spago.java.yaml`);
    assert.ok(suiteByDirectory.has(name), `${name}: no portSuites profile`);
    assert.match(readFileSync(launcher, "utf8"), expectedLauncher, `${name}: launcher is not the shared dispatcher`);
    standard.push(name);
  }
  if (!existsSync(config)) continue;
  const text = readFileSync(config, "utf8");
  const packageName = text.match(/^package:\n  name: (.+)$/m)?.[1];
  assert.ok([name.slice("javapurs-".length), name].includes(packageName), `${name}: unexpected package name ${packageName}`);
  if (!auxiliary.has(name)) {
    assert.match(text, /^  packageSet:\n    registry: 77\.7\.0$/m, `${name}: unexpected package set`);
  }
  for (const [, path] of text.matchAll(/^      path: "(.+)"$/gm)) {
    const target = resolve(directory, path);
    assert.ok(statSync(target, { throwIfNoEntry: false }), `${name}: missing local package path ${path}`);
    localPaths++;
  }
}

assert.equal(standard.length, 48, `expected 48 standard launchers, found ${standard.length}`);
assert.deepEqual(extras, [...auxiliary].sort(), "auxiliary port classification is stale");
console.log(`Ports: ${standard.length} standard, ${extras.length} auxiliary, ${localPaths} local paths checked.`);
