import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Callbacks may be synchronous (AST suites) or asynchronous (full pipeline).
// Keep failed inputs and logs available; successful runs leave no workspace.
export async function withTemporaryDirectory(prefix, action) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    const result = await action(directory);
    rmSync(directory, { recursive: true, force: true });
    return result;
  } catch (error) {
    console.error(`Test workspace retained: ${directory}`);
    throw error;
  }
}
