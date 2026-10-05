import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { Interrupted, ProcessFailure, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Real TAST and the production PBO resolver. Distinguish fragment selection
// from coverage: even a compilable supplied fragment can lack a declared field.
assert.equal(process.argv.length, 2, "ffi-diagnostics.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const processes = new TestProcesses(), tools = resolveJavaTools();
try {
  await withTemporaryDirectory("javapurs-ffi-diagnostics-", async temporary => {
    const directory = realpathSync(temporary);
    mkdirSync(join(directory, "logs"));
    const write = (name, text) => { const file = join(directory, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
    const run = (phase, command, args, options = {}) => processes.run(`FFI diagnostics: ${phase}`, command, args,
      { cwd: directory, env: tools.env, log: join(directory, "logs", phase + ".log"), timeout: 60_000, ...options });
    write("src/Types.purs", "module Types where\ndata Unit = Unit\nforeign import data Action :: Type -> Type\n");
    const declarations = "import Types (Action, Unit)\nforeign import void :: Int -> Int -> Int\nforeign import action :: Action Unit\n";
    for (const name of ["Missing", "Empty"]) write(`src/${name}.purs`, `module ${name} where\n${declarations}`);
    write("src/Empty.java", "");
    for (const name of ["Adjacent", "Fallback", "LocalSearch"]) {
      write(`src/declarations/${name}.purs`, `module ${name} where\nforeign import value :: Int\n`);
    }
    write("src/declarations/Adjacent.java", "public static final Object value = 41;\n");
    write(".spago/decoy/v1/src/Adjacent.java", "public static final Object value = -1;\n");
    write(".spago/decoy/v1/src/Fallback.java", "public static final Object value = 42;\n");
    write("src/Fallback.java", "public static final Object value = -2;\n");
    write("src/LocalSearch.java", "public static final Object value = 43;\n");
    write("src/Partial.purs", "module Partial where\nforeign import supplied :: Int\nforeign import omitted :: Int\n");
    write("src/Partial.java", "public static final Object supplied = 44;\n");
    write("src/Blank.purs", "module Blank where\nforeign import omitted :: Int\n");
    write("src/Blank.java", " \n\t");
    await run("purs", "purs", ["compile", "src/**/*.purs", "--codegen", "corefn"]);
    await run("generate", join(root, "bin/javapurs"), ["--no-main"]);
    const output = join(directory, "java_output"), manifestFile = join(output, ".javapurs-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile));
    assert.equal(manifest.ffi.version, 1);
    const reports = Object.fromEntries(manifest.ffi.modules.map(report => [report.moduleName, report]));
    assert.equal(Object.keys(reports).length, 8);
    for (const report of Object.values(reports)) {
      assert.equal(report.verification, "not-checked");
      assert.equal(report.moduleSource.origin, "workspace");
      assert.equal(report.moduleSource.realPath, report.moduleSource.path);
      assert.deepEqual(report.bindings.map(binding => binding.name), [...report.bindings.map(binding => binding.name)].sort());
      for (const binding of report.bindings) assert.equal(binding.retained, true);
      if (report.selectedJava) {
        assert.equal(report.fragmentSha256, createHash("sha256").update(readFileSync(report.selectedJava.path)).digest("hex"));
      } else assert.equal(report.fragmentSha256, null);
    }
    assert.equal(reports.Adjacent.resolution, "adjacent");
    assert.equal(reports.Adjacent.selectedJava.path, join(directory, "src/declarations/Adjacent.java"));
    assert.equal(reports.Fallback.resolution, "search");
    assert.equal(reports.Fallback.selectedJava.origin, "spago");
    assert.equal(reports.Fallback.selectedJava.path, join(directory, ".spago/decoy/v1/src/Fallback.java"));
    assert.equal(reports.LocalSearch.resolution, "search");
    assert.equal(reports.LocalSearch.selectedJava.origin, "workspace");
    assert.equal(reports.LocalSearch.selectedJava.path, join(directory, "src/LocalSearch.java"));
    assert.equal(reports.Missing.status, "missing");
    assert.equal(reports.Missing.selectedJava, null);
    assert.equal(reports.Missing.adjacentJava, join(directory, "src/Missing.java"));
    assert.equal(reports.Empty.status, "empty");
    assert.equal(reports.Empty.resolution, "adjacent");
    assert.equal(reports.Types.status, "not-required");
    assert.deepEqual(reports.Types.bindings, []);
    assert.deepEqual(reports.Missing.bindings, [
      { name: "action", javaName: "action", retained: true },
      { name: "void", javaName: "$void", retained: true },
    ]);
    for (const name of ["Partial", "Blank"]) {
      assert.equal(reports[name].status, "provided");
      assert.ok(reports[name].bindings.some(binding => binding.name === "omitted"));
      assert.doesNotMatch(readFileSync(join(output, `__M$${name}.java`), "utf8"), /__MissingFFI/);
    }
    const log = readFileSync(join(directory, "logs/generate.log"), "utf8");
    assert.match(log, /FFI Missing: missing;.*src\/Missing.purs.*src\/Missing.java.*action, void/);
    assert.match(log, /FFI Empty: empty;/);
    assert.match(log, /FFI Partial: provided;.*coverage not checked/);
    assert.match(log, /FFI report:.*\.javapurs-manifest.json/);

    // Force both call ABIs and the varargs compatibility methods. Each binding
    // must throw UnsupportedOperationException with its own PureScript name.
    write("FfiDiagnosticChecks.java", `
import java.util.function.*;
public class FfiDiagnosticChecks {
  static int checks;
  static void missing(String binding, Runnable call) {
    try { call.run(); throw new AssertionError("missing exception: " + binding); }
    catch (UnsupportedOperationException error) {
      if (!error.getMessage().equals("Missing Java FFI: " + binding)) throw new AssertionError(error);
      checks++;
    }
  }
  public static void main(String[] args) {
    if (!__M$Adjacent.value.equals(41) || !__M$Fallback.value.equals(42) || !__M$LocalSearch.value.equals(43))
      throw new AssertionError("wrong fragment selected");
    ${["Missing", "Empty"].map(name => `
    missing("${name}.void", () -> ((Function<Object,Object>) __M$${name}.$void).apply(1));
    missing("${name}.void", () -> __M$${name}.$void(1, 2));
    missing("${name}.action", () -> ((Supplier<?>) __M$${name}.action).get());
    missing("${name}.action", () -> __M$${name}.action());`).join("\n")}
    if (checks != 8) throw new AssertionError(checks);
    System.out.println("FFI diagnostics: 8 binding-specific failures and 3 selections passed");
  }
}`);
    const javaFiles = readdirSync(output).filter(name => name.endsWith(".java")).map(name => join(output, name));
    await run("javac", tools.javac, [...tools.javacArgs, "-d", "classes", ...javaFiles, "FfiDiagnosticChecks.java"]);
    const result = await run("jvm", tools.java, ["-cp", "classes", "FfiDiagnosticChecks"], { capture: true });
    assert.match(result, /8 binding-specific failures and 3 selections passed/);

    // Compilation of an unused fragment is not proof of its full FFI surface.
    // A Java consumer of each omitted binding exposes the actual missing member.
    for (const name of ["Partial", "Blank"]) {
      write("Omitted.java", `class Omitted { Object use() { return __M$${name}.omitted; } }\n`);
      await assert.rejects(run(`omitted-${name}`, tools.javac,
        [...tools.javacArgs, "-cp", "classes", "-d", "classes", "Omitted.java"], { reportFailure: false }),
      error => error instanceof ProcessFailure && error.code === 1);
      const diagnostic = readFileSync(join(directory, `logs/omitted-${name}.log`), "utf8");
      assert.match(diagnostic, /cannot find symbol/);
      assert.match(diagnostic, /omitted/);
    }
    const before = readFileSync(manifestFile);
    rmSync(join(directory, "src/Empty.java")); mkdirSync(join(directory, "src/Empty.java"));
    await assert.rejects(run("read-error", join(root, "bin/javapurs"), ["--no-main"], { reportFailure: false }),
      error => error instanceof ProcessFailure && error.code === 1);
    assert.match(readFileSync(join(directory, "logs/read-error.log"), "utf8"), /read Java FFI src\/Empty.java:.*EISDIR/);
    assert.deepEqual(readFileSync(manifestFile), before, "failed generation preserves the successful FFI report");
    console.log("FFI diagnostics: 8 module reports, 3 resolver selections, 8 JVM stub checks, 2 omitted-binding javac failures and 1 read failure passed");
  });
} catch (error) {
  console.error(error);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
