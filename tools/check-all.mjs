import assert from "node:assert/strict";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandSync } from "./test-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const logDirectory = join(root, "logs", "check-all");

function phase(name, command, commandArgs, options = {}) {
  const log = join(logDirectory, `${name}.log`);
  console.log(`[check-all] ${name}`);
  const output = openSync(log, "w");
  try {
    // Write both streams as they arrive, including diagnostics from failed or
    // interrupted commands. The log does not depend on an error wrapper shape.
    runCommandSync(command, commandArgs, {
      cwd: root, stdio: ["ignore", output, output], timeout: options.timeout ?? 600_000,
    });
  } catch (failure) {
    throw new Error(`${name}: ${failure.message}; log: ${log}`, { cause: failure });
  } finally { closeSync(output); }
}

try {
  const args = process.argv.slice(2);
  const allowed = new Set(["--quick", "--full", "--help"]);
  assert.ok(args.every(arg => allowed.has(arg)) && !(args.includes("--quick") && args.includes("--full")),
    "usage: check-all.mjs [--quick|--full]");
  if (args.includes("--help")) {
    console.log("usage: check-all.mjs [--quick|--full]\n  default: quick checks; --full adds Spec, test-tools, child-process and Node FS");
  } else {
    const full = args.includes("--full");
    mkdirSync(logDirectory, { recursive: true });
    phase("docs", process.execPath, ["tools/check-docs.mjs"]);
    phase("port-configs", process.execPath, ["tools/check-port-configs.mjs"]);
    phase("port-configs-canonical", process.execPath, ["tools/port-configs.mjs", "--check"]);
    phase("port-ffi", process.execPath, ["tools/check-port-ffi.mjs"]);
    phase("generated", process.execPath, ["tools/check-generated.mjs"]);

    if (full) {
      phase("test-tools", process.execPath, ["--test", "test/test-tools.mjs"], { timeout: 180_000 });
      phase("child-process", process.execPath, ["test/child-process.mjs"], { timeout: 180_000 });
      phase("spec", resolve(root, "..", "javapurs-spec", "bin", "test"), [], { timeout: 900_000 });
      phase("node-fs", resolve(root, "..", "javapurs-node-fs", "bin", "test"), [], { timeout: 180_000 });
    }
    console.log(`[check-all] ${full ? "full" : "quick"} checks passed; logs: ${logDirectory}`);
  }
} catch (error) {
  console.error(`[check-all] ${error.message}`);
  process.exitCode = 1;
}
