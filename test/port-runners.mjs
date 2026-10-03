import assert from "node:assert/strict";
import { join } from "node:path";
import { compilerRoot } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { portSuites, preparePortSuite, runPortSuite, checkPortRunner } from "../tools/port-test-runner.mjs";
import { Interrupted, TestProcesses } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Each port launcher supplies --port; direct invocation selects these three
// suites. Validate the selection before builds or temporary workspace creation.
let selected = Object.keys(portSuites), rebuild = false, explicit = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "-c" || arg === "--clean") rebuild = true;
  else if (arg.startsWith("--port=")) {
    const name = arg.slice(7);
    assert.ok(!explicit && Object.hasOwn(portSuites, name), `Invalid port selection: ${arg}`);
    selected = [name]; explicit = true;
  } else throw new Error(`Unknown option: ${arg}`);
}
const tools = resolveJavaTools();
const processes = new TestProcesses();
try {
  if (rebuild) await processes.run("backend build", join(compilerRoot, "bin/build"), [], { cwd: compilerRoot, timeout: 120000 });
  for (const port of selected) {
    await withTemporaryDirectory(`javapurs-port-${port}-`, async directory => {
      preparePortSuite(port, directory);
      await runPortSuite(port, directory, tools, processes);
      await checkPortRunner(port, directory, tools, processes);
      console.log(`${port}: suite and runner checks passed`);
    });
  }
} catch (error) {
  if (error instanceof Interrupted) process.exitCode = error.exitCode;
  else { console.error(error); process.exitCode = 1; }
} finally { processes.dispose(); }
