import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Isolated child_process FFI probe. The PureScript entrypoint only forces the
// module into the TAST; the Java probe exercises spawn/stdout/exit directly.
const root = fileURLToPath(new URL("../", import.meta.url));
const { javac, java, javacArgs } = resolveJavaTools();
const local = name => join(root, "..", "javapurs-" + name);

await withTemporaryDirectory("javapurs-child-process-", async directory => {
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "src/Main.purs"), `module Main where

import Prelude
import Effect (Effect)
import Node.ChildProcess as CP

main :: Effect Unit
main = void $ CP.spawn "/bin/echo" [ "main" ]
`);
  writeFileSync(join(directory, "spago.yaml"), `package:
  name: child-process-probe
  dependencies:
    - effect
    - node-child-process
    - prelude
workspace:
  packageSet:
    registry: 77.7.0
  extraPackages:
    aff:
      path: ${JSON.stringify(local("aff"))}
    console:
      path: ${JSON.stringify(local("console"))}
    effect:
      path: ${JSON.stringify(local("effect"))}
    exceptions:
      path: ${JSON.stringify(local("exceptions"))}
    node-buffer:
      path: ${JSON.stringify(local("node-buffer"))}
    node-child-process:
      path: ${JSON.stringify(local("node-child-process"))}
    node-event-emitter:
      path: ${JSON.stringify(local("node-event-emitter"))}
    node-streams:
      path: ${JSON.stringify(local("node-streams"))}
    prelude:
      path: ${JSON.stringify(local("prelude"))}
    refs:
      path: ${JSON.stringify(local("refs"))}
    unsafe-coerce:
      path: ${JSON.stringify(local("unsafe-coerce"))}
`);
  runCommandSync("spago", ["build", "-q"], { cwd: directory, timeout: 120_000 });
  runCommandSync(join(root, "bin/javapurs"), ["--main", "Main"], { cwd: directory, timeout: 120_000 });
  runCommandSync(javac, [...javacArgs, "-d", "output/java/classes", "-sourcepath", "output/java", "output/java/MainRun.java"], {
    cwd: directory, timeout: 120_000,
  });
  writeFileSync(join(directory, "Probe.java"), `public final class Probe {
    public static void main(String[] args) throws Exception {
        java.util.function.Function<Object, Object> spawn =
            (java.util.function.Function<Object, Object>) __M$Node_UnsafeChildProcess_Unsafe.spawnImpl;
        Object child = ((java.util.function.Supplier<Object>)
            ((java.util.function.Function<Object, Object>) spawn.apply("/bin/sh"))
                .apply(new Object[] { "-c", "printf child-ok" })).get();
        __M$Node_UnsafeChildProcess_Unsafe.ChildProcessValue value =
            (__M$Node_UnsafeChildProcess_Unsafe.ChildProcessValue) child;
        int code = value.process.waitFor();
        Thread.sleep(100);
        String output = new String(value.stdout.data, java.nio.charset.StandardCharsets.UTF_8);
        if (code != 0 || !output.equals("child-ok")) {
            throw new AssertionError("code=" + code + " output=" + output);
        }
        System.out.println("child process OK");
    }
}
`);
  runCommandSync(javac, [...javacArgs, "-cp", "output/java/classes", "-d", "output/java/classes", "Probe.java"], {
    cwd: directory, timeout: 60_000,
  });
  const output = runCommandSync(java, ["-cp", "output/java/classes", "Probe"], {
    cwd: directory, encoding: "utf8", timeout: 30_000,
  });
  assert.match(output, /child process OK/);
  console.log("Child process: spawn, stdout and exit passed");
});
