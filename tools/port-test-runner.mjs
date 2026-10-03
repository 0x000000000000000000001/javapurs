import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace } from "./fixture-runner.mjs";
import { ProcessFailure } from "./test-process.mjs";

export const portSuites = {
  aff: { directory: "javapurs-aff", wrapper: "Aff", checks: 45 },
  promise: { directory: "javapurs-js-promise", wrapper: "Promise", checks: 13 },
  "promise-aff": { directory: "javapurs-js-promise-aff", wrapper: "Aff", checks: 7 },
};
export const completionMarker = "PORT SUITE COMPLETED";

export function preparePortSuite(port, directory) {
  const suite = portSuites[port];
  assert.ok(suite, `Unknown port: ${port}`);
  prepareWorkspace(compilerRoot, directory);
  const config = join(directory, "spago.yaml");
  let yaml = readFileSync(config, "utf8").replace("  dependencies:\n",
    "  dependencies:\n    - aff\n    - js-promise\n    - js-promise-aff\n    - foreign\n    - either\n    - maybe\n    - parallel\n    - datetime\n    - transformers\n    - control\n    - bifunctors\n");
  for (const [name, checkout] of [["aff", "javapurs-aff"], ["js-promise", "javapurs-js-promise"],
    ["js-promise-aff", "javapurs-js-promise-aff"], ["foreign", "javapurs-foreign"]]) {
    yaml += `    ${name}:\n      path: ${JSON.stringify(resolve(compilerRoot, "..", checkout))}\n`;
  }
  writeFileSync(config, yaml);
  // Only copy the selected suite, never the port's build/cache/configuration.
  cpSync(resolve(compilerRoot, "..", suite.directory, "test"), join(directory, "src"), {
    recursive: true, filter: source => !source.endsWith("/Bench.purs"),
  });
  const support = join(compilerRoot, "tests/port-suites");
  // Test.Main lives under test/Main.purs in the Promise ports. Keep that path
  // available to FFI discovery; the wrapper has its own file and module name.
  for (const extension of ["purs", "java", "js"]) {
    const source = extension === "purs" ? `${suite.wrapper}.purs` : `Runner.${extension}`;
    cpSync(join(support, source), join(directory, `src/PortRunner.${extension}`));
  }
  for (const child of ["java_output", "classes", "logs"]) mkdirSync(join(directory, child), { recursive: true });
}

export async function runPortSuite(port, directory, tools, processes) {
  const run = (phase, command, args, timeout = 120000) => processes.run(`${port}: ${phase}`, command, args,
    { cwd: directory, env: tools.env, timeout, log: join(directory, "logs", `${phase}.log`) });
  await run("purescript", "spago", ["build", "-q"]);
  await run("generation", join(compilerRoot, "bin/javapurs"), ["--main", "Test.PortRunner"]);
  await run("javac", tools.javac, ["--release", "17", "-d", "classes", "-sourcepath", "java_output", "java_output/MainRun.java"]);
  await run("execution", tools.java, ["-Xss8m", "-cp", "classes", "MainRun"], 45000);
  const output = readFileSync(join(directory, "logs/execution.log"), "utf8");
  assertCompleted(output);
  assert.equal(output.split(/\r?\n/).filter(line => line.startsWith("[OK] ")).length,
    portSuites[port].checks, `${port}: incomplete assertion inventory`);
  console.log(`${port}: ${portSuites[port].checks} checks completed`);
}

function assertCompleted(output) {
  assert.equal(output.split(/\r?\n/).filter(line => line === completionMarker).length, 1,
    "Process exited without exactly one suite-completion marker");
}

// Reuse the compiled entrypoint and its actual waiting boundary. These probes
// deliberately fail after suspension, reject, never complete, or exit early.
export async function checkPortRunner(port, directory, tools, processes) {
  for (const [mode, diagnostic] of [["late-failure", "runner late assertion"],
    ["rejection", "runner rejection"], ["timeout", "Port suite timed out"]]) {
    const log = join(directory, "logs", `probe-${mode}.log`);
    await assert.rejects(() => processes.run(`${port}: probe ${mode}`, tools.java,
      ["-Djavapurs.test.mode=" + mode, `-Djavapurs.test.timeout=${mode === "timeout" ? 200 : 5000}`, "-cp", "classes", "MainRun"],
      { cwd: directory, env: tools.env, timeout: 10000, log, reportFailure: false }),
    error => error instanceof ProcessFailure && error.code === 1 && !error.timeout);
    const output = readFileSync(log, "utf8");
    assert.ok(output.includes(diagnostic), `Missing probe diagnostic: ${diagnostic}`);
    assert.ok(!output.includes(completionMarker), "Failed suite announced completion");
  }
  const log = join(directory, "logs/probe-early-exit.log");
  await processes.run(`${port}: probe early-exit`, tools.java,
    ["-Djavapurs.test.mode=early-exit", "-cp", "classes", "MainRun"],
    { cwd: directory, env: tools.env, timeout: 5000, log });
  assert.throws(() => assertCompleted(readFileSync(log, "utf8")), /suite-completion marker/);
  console.log(`${port}: delayed assertion, rejection, timeout and premature exit detected`);
}
