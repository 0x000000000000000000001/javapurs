import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace } from "./fixture-runner.mjs";
import { javaCompileArgs } from "./java-tools.mjs";
import { ProcessFailure } from "./test-process.mjs";
import { UsageError } from "./test-selection.mjs";

const awaited = (directory, wrapper, checks) => ({
  directory, wrapper, ffi: wrapper, checks, main: "Test.PortRunner", completion: "awaited",
  profile: "port-suite", sources: [["test", "src"]], exclude: ["Bench.purs"],
  javacArgs: [], javaArgs: ["-Xss8m"],
});
const synchronous = directory => ({
  directory, main: "Test.Main", completion: "synchronous", template: "spago.java.yaml",
  profile: "fixture", sources: [["src", "src"], ["test", "test"]], exclude: [],
  javacArgs: [], javaArgs: ["-Xss8m"],
});
const spec = (directory, checks) => ({
  ...synchronous(directory), main: "Test.PortRunner", wrapper: "Spec", ffi: "Aff", completion: "awaited", checks,
});
const unsupported = (directory, reason) => ({ ...synchronous(directory), completion: "unsupported", reason });

export const portSuites = {
  aff: awaited("javapurs-aff", "Aff", 45),
  promise: awaited("javapurs-js-promise", "Promise", 13),
  "promise-aff": awaited("javapurs-js-promise-aff", "Aff", 7),
  arrays: synchronous("javapurs-arrays"),
  assert: synchronous("javapurs-assert"),
  avar: synchronous("javapurs-avar"),
  "catenable-lists": synchronous("javapurs-catenable-lists"),
  console: synchronous("javapurs-console"),
  datetime: synchronous("javapurs-datetime"),
  effect: synchronous("javapurs-effect"),
  enums: synchronous("javapurs-enums"),
  "foldable-traversable": synchronous("javapurs-foldable-traversable"),
  foreign: synchronous("javapurs-foreign"),
  "foreign-object": synchronous("javapurs-foreign-object"),
  free: synchronous("javapurs-free"),
  functions: synchronous("javapurs-functions"),
  integers: synchronous("javapurs-integers"),
  "js-date": synchronous("javapurs-js-date"),
  lazy: synchronous("javapurs-lazy"),
  "node-buffer": synchronous("javapurs-node-buffer"),
  "node-event-emitter": spec("javapurs-node-event-emitter", 19),
  "node-fs": { ...synchronous("javapurs-node-fs"), main: "Test.PortRunner", wrapper: "Fs", ffi: "Aff" },
  "node-http": { ...synchronous("javapurs-node-http"), main: "Test.PortRunner", wrapper: "Http", ffi: "Aff" },
  "node-net": { ...synchronous("javapurs-node-net"), main: "Test.PortRunner", wrapper: "Net", ffi: "Aff" },
  "node-path": synchronous("javapurs-node-path"),
  "node-process": synchronous("javapurs-node-process"),
  "node-streams": synchronous("javapurs-node-streams"),
  now: synchronous("javapurs-now"),
  nullable: synchronous("javapurs-nullable"),
  numbers: synchronous("javapurs-numbers"),
  "ordered-collections": synchronous("javapurs-ordered-collections"),
  partial: synchronous("javapurs-partial"),
  prelude: synchronous("javapurs-prelude"),
  quickcheck: synchronous("javapurs-quickcheck"),
  random: synchronous("javapurs-random"),
  record: synchronous("javapurs-record"),
  refs: synchronous("javapurs-refs"),
  exceptions: synchronous("javapurs-exceptions"),
  run: synchronous("javapurs-run"),
  spec: { ...spec("javapurs-spec", 62), wrapper: "SpecOnly" },
  st: synchronous("javapurs-st"),
  strings: { ...synchronous("javapurs-strings"), javacArgs: ["-J-Xss64m"], javaArgs: ["-Xss64m"] },
  "strings-extra": synchronous("javapurs-strings-extra"),
  unfoldable: synchronous("javapurs-unfoldable"),
  "unsafe-coerce": synchronous("javapurs-unsafe-coerce"),
  uuid: spec("javapurs-uuid", 6),
  variant: synchronous("javapurs-variant"),
  "yoga-json": spec("javapurs-yoga-json", 52),
};
export const completionMarker = "PORT SUITE COMPLETED";

function suiteFor(port) {
  if (!Object.hasOwn(portSuites, port)) throw new UsageError(`Unknown port: ${port}`);
  return portSuites[port];
}

export function assertPortSupported(port) {
  const suite = suiteFor(port);
  if (suite.completion === "unsupported") throw new Error(`${port}: unsupported suite completion protocol: ${suite.reason}`);
}

export function parsePortOptions(args) {
  // Preserve the original direct suite's default as named ports are added.
  const options = { selected: ["aff", "promise", "promise-aff"], clean: false, help: false };
  let explicit = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-c" || arg === "--clean") options.clean = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--port" || arg.startsWith("--port=")) {
      const port = arg === "--port" ? args[++index] : arg.slice(7);
      if (!port || explicit) throw new UsageError("Select exactly one named --port.");
      suiteFor(port);
      options.selected = [port]; explicit = true;
    } else throw new UsageError(`Unknown option: ${arg}`);
  }
  return options;
}

export function preparePortSuite(port, directory, { root = compilerRoot } = {}) {
  const suite = suiteFor(port);
  assertPortSupported(port);
  const checkout = resolve(root, "..", suite.directory);
  for (const [source] of suite.sources) {
    if (!existsSync(join(checkout, source))) throw new Error(`Missing ${port} suite input: ${join(checkout, source)}`);
  }
  const config = prepareWorkspace(root, directory, {
    profile: suite.profile, ...(suite.template ? { template: join(checkout, suite.template) } : {}),
  });
  if (suite.template) assert.equal(config.test?.main, "Test.Main", `${port}: unexpected test entrypoint in ${suite.template}`);
  // Copy only declared source/resource trees, including their adjacent FFI.
  // Configuration, lockfiles, caches and outputs of the source port stay there.
  for (const [source, destination] of suite.sources) {
    cpSync(join(checkout, source), join(directory, destination), {
      recursive: true, filter: source => !suite.exclude.includes(basename(source)),
    });
  }
  if (suite.wrapper) {
    const support = join(root, "tests/port-suites");
    const destination = join(directory, suite.template ? "test" : "src", "PortRunner");
    // Keep Test.Main's path available to FFI discovery. Its waiting wrapper has
    // a separate file/module name and the existing completion/failure protocol.
    cpSync(join(support, `${suite.wrapper}.purs`), `${destination}.purs`);
    cpSync(join(support, "Runner.js"), `${destination}.js`);
    const common = readFileSync(join(support, "Runner.java"), "utf8");
    writeFileSync(`${destination}.java`, common + readFileSync(join(support, `${suite.ffi}.java`), "utf8"));
  }
  mkdirSync(join(directory, "logs"), { recursive: true });
  return config;
}

export async function runPortSuite(port, directory, tools, processes, { root = compilerRoot } = {}) {
  const suite = suiteFor(port);
  assertPortSupported(port);
  const compileArgs = javaCompileArgs(tools, suite.javacArgs);
  const run = (phase, command, args, timeout = 120000) => processes.run(`${port}: ${phase}`, command, args,
    { cwd: directory, env: tools.env, timeout, log: join(directory, "logs", `${phase}.log`) });
  await run("purescript", "spago", ["build", "-q"]);
  await run("generation", join(root, "bin/javapurs"), ["--main", suite.main]);
  if (!existsSync(join(directory, "output/java/MainRun.java"))) {
    throw new Error(`${port}: generation did not produce MainRun.java; log: ${join(directory, "logs/generation.log")}`);
  }
  await run("javac", tools.javac, [...compileArgs, "-d", "output/java/classes", "-sourcepath", "output/java", "output/java/MainRun.java"]);
  await run("execution", tools.java, [...suite.javaArgs, "-cp", "output/java/classes", "MainRun"], suite.timeout ?? 45000);
  if (suite.completion === "awaited") {
    const output = readFileSync(join(directory, "logs/execution.log"), "utf8");
    assertCompleted(output);
    if (["Spec", "SpecOnly"].includes(suite.wrapper)) {
      assert.deepEqual(output.split(/\r?\n/).filter(line => line.startsWith("PORT SPEC PASSED: ")),
        [`PORT SPEC PASSED: ${suite.checks}`], `${port}: incomplete assertion inventory`);
    } else {
      assert.equal(output.split(/\r?\n/).filter(line => line.startsWith("[OK] ")).length,
        suite.checks, `${port}: incomplete assertion inventory`);
    }
    console.log(`${port}: ${suite.checks} checks completed`);
  } else {
    assert.equal(suite.completion, "synchronous", `${port}: unsupported suite completion protocol`);
    console.log(`${port}: synchronous ${suite.main} completed`);
  }
}

function assertCompleted(output) {
  assert.equal(output.split(/\r?\n/).filter(line => line === completionMarker).length, 1,
    "Process exited without exactly one suite-completion marker");
}

// Reuse the compiled entrypoint and its actual waiting boundary. These probes
// deliberately fail after suspension, reject, never complete, or exit early.
export async function checkPortRunner(port, directory, tools, processes) {
  const probes = [["late-failure", "runner late assertion"], ["rejection", "runner rejection"], ["timeout", "Port suite timed out"]];
  if (["Spec", "SpecOnly"].includes(suiteFor(port).wrapper)) probes.push(["spec-failure", "Port spec failed"]);
  for (const [mode, diagnostic] of probes) {
    const log = join(directory, "logs", `probe-${mode}.log`);
    await assert.rejects(() => processes.run(`${port}: probe ${mode}`, tools.java,
      ["-Djavapurs.test.mode=" + mode, `-Djavapurs.test.timeout=${mode === "timeout" ? 200 : 5000}`, "-cp", "output/java/classes", "MainRun"],
      { cwd: directory, env: tools.env, timeout: 10000, log, reportFailure: false }),
    error => error instanceof ProcessFailure && error.code === 1 && !error.timeout);
    const output = readFileSync(log, "utf8");
    assert.ok(output.includes(diagnostic), `Missing probe diagnostic: ${diagnostic}`);
    assert.ok(!output.includes(completionMarker), "Failed suite announced completion");
  }
  const log = join(directory, "logs/probe-early-exit.log");
  await processes.run(`${port}: probe early-exit`, tools.java,
    ["-Djavapurs.test.mode=early-exit", "-cp", "output/java/classes", "MainRun"],
    { cwd: directory, env: tools.env, timeout: 5000, log });
  assert.throws(() => assertCompleted(readFileSync(log, "utf8")), /suite-completion marker/);
  console.log(`${port}: delayed assertion, rejection, timeout and premature exit detected${["Spec", "SpecOnly"].includes(suiteFor(port).wrapper) ? "; Spec failure detected" : ""}`);
}
