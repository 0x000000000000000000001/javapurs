import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOptions, selectModules, UsageError } from "./test-selection.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let processes;
try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: ./bin/modtest [modules...] [--all] [--skip-before NAME] [--list] [-c] [--keep-going]
With no module names, run all sibling javapurs-* repositories with an executable bin/test.
Resume is inclusive; names accept either prelude or javapurs-prelude.
-c rebuilds the javapurs backend once, before starting the selected module scripts.
--keep-going reports every failing module instead of stopping at the first; each
module's output is kept in logs/modtest/<name>.log.
Each sibling script still controls its own build, caches, and cleanup.`);
  } else {
    const modules = selectModules(root, options);
    for (const directory of modules) console.log(basename(directory));
    if (!options.list) {
      console.log(`Selected ${modules.length} modules (${options.resume ? "resume" : options.targets.length ? "explicit selection" : "all"}).`);
      processes = new TestProcesses();
      if (options.clean) await processes.run("build-javapurs", "./bin/build", [], { cwd: root });
      const logs = join(root, "logs", "modtest");
      mkdirSync(logs, { recursive: true });
      const failures = [];
      for (const directory of modules) {
        const name = basename(directory);
        try {
          await processes.run(name, "./bin/test", [], { cwd: directory, log: join(logs, name + ".log") });
        } catch (error) {
          if (!options.keep) throw error;
          failures.push({ name, message: error.message });
        }
      }
      if (failures.length) {
        console.error(`Failing modules (${failures.length}):`);
        for (const failure of failures) console.error(`  ${failure.name}: ${failure.message}`);
        process.exitCode = 1;
      }
      console.log(`Summary: ${modules.length - failures.length} modules passed, ${failures.length} failed.`);
    }
  }
} catch (error) {
  console.error(`[FAILED] ${error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : error instanceof UsageError ? 2 : 1;
} finally {
  processes?.dispose();
}
