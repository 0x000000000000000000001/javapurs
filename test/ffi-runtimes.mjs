import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Compile the actual inserted fragments, with just the two Either constructors
// they depend on. The separate port integration checks exercise generated ADTs.
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let ports = resolve(here, "../..");
let selection = ["refs", "promise", "aff"];
while (args.length) {
  const arg = args.shift();
  if (arg === "--ports-root") { assert.ok(args[0], "--ports-root requires a directory"); ports = resolve(args.shift()); }
  else if (arg.startsWith("--port=")) { selection = [arg.slice(7)]; assert.ok(["refs", "promise", "aff"].includes(selection[0]), "unknown port"); }
  else throw new Error(`Unknown option: ${arg}`);
}
const { javac, java, javacArgs } = resolveJavaTools();
await withTemporaryDirectory("javapurs-ffi-runtimes-", directory => {
  const sources = new Map([
    ["__M$Effect_Aff.java", `public class __M$Effect_Aff {\n${readFileSync(join(ports, "javapurs-aff/src/Effect/Aff.java"), "utf8")}\npublic static Object testRun(Object aff, RunContext ctx) { return runAffSync((AffRun) aff, ctx); }\n}`],
    ["__M$Effect_Ref.java", `public class __M$Effect_Ref {\n${readFileSync(join(ports, "javapurs-refs/src/Effect/Ref.java"), "utf8")}\n}`],
    ["__M$Promise_Internal.java", `public class __M$Promise_Internal {\n${readFileSync(join(ports, "javapurs-js-promise/src/Promise/Internal.java"), "utf8")}\n}`],
    ["__M$Data_Either.java", "public class __M$Data_Either { public static class Left { public final Object value0; public Left(Object v) { value0=v; } } public static class Right { public final Object value0; public Right(Object v) { value0=v; } } }"],
    ["FfiRuntimeChecks.java", readFileSync(join(here, "support/FfiRuntimeChecks.java"), "utf8")],
  ]);
  for (const [name, source] of sources) writeFileSync(join(directory, name), source);
  runCommandSync(javac, [...javacArgs, "-nowarn", ...sources.keys()], { cwd: directory, stdio: "pipe" });
  for (const port of selection) {
    console.log(runCommandSync(java, ["-Xss512k", "-cp", directory, "FfiRuntimeChecks", port],
      { cwd: directory, stdio: "pipe", encoding: "utf8", timeout: 30000 }).trim());
  }
});
