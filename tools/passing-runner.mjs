import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compilerRoot as root, prepareWorkspace, runFixture } from "./fixture-runner.mjs";
import { resolveJavaTools } from "./java-tools.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";
import { parseOptions, selectFixtures, UsageError } from "./test-selection.mjs";

let processes;
try {
  const options = parseOptions(process.argv.slice(2), { fixture: true });
  if (options.help) {
    console.log(`Usage: ./bin/test [names or .purs paths...] [--list] [-c] [--keep-going]
  --skip-before NAME / skip_before=NAME   Resume inclusively within the selection
  --until NAME / until=NAME              Stop inclusively within the selection
  -c, --clean                           Rebuild the backend and clean runner caches
  --list                                Resolve selection only, even with -c
With no names (or --all), select the passing corpus, excluding unsupported fixtures.
An invalid explicit name or boundary fails before any build or cleanup.
Each executed fixture replaces tests/runner's generated directories.
Phase logs are kept under logs/tests/NAME/.`);
  } else {
    const fixtures = selectFixtures(root, options);
    if (options.list) {
      for (const fixture of fixtures) console.log(fixture.name);
      console.log(`${fixtures.length} tests selected.`);
    } else {
      const tools = resolveJavaTools();
      const directory = join(root, "tests/runner");
      const logs = join(root, "logs/tests");
      mkdirSync(logs, { recursive: true });
      processes = new TestProcesses();
      if (options.clean) {
        await processes.run("build-javapurs", join(root, "bin/build"), [],
          { cwd: root, env: tools.env, log: join(logs, "build.log") });
        for (const child of [".spago", ".purmeta"]) rmSync(join(directory, child), { recursive: true, force: true });
      }
      prepareWorkspace(root, directory);
      const failures = [];
      let passed = 0;
      for (const fixture of fixtures) {
        try {
          await runFixture({ fixture, directory, processes, tools, logs: join(logs, fixture.name) });
          passed++;
        } catch (error) {
          if (error instanceof Interrupted) throw error;
          failures.push(error.message);
          console.error(`[FAILED] ${error.message}`);
          if (!options.keep) break;
        }
      }
      console.log(`Summary: ${passed} passed, ${failures.length} failed.`);
      if (failures.length) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`[FAILED] ${error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : error instanceof UsageError ? 2 : 1;
} finally {
  processes?.dispose();
}
