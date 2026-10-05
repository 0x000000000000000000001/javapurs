#!/usr/bin/env node
import { fileURLToPath } from "node:url";

try {
  const { main } = await import("../output/Main/index.js");
  main();
} catch (error) {
  console.error(`javapurs: ${error.message}`);
  if (error.code === "ERR_MODULE_NOT_FOUND") {
    console.error(`Backend build missing or incomplete. Run: ${fileURLToPath(new URL("./build", import.meta.url))}`);
  }
  process.exitCode = 1;
}
