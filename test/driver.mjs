import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  { name: "main-equals", args: ["--main=Chosen"], expected: "99", baseline: "chosen" },
  { name: "library", args: ["--no-main"], expected: null, baseline: "absent-main" },
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

function outputState(directory) {
  if (!existsSync(directory)) return null;
  return Object.fromEntries(readdirSync(directory).sort().map(name => [name,
    lstatSync(join(directory, name)).isFile() ? readFileSync(join(directory, name)).toString("hex") : "directory"]));
}

function checkManifest(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, ".javapurs-manifest.json"), "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.ffi.version, 1);
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert.equal(createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"), digest, `manifest: ${name}`);
  }
  assert.ok(!existsSync(join(directory, ".javapurs-work")), "completed generation released its work directory");
  return Object.keys(manifest.files).sort();
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
  const output = join(directory, "output/java");
  const runBackend = (name, args = [], cwd = directory) => processes.run(`driver: ${name}`, join(root, "bin/javapurs"), args,
    { cwd, env: tools.env, log: join(directory, `logs/${name}.log`), timeout: 60_000 });
  const compile = async (name, args = []) => {
    rmSync(output, { recursive: true, force: true });
    await runBackend(name, args);
    const sources = javaSources(output);
    assert.deepEqual(checkManifest(output), Object.keys(sources));
    return sources;
  };
  let compared = 0;
  const snapshot = (name, sources, legacyName = name) => {
    const expected = join(directory, "expected", mode === "compare" && !existsSync(join(directory, "expected", name)) ? legacyName : name);
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
    snapshot(variant.name, sources, variant.baseline);
    assert.ok(sources["__IntFn.java"] && sources["TcoLoop.java"]);
    assert.match(sources["__M$Main.java"], /driver fixture: provided verbatim/);
    assert.match(sources["__M$Missing.java"], /Object \$void = new __MissingFFI\("Missing Java FFI: Missing.void"\)/);
    assert.match(sources["__M$Empty.java"], /Missing Java FFI: Empty.void/);
    const maps = variant.args.includes("--records=maps");
    assert.equal(Object.keys(sources).some(name => name.startsWith("__Record$")), !maps);
    assert.equal(sources["__M$Main.java"].includes("__chunk$"), !variant.args.includes("--no-chunk"));
    assert.equal(sources["__M$Main.java"].includes("(__IntFn)"), !variant.args.includes("--int-functions=off"));
    if (variant.expected === null) {
      assert.ok(!sources["MainRun.java"], "library mode does not emit a launcher");
    } else assert.match(sources["MainRun.java"], variant.expected === "99" ? /__M\$Chosen.main/ : /__M\$Main.main/);
    const classes = join(output, "classes");
    rmSync(classes, { recursive: true, force: true });
    mkdirSync(classes);
    await processes.run(`driver: ${variant.name} javac`, tools.javac,
      [...tools.javacArgs, "-d", classes, ...Object.keys(sources).map(name => join(output, name))],
       { log: join(directory, `logs/${variant.name}-javac.log`), timeout: 60_000 });
    if (variant.expected === null) continue;
    const result = await processes.run(`driver: ${variant.name} JVM`, tools.java, ["-cp", classes, "MainRun"],
      { log: join(directory, `logs/${variant.name}-java.log`), capture: true, timeout: 30_000 });
    assert.equal(result.trim(), variant.expected);
  }

  let failures = 0;
  async function expectFailure(name, args, pattern, code = 1, cwd = directory) {
    const log = join(directory, `logs/${name}.log`);
    const before = outputState(output);
    await assert.rejects(processes.run(`driver: expected ${name}`, join(root, "bin/javapurs"), args,
      { cwd, env: tools.env, log, timeout: 60_000, reportFailure: false }), error => error instanceof ProcessFailure && error.code === code);
    const contents = readFileSync(log, "utf8");
    assert.match(contents, pattern);
    if (code === 1) assert.match(contents, /backend total: \d+ ms \(failed\)/);
    else assert.doesNotMatch(contents, /Loading corefn|backend total/);
    assert.deepEqual(outputState(output), before, `${name}: failed generation preserves prior output`);
    failures++;
  }

  // Help and all syntax errors are handled without a TAST directory or writes.
  const noInputs = join(directory, "no inputs"); mkdirSync(noInputs, { recursive: true });
  await runBackend("help", ["--help"], noInputs);
  assert.match(readFileSync(join(directory, "logs/help.log"), "utf8"), /Usage: javapurs/);
  const invalid = [
    ["unknown", ["--unknown-option"], /Unknown argument/],
    ["option-value", ["--records=typed"], /Unknown argument/],
    ["missing-main", ["--main"], /Missing value/],
    ["flag-as-value", ["--main", "--no-main"], /Missing or invalid value/],
    ["empty-input-value", ["--input="], /Missing or invalid value/],
    ["missing-output-value", ["--java-output"], /Missing value/],
    ["duplicate-main", ["--main=Chosen", "--main=Main"], /Repeated or conflicting/],
    ["conflicting-main", ["--main", "Main", "--no-main"], /Repeated or conflicting/],
    ["input-alias-conflict", ["--input=output", "--output=output"], /Repeated or conflicting/],
    ["duplicate-switch", ["--no-chunk", "--no-chunk"], /Repeated or conflicting/],
    ["positional", ["build"], /Unknown argument/],
    ["invalid-help", ["--help", "--bogus"], /Unknown argument/],
  ];
  for (const [name, args, diagnostic] of invalid) await expectFailure(name, args, diagnostic, 2, noInputs);
  assert.deepEqual(readdirSync(noInputs), []);
  await expectFailure("absent-main", ["--main", "Absent"], /Entrypoint module Absent not found/);
  await expectFailure("no-local-main", ["--main", "Missing"], /must define and export a local main/);
  await expectFailure("overlapping-paths", ["--java-output", "output/nested"], /must not overlap/);

  renameSync(join(directory, "output"), join(directory, "saved-output"));
  try {
    await expectFailure("missing-input", [], /load TAST from output:.*ENOENT/);
    mkdirSync(join(directory, "output"));
    await expectFailure("empty-application", [], /Entrypoint module Main not found/);
    const empty = await compile("empty-input", ["--no-main"]);
    assert.deepEqual(Object.keys(empty), ["__IntFn.java"]);
    snapshot("empty-input", empty);
  } finally {
    rmSync(join(directory, "output"), { recursive: true, force: true });
    renameSync(join(directory, "saved-output"), join(directory, "output"));
  }
  await compile("before-ffi-failure");
  mkdirSync(join(directory, "src/Missing.java"));
  try { await expectFailure("ffi-read", [], /compile module Missing: read Java FFI src\/Missing.java:.*EISDIR/); }
  finally { rmSync(join(directory, "src/Missing.java"), { recursive: true }); }
  writeFileSync(join(directory, "blocked-output"), "keep");
  await expectFailure("blocked-output", ["--java-output=blocked-output"], /prepare Java output blocked-output/);
  assert.equal(readFileSync(join(directory, "blocked-output"), "utf8"), "keep");
  for (const [name, file] of [["module-write", "__M$Chosen.java"], ["launcher-write", "MainRun.java"], ["runtime-write", "TcoLoop.java"]]) {
    rmSync(output, { recursive: true });
    mkdirSync(join(output, file), { recursive: true });
    await expectFailure(name, [], /publish Java to output\/java: Expected a regular file, preserving/);
  }

  // Exercise real consecutive generations in one destination: records, launcher,
  // module deletion/rename, and foreign files outside the managed inventory.
  await compile("lifecycle-start", ["--main=Chosen"]);
  writeFileSync(join(output, "User.java"), "public class User {}\n");
  writeFileSync(join(output, "notes.txt"), "keep");
  await runBackend("lifecycle-library", ["--no-main", "--records=maps"]);
  assert.ok(!existsSync(join(output, "MainRun.java")));
  assert.ok(!readdirSync(output).some(name => name.startsWith("__Record$")));
  assert.ok(!checkManifest(output).includes("User.java"));
  await runBackend("lifecycle-application");
  assert.match(readFileSync(join(output, "MainRun.java"), "utf8"), /__M\$Main.main/);

  const renamed = join(directory, "renamed fixture"), renamedInputs = join(renamed, "TAST cache");
  mkdirSync(join(renamed, "src"), { recursive: true });
  for (const name of ["Main.purs", "Main.java", "Empty.purs", "Empty.java"]) cpSync(join(directory, "src", name), join(renamed, "src", name));
  writeFileSync(join(renamed, "src/Renamed.purs"), readFileSync(join(directory, "src/Chosen.purs"), "utf8").replace("module Chosen", "module Renamed"));
  cpSync(join(directory, "src/Chosen.java"), join(renamed, "src/Renamed.java"));
  writeFileSync(join(renamed, "src/Hidden.purs"), `module Hidden (visible) where
import Main (Action, Unit)
foreign import main :: Action Unit
visible :: Int
visible = 0
`);
  writeFileSync(join(renamed, "src/ReExport.purs"), "module ReExport (module Imported) where\nimport Main (main) as Imported\n");
  await processes.run("driver: renamed TAST", "purs", ["compile", join(renamed, "src/*.purs"), "--codegen", "corefn", "--output", renamedInputs],
    { cwd: directory, env: tools.env, log: join(directory, "logs/renamed-purs.log"), timeout: 60_000 });
  await expectFailure("old-entrypoint", ["--input", renamedInputs, "--main", "Chosen"], /Entrypoint module Chosen not found/);
  for (const name of ["Hidden", "ReExport"]) {
    await expectFailure(`invalid-entrypoint-${name}`, ["--input", renamedInputs, "--main", name], /must define and export a local main/);
  }
  await runBackend("renamed-modules", ["--java-output", output, "--input", renamedInputs, "--main", "Renamed"]);
  assert.ok(!existsSync(join(output, "__M$Chosen.java")) && !existsSync(join(output, "__M$Missing.java")));
  assert.ok(checkManifest(output).includes("__M$Renamed.java"));
  assert.match(readFileSync(join(output, "MainRun.java"), "utf8"), /__M\$Renamed.main/);
  assert.equal(readFileSync(join(output, "User.java"), "utf8"), "public class User {}\n");
  assert.equal(readFileSync(join(output, "notes.txt"), "utf8"), "keep");

  const customOutput = join(directory, "custom Java", "nested");
  await runBackend("explicit-paths", ["--output=" + renamedInputs, "--java-output", customOutput, "--main=Renamed"]);
  assert.deepEqual(javaSources(customOutput), Object.fromEntries(Object.entries(javaSources(output)).filter(([name]) => name !== "User.java")));
  checkManifest(customOutput);
  await runBackend("derived-input-path", ["--input", renamedInputs, "--main", "Renamed"]);
  assert.deepEqual(javaSources(join(renamedInputs, "java")), javaSources(customOutput));
  checkManifest(join(renamedInputs, "java"));
  await checkSpago(directory, processes, tools);
  assert.deepEqual(inputs(directory), frozen, "error fixtures restore the original inputs");
  console.log(`Driver: ${variants.length} CLI variants, help, ${failures} expected failures, output lifecycle and 3 real Spago invocations passed${mode === "compare" ? `; ${compared} Java files identical` : ""}`);
}

async function checkSpago(directory, processes, tools) {
  const workspace = join(directory, "Spago project"); mkdirSync(workspace, { recursive: true });
  cpSync(join(directory, "src"), join(workspace, "src"), { recursive: true });
  const spy = join(workspace, "backend.mjs");
  writeFileSync(spy, `import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
writeFileSync('backend-args.json', JSON.stringify(process.argv.slice(2)));
const result = spawnSync(${JSON.stringify(join(root, "bin/javapurs"))}, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`);
  const backendArgs = ["--main", "Chosen"];
  writeFileSync(join(workspace, "spago.yaml"), `package:\n  name: driver-spago\n  dependencies: []\nworkspace:\n  packageSet:\n    registry: 77.10.1\n  backend:\n    cmd: ${JSON.stringify(process.execPath)}\n    args: ${JSON.stringify([spy, ...backendArgs])}\n`);
  for (const [name, outputArgs] of [["default", []], ["repeat", []], ["custom", ["--output", "TAST cache"]]]) {
    await processes.run(`driver: Spago ${name}`, "spago", ["build", "-q", ...outputArgs],
      { cwd: workspace, env: tools.env, log: join(directory, `logs/spago-${name}.log`), timeout: 120_000 });
    // Spago 1.x resolves its output option before appending it to backend.args.
    const forwarded = outputArgs.length ? ["--output", join(realpathSync(workspace), "TAST cache")] : [];
    assert.deepEqual(JSON.parse(readFileSync(join(workspace, "backend-args.json"))), [...backendArgs, ...forwarded]);
    const java = join(workspace, outputArgs.length ? "TAST cache" : "output", "java"), classes = join(java, "classes");
    checkManifest(java);
    await processes.run(`driver: Spago ${name} javac`, tools.javac, [...tools.javacArgs, "-d", classes, "-sourcepath", java, join(java, "MainRun.java")],
      { cwd: workspace, log: join(directory, `logs/spago-${name}-javac.log`), timeout: 60_000 });
    const result = await processes.run(`driver: Spago ${name} JVM`, tools.java, ["-cp", classes, "MainRun"],
      { cwd: workspace, capture: true, log: join(directory, `logs/spago-${name}-java.log`), timeout: 30_000 });
    assert.equal(result.trim(), "99");
  }
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
