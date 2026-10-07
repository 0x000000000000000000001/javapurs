import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { compilerRoot } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { portSuites, assertPortSupported, parsePortOptions, preparePortSuite, runPortSuite, checkPortRunner } from "../tools/port-test-runner.mjs";
import { Interrupted, TestProcesses } from "../tools/test-process.mjs";
import { UsageError } from "../tools/test-selection.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Launchers supply one port. Validate all arguments before probing tools or
// creating workspaces; help remains read-only, including when combined with -c.
let processes;
try {
  const options = parsePortOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node test/port-runners.mjs [--port=NAME] [-c|--clean] [-h|--help]
Ports: ${Object.keys(portSuites).join(", ")}
Unsupported completion (fails before build): ${Object.keys(portSuites).filter(port => portSuites[port].completion === "unsupported").join(", ")}
Without --port, select only aff, promise and promise-aff.
-c, --clean rebuilds the backend with bin/build before the selected suites.
Each suite uses a fresh isolated workspace and bounded, logged phases.
Failed workspaces/logs are retained; source checkouts and their outputs are preserved.
JAVAPURS_JAVA_RELEASE selects the target (default 17).
JAVAPURS_JAVA_RUNTIME optionally selects a separate execution JVM.`);
  } else {
    options.selected.forEach(assertPortSupported);
    const tools = resolveJavaTools();
    processes = new TestProcesses();
    let rebuild = options.clean;
    for (const port of options.selected) {
      await withTemporaryDirectory(`javapurs-port-${port}-`, async directory => {
        mkdirSync(join(directory, "logs"));
        if (rebuild) {
          await processes.run(`${port}: backend build`, join(compilerRoot, "bin/build"), [],
            { cwd: compilerRoot, env: tools.env, timeout: 120000, log: join(directory, "logs/build.log") });
          rebuild = false;
        }
        const config = preparePortSuite(port, directory);
        console.log(`${port}: package set ${config.packageSet}, entrypoint ${portSuites[port].main}`);
        await runPortSuite(port, directory, tools, processes);
        if (portSuites[port].completion === "awaited") await checkPortRunner(port, directory, tools, processes);
        console.log(`${port}: suite and runner checks passed`);
      });
    }
  }
} catch (error) {
  console.error(`[FAILED] ${error.message}`);
  if (error instanceof Interrupted) process.exitCode = error.exitCode;
  else process.exitCode = error instanceof UsageError ? 2 : 1;
} finally { processes?.dispose(); }
