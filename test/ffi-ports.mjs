import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
    const report = destination => JSON.parse(readFileSync(join(directory, destination, ".javapurs-manifest.json"))).ffi.modules;
    const typed = report("java_output");
    for (const [moduleName, fragment] of [["Effect.Aff", "javapurs-aff/src/Effect/Aff.java"],
      ["Effect.Ref", "javapurs-refs/src/Effect/Ref.java"], ["Promise.Internal", "javapurs-js-promise/src/Promise/Internal.java"],
      ["Foreign", "javapurs-foreign/src/Foreign.java"]]) {
      const entry = typed.find(entry => entry.moduleName === moduleName);
      assert.equal(entry.status, "provided");
      assert.equal(entry.resolution, "adjacent");
      assert.equal(entry.selectedJava.realPath, realpathSync(resolve(compilerRoot, "..", fragment)));
      assert.equal(entry.verification, "not-checked");
      assert.ok(entry.bindings.length > 0);
    }
    const bridge = typed.find(entry => entry.moduleName === "Promise.Aff");
    assert.equal(bridge.status, "not-required"); assert.deepEqual(bridge.bindings, []);
    // Same TAST and FFI, second record representation. No recompilation of Purs.
    const logs = join(directory, "logs/maps"); mkdirSync(logs, { recursive: true });
    const run = (phase, command, args) => processes.run(`FfiPorts Maps: ${phase}`, command, args,
      { cwd: directory, env: tools.env, log: join(logs, `${phase}.log`) });
    await run("generation", join(compilerRoot, "bin/javapurs"), ["--records=maps"]);
    assert.deepEqual(report("java_output"), typed, "FFI selection and declarations do not depend on record representation");
    await run("javac", tools.javac, ["--release", "17", "-d", "classes-maps", "-sourcepath", "java_output", "java_output/MainRun.java"]);
    await run("execution", tools.java, ["-cp", "classes-maps", "MainRun"]);
    assert.match(readFileSync(join(logs, "execution.log"), "utf8"), /FFI ports: 17 PureScript contract checks passed/);
    // Reproduce the transitive-selection mistake with a real registry package.
    // Its declarations exist, but its Java fragment is absent; the report must
    // identify that source instead of treating the local port as selected.
    const registryConfig = config.replace(/    foreign:\n      path: [^\n]+\n/, "");
    assert.notEqual(registryConfig, config); writeFileSync(configPath, registryConfig);
    await run("registry-spago", "spago", ["build", "-q"]);
    await run("registry-generation", join(compilerRoot, "bin/javapurs"), ["--java-output", "java-registry"]);
    const foreign = report("java-registry").find(entry => entry.moduleName === "Foreign");
    assert.equal(foreign.status, "missing");
    assert.equal(foreign.selectedJava, null);
    assert.equal(foreign.moduleSource.origin, "spago");
    assert.match(foreign.moduleSource.path, /\/\.spago\/p\/foreign-[^/]+\/src\/Foreign.purs$/);
    assert.ok(foreign.bindings.some(binding => binding.name === "tagOf"));
    console.log("FFI port integration: typed records and Maps passed; local/registry Foreign selection diagnosed");
  });
} catch (error) {
  if (error instanceof Interrupted) process.exitCode = error.exitCode;
  else { console.error(error); process.exitCode = 1; }
} finally { processes.dispose(); }
