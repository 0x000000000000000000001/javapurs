import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace, runFixture } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { Interrupted, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Compile real PureScript APIs and their Java fragments in an isolated workspace.
// Main.awaitAff keeps the process alive and propagates asynchronous failures.
assert.equal(process.argv.length, 2, "ffi-ports.mjs accepts no options");
const tools = resolveJavaTools();
const processes = new TestProcesses();
try {
  await withTemporaryDirectory("javapurs-ffi-ports-", async directory => {
    prepareWorkspace(compilerRoot, directory);
    const configPath = join(directory, "spago.yaml");
    let config = readFileSync(configPath, "utf8").replace("  dependencies:\n", "  dependencies:\n    - aff\n    - js-promise\n    - js-promise-aff\n    - either\n    - parallel\n");
    for (const [name, port] of [["aff", "javapurs-aff"], ["js-promise", "javapurs-js-promise"], ["js-promise-aff", "javapurs-js-promise-aff"], ["foreign", "javapurs-foreign"]]) {
      config += `    ${name}:\n      path: ${JSON.stringify(resolve(compilerRoot, "..", port))}\n`;
    }
    writeFileSync(configPath, config);
    await runFixture({ directory, tools, processes, javacArgs: ["--release", "17"],
      fixture: { name: "FfiPorts", source: join(compilerRoot, "tests/ffi-ports/Main.purs") } });
    assert.match(readFileSync(join(directory, "logs/FfiPorts/execution.log"), "utf8"), /FFI ports: 17 PureScript contract checks passed/);
    // Same TAST and FFI, second record representation. No recompilation of Purs.
    const logs = join(directory, "logs/maps"); mkdirSync(logs, { recursive: true });
    const run = (phase, command, args) => processes.run(`FfiPorts Maps: ${phase}`, command, args,
      { cwd: directory, env: tools.env, log: join(logs, `${phase}.log`) });
    await run("generation", join(compilerRoot, "bin/javapurs"), ["--records=maps"]);
    await run("javac", tools.javac, ["--release", "17", "-d", "classes-maps", "-sourcepath", "java_output", "java_output/MainRun.java"]);
    await run("execution", tools.java, ["-cp", "classes-maps", "MainRun"]);
    assert.match(readFileSync(join(logs, "execution.log"), "utf8"), /FFI ports: 17 PureScript contract checks passed/);
    console.log("FFI port integration: typed records and Maps passed");
  });
} catch (error) {
  if (error instanceof Interrupted) process.exitCode = error.exitCode;
  else { console.error(error); process.exitCode = 1; }
} finally { processes.dispose(); }
