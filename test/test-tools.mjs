import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { Interrupted, ProcessFailure, runCommandSync, TestProcesses } from "../tools/test-process.mjs";
import { parseOptions, selectFixtures, selectModules, UsageError } from "../tools/test-selection.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Test the runner with fake commands and a tiny corpus: no compiler build,
// application workspace, aggregate port runner, or installed JDK is required.
const temp = mkdtempSync(join(tmpdir(), "javapurs-test-tools-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const root = join(temp, "workspace/javapurs/javapurs");
const fork = resolve(root, "../../purescript/tests/purs/passing");
const local = join(root, "tests/passing");
const runner = join(root, "tests/runner");
const bin = join(temp, "jdk/bin");
const trace = join(temp, "trace.txt");
const fixtureOptions = args => parseOptions(args, { fixture: true });
const write = (path, contents) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); };
const script = (path, contents) => { write(path, `#!${process.execPath}\n${contents}\n`); chmodSync(path, 0o755); };
for (const name of ["2", "10", "A", "B", "DerivingClause"]) write(join(fork, name + ".purs"), `-- ${name}\nmodule Main where\n`);
write(join(local, "A.purs"), "-- local A\nmodule Main where\n");
write(join(local, "OnlyLocal.purs"), "module Main where\n");
write(join(local, "A/Extra.purs"), "module Extra where\n");
write(join(local, "A.java"), "// adjacent Java\n");
write(join(local, "A.js"), "// adjacent JS\n");
write(join(root, "tests/ffi/A.java"), "// fallback Java\n");
write(join(root, "output/Main/index.js"), "// built backend placeholder\n");
mkdirSync(join(root, "../javapurs-prelude"), { recursive: true });
write(join(runner, "spago.yaml"), 'package:\n  name: runner\nworkspace:\n  extraPackages:\n    prelude:\n      path: "../../../javapurs-prelude"\n');
cpSync(join(compilerRoot, "tools"), join(root, "tools"), { recursive: true });
write(join(root, "bin/test"), readFileSync(join(compilerRoot, "bin/test")));
chmodSync(join(root, "bin/test"), 0o755);

function fakeCommand(path, phase, output = "") {
  script(path, `const fs = require('node:fs');
    fs.appendFileSync(process.env.TRACE, '${phase}\\n');
    console.log('${phase}: stdout'); console.error('${phase}: stderr');
    const input = fs.existsSync('src/Main.purs') ? fs.readFileSync('src/Main.purs', 'utf8') : '';
    if (process.env.FAIL_PHASE === '${phase}' && (!process.env.FAIL_A_ONLY || input.includes('local A'))) process.exit(7);
    ${output}`);
}
fakeCommand(join(bin, "spago"), "purescript");
fakeCommand(join(bin, "javac"), "javac");
fakeCommand(join(bin, "java"), "execution");
fakeCommand(join(root, "bin/build"), "build");
fakeCommand(join(root, "bin/javapurs"), "generation",
  "if (!process.env.NO_LAUNCHER) fs.writeFileSync('java_output/MainRun.java', '// generated launcher');");
const env = { ...process.env, PATH: bin, JAVA_HOME: dirname(bin), JAVAC: "", JAVA: "", TRACE: trace };
function cli(args, extraEnv = {}) {
  writeFileSync(trace, "");
  // Use Bash explicitly so the controlled PATH can omit system tools entirely.
  // The launcher's node lookup is supplied by a symlink below.
  return spawnSync("/bin/bash", [join(root, "bin/test"), ...args],
    { cwd: temp, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 10_000 });
}
symlinkSync(process.execPath, join(bin, "node"));
symlinkSync("/usr/bin/dirname", join(bin, "dirname"));

test("fixture selection is strict, ordered and applies local overrides", () => {
  const select = args => selectFixtures(root, fixtureOptions(args), temp);
  assert.deepEqual(select(["10", "A", "2", "A.purs"]).map(f => f.name), ["10", "A", "2"]);
  assert.equal(select(["A"])[0].source, join(local, "A.purs"));
  assert.equal(select(["OnlyLocal"])[0].source, join(local, "OnlyLocal.purs"));
  assert.deepEqual(select(["A", "B", "--skip-before=A", "until=B"]).map(f => f.name), ["A", "B"]);
  assert.deepEqual(select([join(fork, "A.purs")]).map(f => f.name), ["A"]);
  for (const args of [["missing"], ["A", "missing"], ["A", "skip_before=missing"], ["A", "until=B"],
    ["A", "B", "skip_before=B", "until=A"], ["DerivingClause"], ["--clena"], ["--until"], ["until="], ["--all", "A"]]) {
    assert.throws(() => select(args), UsageError, args.join(" "));
  }
});

test("port selection keeps explicit names and inclusive resume", () => {
  for (const name of ["prelude", "refs"]) script(join(root, "../javapurs-" + name, "bin/test"), "process.exit(0)");
  assert.deepEqual(selectModules(root, parseOptions(["refs", "javapurs-prelude", "--skip-before=prelude"])),
    [resolve(root, "../javapurs-prelude")]);
  assert.throws(() => selectModules(root, parseOptions(["missing"])), UsageError);
});

test("--list with --clean and invalid selections have no build or cleanup side effects", () => {
  const marker = join(runner, "src/keep.txt");
  write(marker, "keep");
  const result = cli(["A", "B", "--list", "-c"], { JAVAC: "/missing/javac" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "A\nB\n2 tests selected.\n");
  assert.equal(readFileSync(trace, "utf8"), "");
  for (const args of [["missing", "-c"], ["A", "missing", "--keep-going"], ["A", "--until=missing"], ["--bad-flag"]]) {
    const failure = cli(args);
    assert.equal(failure.status, 2, failure.stderr);
    assert.equal(readFileSync(trace, "utf8"), "");
    assert.equal(readFileSync(marker, "utf8"), "keep");
  }
});

test("runner prepares auxiliary/FFI files and records separate phase logs", () => {
  const result = cli(["A"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(trace, "utf8"), "purescript\ngeneration\njavac\nexecution\n");
  assert.equal(readFileSync(join(runner, "src/Main.purs"), "utf8"), readFileSync(join(local, "A.purs"), "utf8"));
  assert.equal(readFileSync(join(runner, "src/Main.java"), "utf8"), "// adjacent Java\n");
  assert.ok(existsSync(join(runner, "src/Extra.purs")));
  assert.ok(existsSync(join(runner, "src/Main.js")));
  for (const phase of ["purescript", "generation", "javac", "execution"]) {
    const log = readFileSync(join(root, "logs/tests/A", phase + ".log"), "utf8");
    assert.match(log, new RegExp(phase + ": stdout"));
    assert.match(log, new RegExp(phase + ": stderr"));
  }
});

test("each pipeline failure reports its phase, preserves logs, and stops the selection", () => {
  const phases = ["purescript", "generation", "javac", "execution"];
  for (const [index, phase] of phases.entries()) {
    const result = cli(["A", "B"], { FAIL_PHASE: phase });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`A: ${phase} failed \\(exit 7\\)`));
    assert.deepEqual(readFileSync(trace, "utf8").trim().split("\n"), phases.slice(0, index + 1));
    assert.ok(existsSync(join(root, "logs/tests/A", phase + ".log")));
    if (index < phases.length - 1) assert.ok(!existsSync(join(root, "logs/tests/A", phases[index + 1] + ".log")));
  }
  const missing = cli(["A"], { NO_LAUNCHER: "1" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /generation did not produce MainRun/);
});

test("keep-going runs only the remaining named fixtures; clean happens after selection", () => {
  const result = cli(["A", "B", "--keep-going"], { FAIL_PHASE: "javac", FAIL_A_ONLY: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Summary: 1 passed, 1 failed/);
  write(join(runner, ".spago/stale"), "stale");
  write(join(runner, ".purmeta/stale"), "stale");
  const rebuilt = cli(["B", "-c"]);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(readFileSync(trace, "utf8"), "build\npurescript\ngeneration\njavac\nexecution\n");
  assert.ok(!existsSync(join(runner, ".spago/stale")));
  assert.ok(!existsSync(join(runner, ".purmeta/stale")));
});

test("JDK overrides, JAVA_HOME and PATH always select a complete sibling pair", () => {
  for (const variables of [{ JAVAC: join(bin, "javac") }, { JAVA: join(bin, "java") },
    { JAVA_HOME: dirname(bin) }, { PATH: bin }]) {
    const tools = resolveJavaTools(variables);
    assert.equal(tools.javac, join(bin, "javac"));
    assert.equal(tools.java, join(bin, "java"));
    assert.ok(tools.env.PATH.startsWith(bin));
  }
  const other = join(temp, "other/bin");
  script(join(other, "java"), "process.exit(0)");
  assert.throws(() => resolveJavaTools({ JAVAC: join(bin, "javac"), JAVA: join(other, "java") }), /same JDK/);
  assert.throws(() => resolveJavaTools({ JAVA: join(other, "java") }), /complete JDK/);
  assert.throws(() => resolveJavaTools({ JAVAC: temp }), /not executable/);
  assert.throws(() => resolveJavaTools({ JAVA_HOME: "/missing" }), /complete JDK/);
  assert.throws(() => resolveJavaTools({ JAVAC: "/missing" }), /not executable/);
});

test("isolated workspaces rebase package paths and retain failed inputs", async () => {
  const original = readFileSync(join(runner, "spago.yaml"), "utf8");
  let successful;
  await withTemporaryDirectory("javapurs-tools-success-", directory => {
    successful = directory;
    prepareWorkspace(root, directory);
    assert.ok(readFileSync(join(directory, "spago.yaml"), "utf8").includes(resolve(root, "../javapurs-prelude")));
  });
  assert.ok(!existsSync(successful));
  let failed;
  await assert.rejects(withTemporaryDirectory("javapurs-tools-failure-", directory => {
    failed = directory;
    write(join(directory, "input.txt"), "retained");
    throw new Error("expected failure");
  }), /expected failure/);
  assert.equal(readFileSync(join(failed, "input.txt"), "utf8"), "retained");
  rmSync(failed, { recursive: true });
  assert.equal(readFileSync(join(runner, "spago.yaml"), "utf8"), original);
});

test("process helpers report launch errors, exit status, output and timeout", async () => {
  const processes = new TestProcesses();
  try {
    const log = join(temp, "command.log");
    const output = await processes.run("capture", process.execPath,
      ["-e", "console.log(process.env.VALUE); console.error('stderr')"],
      { log, capture: true, env: { ...process.env, VALUE: "stdout" } });
    assert.equal(output, "stdout\n");
    assert.match(readFileSync(log, "utf8"), /stderr/);
    await assert.rejects(processes.run("launch", "/missing/executable", [], { log }),
      error => error instanceof ProcessFailure && /launch failed.*ENOENT/.test(error.message));
    await assert.rejects(processes.run("exit", process.execPath, ["-e", "process.exit(9)"], { log }),
      error => error instanceof ProcessFailure && error.code === 9 && error.log === log);
    await assert.rejects(processes.run("timeout", process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { log, timeout: 250 }),
      error => error instanceof ProcessFailure && error.timeout === 250 && error.signal === "SIGKILL");
    assert.equal(runCommandSync(process.execPath, ["-e", "process.stdout.write('sync')"], { encoding: "utf8" }), "sync");
    assert.throws(() => runCommandSync(process.execPath, ["-e", "process.exit(8)"], { stdio: "pipe" }),
      error => error instanceof ProcessFailure && error.code === 8);
  } finally { processes.dispose(); }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} propagates to grandchildren and preserves the runner exit code`, { timeout: 10_000 }, async () => {
    const leaf = join(temp, "leaf.cjs");
    script(leaf, `process.on('${signal}', () => { console.log('leaf:${signal}'); process.exit(0); });
      console.log('READY'); setInterval(() => {}, 1000);`);
    const parent = join(temp, "parent.cjs");
    script(parent, `const { spawn } = require('node:child_process');
      process.on('${signal}', () => {});
      const child = spawn(process.execPath, [${JSON.stringify(leaf)}], { stdio: 'inherit' });
      child.on('exit', () => process.exit(0));`);
    const module = new URL("../tools/test-process.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { Interrupted, TestProcesses } from ${JSON.stringify(module)};
      const p = new TestProcesses();
      try { await p.run('signal', process.execPath, [${JSON.stringify(parent)}]); }
      catch (e) { if (!(e instanceof Interrupted)) throw e; process.exitCode = e.exitCode; }
      finally { p.dispose(); }`], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let sent = false;
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!sent && output.includes("READY")) { sent = true; child.kill(signal); }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, new Interrupted(signal).exitCode, output);
    assert.equal(result.signal, null, output);
    assert.match(output, new RegExp(`leaf:${signal}`));
  });
}
