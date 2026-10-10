import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace, runFixture } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { requireExecutable } from "../tools/source-tools.mjs";
import { Interrupted, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Compile real PureScript APIs and their Java fragments in an isolated workspace.
// Main.awaitAff keeps the process alive and propagates asynchronous failures.
assert.equal(process.argv.length, 2, "ffi-ports.mjs accepts no options");
const tools = resolveJavaTools();
const jar = requireExecutable(join(dirname(tools.javac), "jar"));
const processes = new TestProcesses();
try {
  await withTemporaryDirectory("javapurs-ffi-ports-", async directory => {
    prepareWorkspace(compilerRoot, directory, { profile: "ffi-ports" });
    await runFixture({ directory, tools, processes,
      fixture: { name: "FfiPorts", source: join(compilerRoot, "tests/ffi-ports/Main.purs") } });
    const assertCompleted = path => {
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      assert.equal(lines.filter(line => line === "FFI ports: 25 PureScript contract checks passed").length, 1);
      assert.equal(lines.filter(line => line.startsWith("FFI: ")).length, 25);
    };
    assertCompleted(join(directory, "logs/FfiPorts/execution.log"));
    const checkJar = async (mode, classes) => {
      const delivery = join(directory, "delivery-" + mode); mkdirSync(delivery);
      await processes.run(`FfiPorts ${mode}: jar`, jar,
        ["--create", "--file", "app.jar", "--main-class", "MainRun", "-C", join(directory, classes), "."],
        { cwd: delivery, env: tools.env, log: join(directory, `logs/${mode}-jar-build.log`), timeout: 30000 });
      assert.deepEqual(readdirSync(delivery), ["app.jar"]);
      const log = join(directory, `logs/${mode}-jar-execution.log`);
      await processes.run(`FfiPorts ${mode}: standalone JAR`, tools.java, ["-jar", "app.jar"],
        { cwd: delivery, env: { ...tools.env, PATH: dirname(tools.java), CLASSPATH: "" }, log, timeout: 30000 });
      assertCompleted(log);
    };
    await checkJar("typed", "output/java/classes");
    const report = destination => JSON.parse(readFileSync(join(directory, destination, ".javapurs-manifest.json"))).ffi.modules;
    const typed = report("output/java");
    for (const [moduleName, fragment] of [["Effect.Exception", "javapurs-exceptions/src/Effect/Exception.java"],
      ["Effect.Aff", "javapurs-aff/src/Effect/Aff.java"],
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
    assert.deepEqual(report("output/java"), typed, "FFI selection and declarations do not depend on record representation");
    await run("javac", tools.javac, [...tools.javacArgs, "-d", "output/java/classes-maps", "-sourcepath", "output/java", "output/java/MainRun.java"]);
    await run("execution", tools.java, ["-cp", "output/java/classes-maps", "MainRun"]);
    assertCompleted(join(logs, "execution.log"));
    await checkJar("maps", "output/java/classes-maps");
    // Reproduce the transitive-selection mistake with a real registry package.
    // Its declarations exist, but its Java fragment is absent; the report must
    // identify that source instead of treating the local port as selected.
    prepareWorkspace(compilerRoot, directory, { profile: "ffi-ports", registryPackages: ["foreign"] });
    await run("registry-spago", "spago", ["build", "-q"]);
    await run("registry-generation", join(compilerRoot, "bin/javapurs"), ["--java-output", "java-registry"]);
    const foreign = report("java-registry").find(entry => entry.moduleName === "Foreign");
    assert.equal(foreign.status, "missing");
    assert.equal(foreign.selectedJava, null);
    assert.equal(foreign.moduleSource.origin, "spago");
    assert.match(foreign.moduleSource.path, /\/\.spago\/p\/foreign-[^/]+\/src\/Foreign.purs$/);
    assert.ok(foreign.bindings.some(binding => binding.name === "tagOf"));
    console.log("FFI port integration: 25 checks × typed records/Maps × classes/JAR passed; local/registry Foreign selection diagnosed");
  });
} catch (error) {
  if (error instanceof Interrupted) process.exitCode = error.exitCode;
  else { console.error(error); process.exitCode = 1; }
} finally { processes.dispose(); }
