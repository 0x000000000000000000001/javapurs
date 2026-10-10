import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { requireExecutable } from "../tools/source-tools.mjs";
import { Interrupted, ProcessFailure, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Real TAST + CLI + javac. Check the process result from both classes and a
// standalone JAR: a non-executable main must never be a silent successful run.
assert.equal(process.argv.length, 2, "entrypoint.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const processes = new TestProcesses();
const variants = [
  { name: "Main", invalidType: "java.lang.Integer" },
  { name: "NullMain", java: "public static final Object main = null;", invalidType: "null" },
  { name: "Named.Entry", java: `
    private static final class Value {
      @Override public String toString() { throw new AssertionError("must not stringify main"); }
    }
    public static final Object main = new Value();`, invalidType: "__M$Named_Entry$Value" },
  { name: "SupplierMain", java: `
    private static int calls;
    public static final Object main = (java.util.function.Supplier<Object>) () -> {
      if (++calls != 1) throw new AssertionError("repeated Supplier call");
      System.out.println("Supplier once");
      return null;
    };`, stdout: "Supplier once\n" },
  { name: "FunctionMain", java: `
    private static int calls;
    public static final Object main = (java.util.function.Function<Object,Object>) unit -> {
      if (unit != null || ++calls != 1) throw new AssertionError("Function calling convention");
      System.out.println("Function once with null");
      return "ignored return value";
    };`, stdout: "Function once with null\n" },
  { name: "BothMain", java: `
    private static final class Both implements java.util.function.Supplier<Object>, java.util.function.Function<Object,Object> {
      private int calls;
      public Object get() {
        if (++calls != 1) throw new AssertionError("repeated dual-ABI call");
        System.out.println("Both via Supplier"); return null;
      }
      public Object apply(Object ignored) { throw new AssertionError("Function must not win over Supplier"); }
    }
    public static final Object main = new Both();`, stdout: "Both via Supplier\n" },
  { name: "ThrowSupplier", java: `
    public static final Object main = (java.util.function.Supplier<Object>) () -> {
      throw new IllegalArgumentException("Supplier failed");
    };`, error: /Exception in thread "main" java.lang.IllegalArgumentException: Supplier failed/ },
  { name: "ThrowFunction", java: `
    public static final Object main = (java.util.function.Function<Object,Object>) ignored -> {
      throw new IllegalArgumentException("Function failed");
    };`, error: /Exception in thread "main" java.lang.IllegalArgumentException: Function failed/ },
  { name: "Initializer", java: `
    private static Object initialize() { throw new IllegalArgumentException("Initializer failed"); }
    public static final Object main = initialize();`, error: /ExceptionInInitializerError[\s\S]*Caused by: java.lang.IllegalArgumentException: Initializer failed/ },
  { name: "Missing", error: /Exception in thread "main" java.lang.UnsupportedOperationException: Missing Java FFI: Missing.main/ },
];

try {
  const tools = resolveJavaTools(), jar = requireExecutable(join(dirname(tools.javac), "jar"));
  await withTemporaryDirectory("javapurs-entrypoint-", async directory => {
    mkdirSync(join(directory, "src")); mkdirSync(join(directory, "logs"));
    const run = (name, command, args, options = {}) => processes.run(`Entrypoint: ${name}`, command, args,
      { cwd: directory, env: tools.env, log: join(directory, "logs", name + ".log"), timeout: 60_000, ...options });
    writeFileSync(join(directory, "src/Types.purs"), "module Types where\ndata Unit = Unit\nforeign import data Action :: Type -> Type\n");
    writeFileSync(join(directory, "src/Main.purs"), "module Main where\nmain :: Int\nmain = 42\n");
    for (const variant of variants.slice(1)) {
      const source = join(directory, "src", variant.name.replaceAll(".", "/"));
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source + ".purs", `module ${variant.name} where\nimport Types (Action, Unit)\nforeign import main :: Action Unit\n`);
      if (variant.java) writeFileSync(source + ".java", variant.java + "\n");
    }
    await run("purs", "purs", ["compile", "src/**/*.purs", "--codegen", "corefn"]);
    const output = join(directory, "output/java"), classes = join(output, "classes");
    const delivery = join(directory, "delivery"); mkdirSync(delivery);
    let successes = 0, failures = 0;
    for (const [index, variant] of variants.entries()) {
      const className = "__M$" + variant.name.replaceAll(".", "_");
      // The default Main case also tests the implicit CLI entrypoint.
      await run(`${variant.name}-generate`, join(root, "bin/javapurs"), index === 0 ? [] : ["--main", variant.name]);
      const sources = index === 0 ? readdirSync(output).filter(name => name.endsWith(".java")) : ["MainRun.java"];
      await run(`${variant.name}-javac`, tools.javac,
        [...tools.javacArgs, "-cp", classes, "-d", classes, ...sources.map(name => join(output, name))]);
      await run(`${variant.name}-package`, jar, ["--create", "--file", join(delivery, "app.jar"), "--main-class", "MainRun", "-C", classes, "."]);
      assert.deepEqual(readdirSync(delivery), ["app.jar"]);
      for (const kind of ["classes", "jar"]) {
        const name = `${variant.name}-${kind}`;
        const args = kind === "classes" ? ["-cp", classes, "MainRun"] : ["-jar", "app.jar"];
        const options = { cwd: delivery, env: { ...tools.env, PATH: dirname(tools.java), CLASSPATH: "" }, capture: true };
        if (variant.stdout) {
          assert.equal(await run(name, tools.java, args, options), variant.stdout);
          successes++;
        } else {
          await assert.rejects(run(name, tools.java, args, { ...options, reportFailure: false }),
            error => error instanceof ProcessFailure && error.code === 1);
          const log = readFileSync(join(directory, "logs", name + ".log"), "utf8");
          if (variant.invalidType) {
            assert.ok(log.includes(`java.lang.IllegalStateException: Invalid Java entrypoint ${className}.main: expected Supplier or Function, got ${variant.invalidType}`));
            assert.doesNotMatch(log, /must not stringify main/);
          } else {
            assert.match(log, variant.error);
            assert.doesNotMatch(log, /Invalid Java entrypoint/);
          }
          failures++;
        }
      }
    }
    console.log(`Entrypoint: ${variants.length} variants, ${successes} successful runs and ${failures} expected JVM failures (classes/JAR) passed`);
  });
} catch (error) {
  console.error(error);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
