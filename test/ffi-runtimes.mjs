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
let selection = ["exceptions", "refs", "promise", "aff"];
while (args.length) {
  const arg = args.shift();
  if (arg === "--ports-root") { assert.ok(args[0], "--ports-root requires a directory"); ports = resolve(args.shift()); }
  else if (arg.startsWith("--port=")) { selection = [arg.slice(7)]; assert.ok(["exceptions", "refs", "promise", "aff"].includes(selection[0]), "unknown port"); }
  else throw new Error(`Unknown option: ${arg}`);
}
const { javac, java, javacArgs } = resolveJavaTools();
if (selection.includes("exceptions")) {
  // Check the reference's observable names/headers, including the distinction
  // between name's empty-name fallback and Error.toString's empty-name rule.
  const source = readFileSync(join(ports, "javapurs-exceptions/src/Effect/Exception.js"), "utf8");
  const reference = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const inner = reference.error("inner");
  const outer = reference.errorWithCause("outer")(inner);
  assert.equal(reference.name(outer), "Error"); assert.equal(outer.cause, inner);
  for (const [message, name, header] of [["message", "CustomError", "CustomError: message"],
    ["message", "", "message"], ["", "CustomError", "CustomError"], ["", "", ""]]) {
    const error = reference.errorWithName(message)(name);
    assert.equal(reference.name(error), name || "Error");
    assert.equal(reference.message(error), message);
    assert.equal(String(error), header);
    assert.equal(reference.showErrorImpl(error).split("\n")[0], header);
    assert.equal(reference.stackImpl(value => value)(null)(error), reference.showErrorImpl(error));
    assert.equal(reference.catchException(value => () => value)(reference.throwException(error))(), error);
  }
  console.log("exceptions: JavaScript reference names, headers, cause and identity passed");
}
await withTemporaryDirectory("javapurs-ffi-runtimes-", directory => {
  const sources = new Map([
    ["__M$Effect_Exception.java", `public class __M$Effect_Exception {\n${readFileSync(join(ports, "javapurs-exceptions/src/Effect/Exception.java"), "utf8")}\n}`],
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
