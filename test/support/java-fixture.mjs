import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveJavaTools } from "../../tools/java-tools.mjs";
import { runCommandSync } from "../../tools/test-process.mjs";
import { withTemporaryDirectory } from "../../tools/test-workspace.mjs";

// Shared Java fixture lifecycle for direct suites. Keep the assertions in each
// suite; this module owns only source materialization, javac and JVM invocation.
const entries = sources => sources instanceof Map ? [...sources] : Object.entries(sources);

export function writeJavaSources(directory, sources) {
  return entries(sources).map(([name, source]) => {
    const path = join(directory, name);
    writeFileSync(path, source);
    return path;
  });
}

export function compileJava(directory, sources, options = {}) {
  const tools = resolveJavaTools();
  const paths = writeJavaSources(directory, sources);
  runCommandSync(tools.javac, [
    ...(options.javacArgs ?? tools.javacArgs),
    ...(options.nowarn === false ? [] : ["-nowarn"]),
    ...(options.outputDirectory ? ["-d", options.outputDirectory] : []),
    ...paths,
  ], {
    cwd: directory,
    stdio: options.stdio ?? "inherit",
    timeout: options.compileTimeout ?? 60_000,
  });
  return paths;
}

export function runJava(directory, main, options = {}) {
  const tools = resolveJavaTools();
  return runCommandSync(tools.java, [
    ...(options.javaArgs ?? []),
    "-cp", options.classPath ?? directory, main,
  ], {
    cwd: directory,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
    timeout: options.runTimeout ?? 60_000,
  });
}

export async function withJavaFixture(prefix, { sources, main, ...options }, action = () => undefined) {
  return withTemporaryDirectory(prefix, async directory => {
    compileJava(directory, sources, options);
    const output = runJava(directory, main, options);
    return action({ directory, output });
  });
}
