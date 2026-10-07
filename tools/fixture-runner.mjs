import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { javaCompileArgs } from "./java-tools.mjs";
import { prepareWorkspaceConfig } from "./workspace-config.mjs";

export const compilerRoot = fileURLToPath(new URL("../", import.meta.url));

export function prepareWorkspace(root, directory, options) {
  if (!existsSync(join(root, "output/Main/index.js"))) throw new Error(`Backend not built: run ${join(root, "bin/build")}`);
  return prepareWorkspaceConfig(root, directory, options);
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
