import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { Interrupted, ProcessFailure, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// A four-module application using Prim only: real TAST, both launcher ABIs,
// records, Int closures, chunks, provided/empty/missing FFI, and Java keywords.
// --record DIR freezes inputs and Java; --compare DIR reuses those exact inputs.
const root = fileURLToPath(new URL("../", import.meta.url));
const flags = ["--records=maps", "--loop-invariants=off", "--direct-calls=off",
  "--int-functions=off", "--ownership=off", "--no-chunk"];
const variants = [
  { name: "default", args: [], expected: "42" },
  ...flags.map((flag, index) => ({ name: `option-${index}`, args: [flag], expected: "42" })),
  { name: "all-off", args: flags, expected: "42" },
  { name: "chosen", args: ["--main", "Chosen"], expected: "99" },
  { name: "first-main", args: ["--main", "Chosen", "--main", "Main"], expected: "99" },
  { name: "missing-main-value", args: ["--main"], expected: "42" },
  { name: "unknown-option", args: ["--unknown-option"], expected: "42" },
  { name: "absent-main", args: ["--main", "Absent"], expected: null },
];

function inputs(directory) {
  const paths = readdirSync(join(directory, "src")).map(name => "src/" + name);
  for (const name of readdirSync(join(directory, "output"))) {
    const path = `output/${name}/corefn.json`;
    if (existsSync(join(directory, path))) paths.push(path);
  }
  return Object.fromEntries(paths.sort().map(path => [path,
    createHash("sha256").update(readFileSync(join(directory, path))).digest("hex")]));
}

function javaSources(directory) {
  return Object.fromEntries(readdirSync(directory).filter(name => name.endsWith(".java")).sort()
    .map(name => [name, readFileSync(join(directory, name), "utf8")]));
}

async function prepare(directory, processes, tools) {
  mkdirSync(join(directory, "src"));
  mkdirSync(join(directory, "logs"));
  writeFileSync(join(directory, "src/Main.purs"), `module Main where
data Unit = Unit
foreign import data Action :: Type -> Type
foreign import add :: Int -> Int -> Int
foreign import report :: { value :: Int } -> Action Unit
step :: Int -> Int
step value = add value 1
record :: Int -> { value :: Int }
record value = { value: step value }
values :: Array Int
values = [${Array.from({ length: 300 }, (_, index) => index).join(",")}]
main :: Action Unit
main = report (record 41)
`);
  writeFileSync(join(directory, "src/Main.java"), `    // driver fixture: provided verbatim
    public static final Object add = (java.util.function.Function<Object,Object>) a ->
        (java.util.function.Function<Object,Object>) b -> (int) a + (int) b;
    public static final Object report = (java.util.function.Function<Object,Object>) record ->
        (java.util.function.Supplier<Object>) () -> {
            System.out.println(((java.util.Map<?,?>) record).get("value"));
            return null;
        };
`);
  writeFileSync(join(directory, "src/Chosen.purs"), `module Chosen where
import Main (Action, Unit)
foreign import main :: Action Unit
`);
  writeFileSync(join(directory, "src/Chosen.java"), `    public static final Object main =
        (java.util.function.Function<Object,Object>) unit -> {
            if (unit != null) throw new AssertionError("expected null Unit argument");
            System.out.println(99);
            return null;
        };
`);
  for (const name of ["Missing", "Empty"]) {
    writeFileSync(join(directory, `src/${name}.purs`), `module ${name} where\nforeign import void :: Int -> Int\n`);
  }
  writeFileSync(join(directory, "src/Empty.java"), "");
  await processes.run("driver: TAST fixture", "purs",
    ["compile", "src/*.purs", "--codegen", "corefn"],
    { cwd: directory, env: tools.env, log: join(directory, "logs/purs.log"), timeout: 60_000 });
  const corefn = JSON.parse(readFileSync(join(directory, "output/Main/corefn.json"), "utf8"));
  assert.ok(corefn.dataDecls && corefn.classDecls && corefn.typeTable, "use the TAST-capable compiler fork");
}

async function check(directory, mode, processes, tools) {
  if (mode !== "compare") {
    await prepare(directory, processes, tools);
    writeFileSync(join(directory, "inputs.json"), JSON.stringify(inputs(directory), null, 2));
  }
  const frozen = JSON.parse(readFileSync(join(directory, "inputs.json"), "utf8"));
  assert.deepEqual(inputs(directory), frozen, "TAST and FFI inputs must match the recorded run");
  const output = join(directory, "java_output");
  const compile = async (name, args = []) => {
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output);
    await processes.run(`driver: ${name}`, join(root, "bin/javapurs"), args,
      { cwd: directory, env: tools.env, log: join(directory, `logs/${name}.log`), timeout: 60_000 });
    return javaSources(output);
  };
  let compared = 0;
  const snapshot = (name, sources) => {
    const expected = join(directory, "expected", name);
    if (mode === "record") {
      mkdirSync(expected, { recursive: true });
      for (const [file, source] of Object.entries(sources)) writeFileSync(join(expected, file), source);
    } else if (mode === "compare") {
      assert.deepEqual(Object.keys(sources), Object.keys(javaSources(expected)), `${name}: Java inventory`);
      for (const [file, source] of Object.entries(sources)) {
        assert.equal(source, readFileSync(join(expected, file), "utf8"), `${name}/${file}: Java contents`);
        compared++;
      }
    }
  };

  for (const variant of variants) {
    const sources = await compile(variant.name, variant.args);
    snapshot(variant.name, sources);
    assert.ok(sources["__IntFn.java"] && sources["TcoLoop.java"]);
    assert.match(sources["__M$Main.java"], /driver fixture: provided verbatim/);
    assert.match(sources["__M$Missing.java"], /Object \$void = FFI_STUB/);
    assert.match(sources["__M$Empty.java"], /Missing Java FFI: Empty.void/);
    const maps = variant.args.includes("--records=maps");
    assert.equal(Object.keys(sources).some(name => name.startsWith("__Record$")), !maps);
    assert.equal(sources["__M$Main.java"].includes("__chunk$"), !variant.args.includes("--no-chunk"));
    assert.equal(sources["__M$Main.java"].includes("(__IntFn)"), !variant.args.includes("--int-functions=off"));
    if (variant.expected === null) {
      assert.ok(!sources["MainRun.java"], "an absent entrypoint does not emit a launcher");
      continue;
    }
    assert.match(sources["MainRun.java"], variant.expected === "99" ? /__M\$Chosen.main/ : /__M\$Main.main/);
    const classes = join(directory, "classes");
    rmSync(classes, { recursive: true, force: true });
    mkdirSync(classes);
    await processes.run(`driver: ${variant.name} javac`, tools.javac,
      ["--release", "17", "-d", classes, ...Object.keys(sources).map(name => join(output, name))],
      { log: join(directory, `logs/${variant.name}-javac.log`), timeout: 60_000 });
    const result = await processes.run(`driver: ${variant.name} JVM`, tools.java, ["-cp", classes, "MainRun"],
      { log: join(directory, `logs/${variant.name}-java.log`), capture: true, timeout: 30_000 });
    assert.equal(result.trim(), variant.expected);
  }

  async function expectFailure(name, pattern, phase, context) {
    const log = join(directory, `logs/${name}.log`);
    await assert.rejects(processes.run(`driver: expected ${name}`, join(root, "bin/javapurs"), [],
      { cwd: directory, env: tools.env, log, timeout: 60_000 }), error => error instanceof ProcessFailure && error.code === 1);
    const contents = readFileSync(log, "utf8");
    assert.match(contents, /backend total: \d+ ms \(failed\)/);
    assert.match(contents, pattern);
    // Recording also works against the pre-refactoring driver. Normal runs
    // and comparisons verify the new contextual diagnostics and phase owner.
    if (mode !== "record") {
      assert.ok(contents.includes(context), `${name}: missing context ${context}`);
      assert.ok(contents.split("\n").some(line => line.startsWith(`[javapurs] ${phase}:`) && line.endsWith(" (failed)")),
        `${name}: failed phase ${phase}`);
    }
  }

  renameSync(join(directory, "output"), join(directory, "saved-output"));
  try {
    await expectFailure("missing-input", /ENOENT.*output/, "load TAST + sort", "load TAST from output:");
    mkdirSync(join(directory, "output"));
    const empty = await compile("empty-input");
    assert.deepEqual(Object.keys(empty), ["__IntFn.java"]);
    snapshot("empty-input", empty);
  } finally {
    rmSync(join(directory, "output"), { recursive: true, force: true });
    renameSync(join(directory, "saved-output"), join(directory, "output"));
  }
  rmSync(output, { recursive: true });
  await expectFailure("missing-output", /ENOENT.*java_output/, "prepare", "write Java java_output/__IntFn.java:");
  mkdirSync(output);
  mkdirSync(join(directory, "src/Missing.java"));
  try { await expectFailure("ffi-read", /EISDIR/, "optimize + emit", "compile module Missing: read Java FFI src/Missing.java:"); }
  finally { rmSync(join(directory, "src/Missing.java"), { recursive: true }); }
  for (const [name, file, phase] of [["module-write", "__M$Chosen.java", "optimize + emit"],
    ["launcher-write", "MainRun.java", "optimize + emit"], ["runtime-write", "TcoLoop.java", "prepare"]]) {
    rmSync(output, { recursive: true });
    mkdirSync(join(output, file), { recursive: true });
    await expectFailure(name, /EISDIR/, phase, `write Java java_output/${file}:`);
  }
  assert.deepEqual(inputs(directory), frozen, "error fixtures restore the original inputs");
  console.log(`Driver: ${variants.length} CLI variants, empty input and 6 I/O failures passed${mode === "compare" ? `; ${compared} Java files identical` : ""}`);
}

const processes = new TestProcesses();
try {
  const tools = resolveJavaTools();
  const args = process.argv.slice(2);
  if (!args.length) {
    await withTemporaryDirectory("javapurs-driver-", directory => check(directory, "check", processes, tools));
  } else {
    assert.ok(args.length === 2 && ["--record", "--compare"].includes(args[0]), "usage: node test/driver.mjs [--record DIR | --compare DIR]");
    const directory = resolve(args[1]);
    if (args[0] === "--record") mkdirSync(directory); // Never replace a previous baseline.
    await check(directory, args[0].slice(2), processes, tools);
  }
} catch (error) {
  console.error(`[FAILED] ${error.stack || error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
