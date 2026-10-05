import { fileURLToPath } from "node:url";
import { inspectTool, probeCompiler, requireLocalPackages } from "./source-tools.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";

const processes = new TestProcesses();
try {
  if (process.argv.length !== 2) throw new Error("Usage: bin/build (builds the backend checkout from any directory)");
  const root = fileURLToPath(new URL("../", import.meta.url));
  requireLocalPackages(root);
  const spago = inspectTool("spago"), purs = inspectTool("purs");
  console.log(`Node ${process.version}: ${process.execPath}\nSpago ${spago.version}: ${spago.path}\npurs ${purs.version}: ${purs.path}`);
  const metadata = await probeCompiler(purs.path, processes);
  console.log(`TAST capability: ${JSON.stringify(metadata)}`);
  await processes.run("backend build", spago.path, ["build"], { cwd: root });
} catch (error) {
  console.error(`[build] ${error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
