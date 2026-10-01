import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Selection is read-only: resolve every explicit name and boundary before any
// build, cleanup, or workspace preparation starts.

export class UsageError extends Error {}

const PORT_PREFIX = "javapurs-";

export function parseOptions(args, { fixture = false } = {}) {
  const options = { targets: [], clean: false, list: false, all: false, keep: false, resume: null, until: null, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") { options.targets.push(...args.slice(i + 1)); break; }
    if (arg === "-c" || arg === "--clean") options.clean = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--keep-going") options.keep = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--skip-before") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new UsageError("--skip-before needs a name.");
      options.resume = value;
    } else if (arg.startsWith("--skip-before=") || arg.startsWith("skip_before=")) {
      options.resume = arg.slice(arg.indexOf("=") + 1);
      if (!options.resume) throw new UsageError("--skip-before needs a name.");
    } else if (fixture && arg === "--until") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new UsageError("--until needs a name.");
      options.until = value;
    } else if (fixture && (arg.startsWith("--until=") || arg.startsWith("until="))) {
      options.until = arg.slice(arg.indexOf("=") + 1);
      if (!options.until) throw new UsageError("--until needs a name.");
    } else if (arg.startsWith("-") || arg.includes("=")) throw new UsageError(`Unknown option: ${arg}`);
    else options.targets.push(arg);
  }
  if (options.all && options.targets.length) throw new UsageError("Use --all or explicit names, not both.");
  return options;
}

function resumeFrom(items, options, matches) {
  if (!options.resume) return items;
  const index = items.findIndex(item => matches(item, options.resume));
  if (index < 0) throw new UsageError(`Resume target not found in selection: ${options.resume}`);
  return items.slice(index);
}

function isFile(path) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

const excludedFixtures = new Set([
  "DerivingClause", "DerivingContravariant", "DerivingFunctorFromBi",
  "DerivingFunctorFromPro", "DerivingProfunctor", "4179",
]);

export function selectFixtures(root, options, cwd = process.cwd()) {
  const fork = resolve(root, "../../purescript/tests/purs/passing");
  const local = join(root, "tests/passing");
  const passing = statSync(fork, { throwIfNoEntry: false })?.isDirectory() ? fork : local;
  const nameOf = path => basename(path, ".purs");
  const candidates = options.targets.length ? options.targets.map(target => {
    const found = [resolve(root, target), resolve(cwd, target), join(passing, target),
      join(passing, target + ".purs"), join(local, target), join(local, target + ".purs")]
      .find(path => path.endsWith(".purs") && isFile(path));
    if (!found) throw new UsageError(`Test file not found: ${target}`);
    if (excludedFixtures.has(nameOf(found))) throw new UsageError(`Fixture is excluded by this backend: ${nameOf(found)}`);
    return found;
  }) : readdirSync(passing).filter(name => name.endsWith(".purs"))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map(name => join(passing, name));
  let selected = resumeFrom([...new Set(candidates)], options, (path, target) => nameOf(path) === nameOf(target));
  if (options.until) {
    const index = selected.findIndex(path => nameOf(path) === nameOf(options.until));
    if (index < 0) throw new UsageError(`End target not found after resume in selection: ${options.until}`);
    selected = selected.slice(0, index + 1);
  }
  selected = selected.filter(path => !excludedFixtures.has(nameOf(path)));
  if (!selected.length) throw new UsageError("No fixtures selected.");
  return selected.map(path => {
    const override = join(local, basename(path));
    return { name: nameOf(path), source: isFile(override) ? override : path };
  });
}

export function selectModules(root, options) {
  const parent = dirname(root);
  const available = readdirSync(parent).filter(name => {
    if (!name.startsWith(PORT_PREFIX)) return false;
    const script = join(parent, name, "bin/test");
    if (!isFile(script)) return false;
    try { accessSync(script, constants.X_OK); return true; } catch { return false; }
  }).sort();
  const normalize = name => name.startsWith(PORT_PREFIX) ? name : PORT_PREFIX + name;
  const candidates = options.targets.length ? options.targets.map(target => {
    const name = normalize(target);
    if (!available.includes(name)) throw new UsageError(`No executable module test: ${target}`);
    return name;
  }) : available;
  const selected = resumeFrom([...new Set(candidates)], options, (name, target) => name === normalize(target));
  if (!selected.length) throw new UsageError("No module tests selected.");
  return selected.map(name => join(parent, name));
}
