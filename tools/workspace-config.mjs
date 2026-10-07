import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const asyncPorts = {
  aff: "javapurs-aff", "js-promise": "javapurs-js-promise",
  "js-promise-aff": "javapurs-js-promise-aff", foreign: "javapurs-foreign",
};
const ffiDependencies = ["aff", "js-promise", "js-promise-aff", "either", "maybe", "parallel"];
const profiles = {
  fixture: { dependencies: [], ports: {} },
  "ffi-ports": { dependencies: ffiDependencies, ports: asyncPorts },
  "port-suite": {
    dependencies: ["aff", "js-promise", "js-promise-aff", "foreign", "either", "maybe", "parallel",
      "datetime", "transformers", "control", "bifunctors"],
    ports: asyncPorts,
  },
};

// This is the maintained Spago template subset, not a general YAML parser:
// package/dependencies, optional test entrypoint/dependencies, registry set and
// JSON-quoted local paths. Reject new structure rather than silently dropping it.
function readTemplate(template) {
  const lines = readFileSync(template, "utf8").split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith("#"));
  let index = 0;
  const unexpected = detail => { throw new Error(`Unexpected workspace template ${template}: ${detail}`); };
  const take = expected => {
    const line = lines[index++];
    if (typeof expected === "string" && line === expected) return;
    const match = expected instanceof RegExp && line?.match(expected);
    if (!match) unexpected(`expected ${expected}, found ${JSON.stringify(line)}`);
    return match[1];
  };
  const dependencies = indent => {
    if (lines[index] === `${indent}dependencies: []`) { index++; return []; }
    take(`${indent}dependencies:`);
    const result = [];
    const pattern = new RegExp(`^${indent}  - ([a-z][a-z0-9-]*)$`);
    while (pattern.test(lines[index] ?? "")) {
      const name = take(pattern);
      if (result.includes(name)) unexpected(`duplicate dependency ${name}`);
      result.push(name);
    }
    if (!result.length) unexpected("expected a non-empty dependency list");
    return result;
  };
  take("package:");
  const name = take(/^  name: ([a-z][a-z0-9-]*)$/);
  const direct = dependencies("  ");
  let test;
  if (lines[index] === "  test:") {
    take("  test:");
    test = { main: take(/^    main: ([A-Z][A-Za-z0-9_.]*)$/), dependencies: dependencies("    ") };
  }
  take("workspace:");
  take("  packageSet:");
  const packageSet = take(/^    registry: ([0-9]+\.[0-9]+\.[0-9]+)$/);
  take("  extraPackages:");
  const extraPackages = {};
  while (index < lines.length) {
    const name = take(/^    ([a-z][a-z0-9-]*):$/);
    if (Object.hasOwn(extraPackages, name)) unexpected(`duplicate local package ${name}`);
    const quoted = take(/^      path: (.+)$/);
    let path;
    try { path = JSON.parse(quoted); } catch { unexpected(`expected a JSON-quoted path for ${name}`); }
    if (typeof path !== "string" || !path || path.includes("\0")) unexpected(`invalid path for ${name}`);
    extraPackages[name] = resolve(dirname(template), path);
  }
  return { name, dependencies: direct, test, packageSet, extraPackages };
}

export function prepareWorkspaceConfig(root, directory, {
  profile = "fixture", template = join(root, "tests/runner/spago.yaml"), registryPackages = [],
} = {}) {
  if (!Object.hasOwn(profiles, profile)) throw new Error(`Unknown workspace profile: ${profile}`);
  const selected = profiles[profile];
  const config = readTemplate(template);
  config.dependencies = [...new Set([...selected.dependencies, ...config.dependencies])];
  for (const [name, checkout] of Object.entries(selected.ports)) {
    const path = resolve(root, "..", checkout);
    if (Object.hasOwn(config.extraPackages, name) && config.extraPackages[name] !== path) {
      throw new Error(`Conflicting local package ${name} in ${template}: ${config.extraPackages[name]} vs ${path}`);
    }
    config.extraPackages[name] = path;
  }
  for (const name of registryPackages) {
    if (!Object.hasOwn(config.extraPackages, name)) throw new Error(`Unknown local package selected from registry: ${name}`);
    delete config.extraPackages[name];
  }
  for (const [name, path] of Object.entries(config.extraPackages)) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Missing package checkout ${name}: ${path}`);
  }
  const configPath = join(directory, "spago.yaml");
  const source = statSync(template), destination = statSync(configPath, { throwIfNoEntry: false });
  // The shared fixture runner already has its template. Recognize filesystem
  // aliases too, and never apply an enriched profile to that source file.
  if (destination && source.dev === destination.dev && source.ino === destination.ino) {
    if (profile !== "fixture" || registryPackages.length) throw new Error(`Cannot apply workspace profile to source template: ${configPath}`);
    return config;
  }
  if (lstatSync(configPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`Workspace configuration must not be a symlink: ${configPath}`);
  }
  const deps = (names, indent) => names.length
    ? `${indent}dependencies:\n${names.map(name => `${indent}  - ${name}\n`).join("")}`
    : `${indent}dependencies: []\n`;
  const tests = config.test ? `  test:\n    main: ${config.test.main}\n${deps(config.test.dependencies, "    ")}` : "";
  const paths = Object.entries(config.extraPackages).map(([name, path]) => `    ${name}:\n      path: ${JSON.stringify(path)}\n`).join("");
  const yaml = `package:\n  name: ${config.name}\n${deps(config.dependencies, "  ")}${tests}`
    + `workspace:\n  packageSet:\n    registry: ${config.packageSet}\n  extraPackages:\n${paths}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(configPath, yaml);
  return config;
}
