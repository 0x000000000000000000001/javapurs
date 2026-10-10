import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Interrupted, ProcessFailure, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Exercise the real CLI boundary with fresh TAST, including an unused module.
// Every bad input must fail before touching Java, its manifest, or PBO caches.
assert.equal(process.argv.length, 2, "input.mjs accepts no options");
const root = fileURLToPath(new URL("../", import.meta.url));
const processes = new TestProcesses();

function state(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink()) return { link: readlinkSync(path) };
  if (stat.isFile()) return readFileSync(path).toString("hex");
  assert.ok(stat.isDirectory(), `Unexpected filesystem entry: ${path}`);
  return Object.fromEntries(readdirSync(path).sort().map(name => [name, state(join(path, name))]));
}

try {
  await withTemporaryDirectory("javapurs-input-", async temporary => {
    const directory = realpathSync(temporary);
    mkdirSync(join(directory, "src")); mkdirSync(join(directory, "logs"));
    const run = (name, command, args, options = {}) => processes.run(`TAST input: ${name}`, command, args,
      { cwd: directory, log: join(directory, "logs", name + ".log"), timeout: 60_000, ...options });
    const backend = (name, args = [], jobs = "1", options = {}) =>
      run(name, join(root, "bin/javapurs"), args, { env: { ...process.env, GOPURS_JOBS: jobs }, ...options });
    writeFileSync(join(directory, "src/Leaf.purs"), `module Leaf where
data Unit = Unit
foreign import data Action :: Type -> Type
class HasInt a where
  getInt :: a -> Int
`);
    writeFileSync(join(directory, "src/Dependency.purs"), `module Dependency where
import Leaf (Unit(..))
value :: Unit
value = Unit
`);
    writeFileSync(join(directory, "src/Main.purs"), `module Main where
import Leaf (Action, Unit)
import Dependency (value)
foreign import report :: Unit -> Action Unit
main :: Action Unit
main = report value
`);
    writeFileSync(join(directory, "src/Main.java"), `public static final Object report =
  (java.util.function.Function<Object,Object>) value ->
  (java.util.function.Supplier<Object>) () -> null;
`);
    writeFileSync(join(directory, "src/Unused.purs"), "module Unused where\n");
    await run("purs", "purs", ["compile", "src/*.purs", "--codegen", "corefn,docs"]);
    const input = join(directory, "output"), output = join(input, "java");
    assert.ok(existsSync(join(input, "Prim/docs.json")) && !existsSync(join(input, "Prim/corefn.json")));
    const unusedFile = join(input, "Unused/corefn.json"), original = readFileSync(unusedFile);
    const leafFile = join(input, "Leaf/corefn.json"), leaf = JSON.parse(readFileSync(leafFile));
    for (const key of ["dataDecls", "classDecls", "typeTable"]) {
      assert.deepEqual(JSON.parse(original)[key], [], `empty modules may have empty ${key}`);
      assert.ok(leaf[key].length > 0, `nonempty ${key} is decoded too`);
    }
    await backend("valid");
    mkdirSync(join(output, "classes"));
    writeFileSync(join(output, "classes/keep.class"), "compiled bytecode sentinel");
    const generated = state(output);
    assert.ok(generated["__M$Unused.java"] && generated["MainRun.java"]);
    const manifest = JSON.parse(readFileSync(join(output, ".javapurs-manifest.json")));
    assert.equal(manifest.ffi.modules.length, 4);
    const validLog = readFileSync(join(directory, "logs/valid.log"), "utf8");
    assert.ok(validLog.indexOf("Building module Leaf") < validLog.indexOf("Building module Dependency"));
    assert.ok(validLog.indexOf("Building module Dependency") < validLog.indexOf("Building module Main"));

    // Regular root files (including purs' cache) are not module directories.
    writeFileSync(join(input, "notes.txt"), "not a module");
    for (const jobs of ["2", "64", "0", "65", "invalid"]) {
      await backend(`jobs-${jobs}`, [], jobs);
      assert.deepEqual(state(output), generated, `jobs=${jobs}: sources and manifest are identical`);
    }
    // Preserve PBO's acceptance of symlinked module directories and JSON files.
    renameSync(join(input, "Unused"), join(directory, "Unused"));
    symlinkSync(join(directory, "Unused"), join(input, "Unused"), "dir");
    await backend("module-symlink");
    assert.deepEqual(state(output), generated);
    unlinkSync(join(input, "Unused")); renameSync(join(directory, "Unused"), join(input, "Unused"));
    renameSync(unusedFile, join(directory, "unused.json"));
    symlinkSync(join(directory, "unused.json"), unusedFile);
    await backend("file-symlink", [], "2");
    assert.deepEqual(state(output), generated);
    unlinkSync(unusedFile); renameSync(join(directory, "unused.json"), unusedFile);

    // Prim and its submodules do not have ordinary CoreFn files to load.
    const primitive = JSON.parse(original);
    primitive.imports.push({ ...primitive.imports[0], moduleName: ["Prim", "Row"] });
    writeFileSync(unusedFile, JSON.stringify(primitive));
    await backend("prim-submodule");
    assert.deepEqual(state(output), generated);
    writeFileSync(unusedFile, original);

    mkdirSync(join(output, "foreign notes"));
    writeFileSync(join(output, "foreign notes/keep.txt"), "unmanaged data\n");
    const before = state(output), cacheBefore = state(join(directory, ".purmeta"));
    const inputBefore = state(input);
    let cases = 0, failures = 0;
    async function reject(name, diagnostics, protectedOutput = output) {
      cases++;
      for (const jobs of ["1", "2"]) {
        for (const fresh of [false, true]) {
          const label = `${name}-${jobs}-${fresh ? "fresh-library" : "existing-app"}`;
          const args = fresh ? ["--no-main", "--java-output", "fresh Java/nested"] : [];
          await assert.rejects(backend(label, args, jobs, { reportFailure: false }),
            error => error instanceof ProcessFailure && error.code === 1);
          const log = readFileSync(join(directory, "logs", label + ".log"), "utf8");
          for (const pattern of diagnostics) assert.match(log, pattern, label);
          assert.match(log, /load TAST from output:/);
          assert.match(log, /load TAST \+ sort: \d+ ms \(failed\)/);
          assert.match(log, /backend total: \d+ ms \(failed\)/);
          assert.doesNotMatch(log, /Successfully loaded|Building module|prepare:|optimize \+ emit:|publish Java:/);
          assert.deepEqual(state(protectedOutput), before, `${label}: prior Java and manifest preserved`);
          assert.deepEqual(state(join(directory, ".purmeta")), cacheBefore, `${label}: no optimizer/cache work`);
          assert.ok(!existsSync(join(directory, "fresh Java")), `${label}: no output parent created`);
          failures++;
        }
      }
    }
    async function badJson(name, bytes, diagnostic) {
      writeFileSync(unusedFile, bytes);
      try { await reject(name, [/read TAST output\/Unused\/corefn.json:/, diagnostic]); }
      finally { writeFileSync(unusedFile, original); }
    }
    await badJson("broken-json", "{", /JSON/);
    writeFileSync(join(input, "Prim/corefn.json"), "{");
    try { await reject("present-prim-corefn", [/read TAST output\/Prim\/corefn.json:/, /JSON/]); }
    finally { rmSync(join(input, "Prim/corefn.json")); }
    for (const value of [null, []]) {
      await badJson(value === null ? "root-null" : "root-array", JSON.stringify(value), /Expected a TAST JSON object/);
    }
    for (const key of ["dataDecls", "classDecls", "typeTable"]) {
      for (const kind of ["absent", "null", "object"]) {
        const json = JSON.parse(original);
        if (kind === "absent") delete json[key]; else json[key] = kind === "null" ? null : {};
        await badJson(`${key}-${kind}`, JSON.stringify(json), new RegExp(`Incompatible TAST: ${key} must be an array;.*fresh output directory`));
      }
    }
    for (const [key, value] of [["dataDecls", [null]], ["classDecls", [null]], ["typeTable", ["Bogus"]], ["decls", {}]]) {
      const json = { ...JSON.parse(original), [key]: value };
      await badJson(`${key}-decode`, JSON.stringify(json), /Could not|Expected|Type mismatch/i);
    }
    rmSync(unusedFile);
    try {
      await reject("missing-file", [/read TAST output\/Unused\/corefn.json:.*ENOENT/]);
      mkdirSync(unusedFile);
      await reject("directory-file", [/read TAST output\/Unused\/corefn.json: Expected a regular corefn.json file/]);
      rmSync(unusedFile, { recursive: true });
      symlinkSync(join(directory, "absent.json"), unusedFile);
      await reject("dangling-file", [/read TAST output\/Unused\/corefn.json:.*ENOENT/]);
    } finally {
      if (lstatSync(unusedFile, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(unusedFile);
      else rmSync(unusedFile, { recursive: true, force: true });
      writeFileSync(unusedFile, original);
    }
    if (process.getuid?.() !== 0) {
      const mode = lstatSync(unusedFile).mode;
      chmodSync(unusedFile, 0);
      try { await reject("unreadable-file", [/read TAST output\/Unused\/corefn.json:.*EACCES/]); }
      finally { chmodSync(unusedFile, mode); }
    } else console.log("Unreadable-file case skipped: root can read mode-000 files");

    mkdirSync(join(input, "stray directory"));
    try { await reject("stray-directory", [/read TAST output\/stray directory\/corefn.json:.*ENOENT/]); }
    finally { rmSync(join(input, "stray directory"), { recursive: true }); }
    mkdirSync(join(input, "classes"));
    try { await reject("root-classes", [/read TAST output\/classes\/corefn.json:.*ENOENT/]); }
    finally { rmSync(join(input, "classes"), { recursive: true }); }
    symlinkSync(join(directory, "absent-module"), join(input, "Broken"), "dir");
    try { await reject("dangling-module", [/inspect TAST entry output\/Broken:.*ENOENT/]); }
    finally { unlinkSync(join(input, "Broken")); }
    cpSync(join(input, "Unused"), join(input, "Duplicate"), { recursive: true });
    try { await reject("duplicate", [/Duplicate TAST module Unused:/, /output\/Duplicate\/corefn.json/, /output\/Unused\/corefn.json/]); }
    finally { rmSync(join(input, "Duplicate"), { recursive: true }); }
    renameSync(join(input, "Leaf"), join(directory, "Leaf"));
    try { await reject("missing-dependency", [/Missing TAST dependency Leaf required by Dependency in output\/Dependency\/corefn.json/]); }
    finally { renameSync(join(directory, "Leaf"), join(input, "Leaf")); }
    const primPrefix = JSON.parse(original);
    primPrefix.imports.push({ ...primPrefix.imports[0], moduleName: ["PrimMissing"] });
    writeFileSync(unusedFile, JSON.stringify(primPrefix));
    try { await reject("prim-prefix", [/Missing TAST dependency PrimMissing required by Unused in output\/Unused\/corefn.json/]); }
    finally { writeFileSync(unusedFile, original); }

    renameSync(input, join(directory, "saved-input"));
    try {
      await reject("absent-input", [/load TAST from output:.*ENOENT/], join(directory, "saved-input/java"));
      writeFileSync(input, "not a directory");
      await reject("file-input", [/load TAST from output:.*ENOTDIR/], join(directory, "saved-input/java"));
    } finally { rmSync(input, { force: true }); renameSync(join(directory, "saved-input"), input); }
    assert.deepEqual(state(input), inputBefore, "mutations restored the original TAST inputs");
    await backend("restored", [], "2");
    assert.deepEqual(state(output), before, "valid compilation after failures retains its Java and foreign files");
    console.log(`TAST input: ${cases} invalid inputs, ${failures} pre-publication failures, bounded reads, empty metadata, symlinks and Prim imports passed`);
  });
} catch (error) {
  console.error(error);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
