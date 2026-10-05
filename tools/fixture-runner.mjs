import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { javaCompileArgs } from "./java-tools.mjs";

export const compilerRoot = fileURLToPath(new URL("../", import.meta.url));

// Keep the checked-in runner config as the single package inventory. Its path
// entries are JSON-quoted YAML strings; rebase those relative to the template,
// so an isolated runner can live in TMPDIR without changing package selection.
export function prepareWorkspace(root, directory) {
  const template = join(root, "tests/runner/spago.yaml");
  const config = readFileSync(template, "utf8").replace(/^(\s*path:\s*)(.+)$/gm, (_, prefix, quoted) => {
    const path = resolve(dirname(template), JSON.parse(quoted));
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Missing package checkout: ${path}`);
    return prefix + JSON.stringify(path);
  });
  mkdirSync(directory, { recursive: true });
  // The shared runner already has its relative template. Isolated runners get
  // a rebased copy; never rewrite the tracked source of truth.
  if (resolve(directory) !== resolve(root, "tests/runner")) writeFileSync(join(directory, "spago.yaml"), config);
  if (!existsSync(join(root, "output/Main/index.js"))) throw new Error(`Backend not built: run ${join(root, "bin/build")}`);
}

function copyIfPresent(source, destination) {
  if (existsSync(source)) { copyFileSync(source, destination); return true; }
  return false;
}

export async function runFixture({ root = compilerRoot, fixture, directory, processes, tools, javacArgs = [], logs = join(directory, "logs", fixture.name) }) {
  const compileArgs = javaCompileArgs(tools, javacArgs);
  const { name, source } = fixture;
  console.log(`=> Testing ${name}`);
  // These four directories are owned by the fixture runner, not by the ports.
  for (const child of ["src", "output", "java_output", "classes"]) {
    rmSync(join(directory, child), { recursive: true, force: true });
    mkdirSync(join(directory, child), { recursive: true });
  }
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  copyFileSync(source, join(directory, "src/Main.purs"));
  const stem = source.slice(0, -".purs".length);
  if (statSync(stem, { throwIfNoEntry: false })?.isDirectory()) cpSync(stem, join(directory, "src"), { recursive: true });
  if (!copyIfPresent(stem + ".java", join(directory, "src/Main.java"))) {
    copyIfPresent(join(root, "tests/ffi", name + ".java"), join(directory, "src/Main.java"));
  }
  copyIfPresent(stem + ".js", join(directory, "src/Main.js"));
  const run = (phase, command, args) => processes.run(`${name}: ${phase}`, command, args,
    { cwd: directory, env: tools.env, log: join(logs, phase + ".log") });
  await run("purescript", "spago", ["build", "-q"]);
  await run("generation", join(root, "bin/javapurs"), ["--main", "Main"]);
  if (!existsSync(join(directory, "java_output/MainRun.java"))) {
    throw new Error(`${name}: generation did not produce MainRun.java; log: ${join(logs, "generation.log")}`);
  }
  await run("javac", tools.javac, [...compileArgs, "-d", "classes", "-sourcepath", "java_output", "java_output/MainRun.java"]);
  await run("execution", tools.java, ["-cp", "classes", "MainRun"]);
  console.log(`   ${name}: OK`);
}
