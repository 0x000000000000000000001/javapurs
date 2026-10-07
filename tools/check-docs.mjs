import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandSync } from "./test-process.mjs";
import { portSuites } from "./port-test-runner.mjs";

// Read-only checks for this workspace's Markdown conventions. Node and Bash
// suffice: no compiler imports, network requests or execution of examples.
assert.equal(process.argv.length, 2, "check-docs.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const ports = Object.values(portSuites).map(suite => suite.directory);
const documents = [
  join(root, "README.md"), join(root, "../todo.md"),
  ...readdirSync(join(root, "docs")).filter(name => name.endsWith(".md")).sort().map(name => join(root, "docs", name)),
  ...ports.map(name => join(root, "..", name, "README.md")),
];
const read = path => readFileSync(path, "utf8");
const withoutCode = text => text.replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```[ \t]*$/gm, "");
const anchors = new Map();

function headingAnchors(path) {
  if (anchors.has(path)) return anchors.get(path);
  const text = withoutCode(read(path));
  const result = new Set();
  for (const [, title] of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const plain = title.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "").replace(/ /g, "-");
    let slug = base;
    for (let suffix = 1; result.has(slug); suffix++) slug = `${base}-${suffix}`;
    result.add(slug);
  }
  for (const [, anchor] of text.matchAll(/<a\s+(?:id|name)=["']([^"']+)/g)) result.add(anchor);
  anchors.set(path, result);
  return result;
}

function section(text, heading) {
  const start = text.indexOf(`${heading}\n`);
  assert.ok(start >= 0, `Missing section: ${heading}`);
  const rest = text.slice(start + heading.length + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

let links = 0, examples = 0;
for (const document of documents) {
  const text = read(document);
  for (const [, href] of withoutCode(text).matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const [file, anchor] = decodeURIComponent(href).split("#");
    const target = resolve(dirname(document), file || document);
    const label = `${relative(root, document)}: ${href}`;
    assert.ok(statSync(target, { throwIfNoEntry: false }), `Missing local target: ${label}`);
    if (anchor && extname(target) === ".md") {
      assert.ok(headingAnchors(target).has(anchor), `Missing Markdown anchor: ${label}`);
    }
    links++;
  }
  let index = 0;
  for (const [, block] of text.matchAll(/^ {0,3}```(?:bash|sh)\n([\s\S]*?)^ {0,3}```/gm)) {
    index++;
    try { runCommandSync("bash", ["-n"], { input: block, encoding: "utf8", stdio: "pipe", timeout: 5000 }); }
    catch (cause) { throw new Error(`${relative(root, document)}: shell example ${index}`, { cause }); }
    examples++;
  }
}

const testing = read(join(root, "docs/testing.md"));
const matrix = section(testing, "## Matrice des tests").split("### Entrées optionnelles")[0];
const documented = [...new Set([...matrix.matchAll(/\(\.\.\/test\/([^()]+\.mjs)\)/g)].map(match => match[1]))].sort();
const scripts = readdirSync(join(root, "test")).filter(name => name.endsWith(".mjs")).sort();
assert.deepEqual(documented, scripts, "Test matrix must list each direct suite");
const readme = read(join(root, "README.md"));
assert.ok(readme.includes(`covers all ${scripts.length} scripts`), "README suite count is stale");

const config = read(join(root, "src/Javapurs/Config.purs"));
const flags = [...new Set([...config.matchAll(/"(--[^"\s]+)"/g)].map(match => match[1]))].sort();
const options = [...section(readme, "### Compiler options").matchAll(/^\| `(--[^`]+)`/gm)]
  .map(match => match[1].split(" ")[0]).sort();
assert.deepEqual(options, flags, "README options must match Config");

const plan = read(join(root, "../todo.md"));
const lots = [...plan.matchAll(/^- \[([ xX])\] \*\*(M\d{2}) — (\d+) points/gm)]
  .map(([, state, name, weight]) => ({ done: state.toLowerCase() === "x", name, weight: Number(weight) }));
assert.ok(lots.length > 0, "The active plan must have milestones");
assert.equal(new Set(lots.map(lot => lot.name)).size, lots.length, "Milestone names must be unique");
assert.ok(lots.every(lot => lot.weight > 0), "Milestone weights must be positive");
assert.equal(lots.reduce((sum, lot) => sum + lot.weight, 0), 100, "The active plan totals 100 points");
const completed = lots.filter(lot => lot.done);
const score = completed.reduce((sum, lot) => sum + lot.weight, 0);
const completionLabel = completed.length === 1 ? "lot terminé" : "lots terminés";
assert.ok(plan.includes(`**${score} / 100 points validés — ${score} % — ${completed.length} ${completionLabel} sur ${lots.length}.**`), "Plan summary is stale");
// Supplementary unweighted milestones keep the closed plan's score, but their
// checked boxes still require the same dated validation record.
for (const [, name] of plan.matchAll(/^- \[[xX]\] \*\*(M\d{2}) — /gm)) {
  assert.ok(testing.includes(`## Validation ${name}\n`), `Missing validation record: ${name}`);
}

console.log(`${links} local links/anchors and ${examples} Bash examples checked across ${documents.length} documents`);
console.log(`${scripts.length} suites, ${flags.length} CLI options; progress ${score}/100 (${completed.length}/${lots.length} milestones)`);
