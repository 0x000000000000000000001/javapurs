import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveJavaTools } from "./java-tools.mjs";
import { inspectTool, requireExecutable, sha256 } from "./source-tools.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";

// Used by installation and replayed independently against the installed tools.
// The destination is new, so classes and TAST can never come from an earlier run.
export async function sourceSmoke(workspace, destination, processes) {
  const backend = fileURLToPath(new URL("../", import.meta.url));
  const tools = resolveJavaTools();
  const jar = requireExecutable(join(dirname(tools.javac), "jar"));
  const env = { ...tools.env, PATH: [join(workspace, "bin"), join(backend, "bin"), tools.env.PATH].join(delimiter) };
  const spago = requireExecutable("spago", env);
  mkdirSync(destination);
  const result = { javaRelease: tools.release, tools: Object.fromEntries(
    [tools.javac, tools.java, jar].map(path => [path.split("/").at(-1), inspectTool(path, env)])), commands: [], applications: {} };
  for (const [name, expected] of [["hello", "Hello from javapurs"], ["refs", "42"]]) {
    const app = join(destination, name);
    mkdirSync(app);
    for (const file of ["src", "spago.yaml", "spago.lock"]) {
      const source = join(backend, "examples", name, file);
      if (existsSync(source)) cpSync(source, join(app, file), { recursive: true });
    }
    // The example paths describe workspace/apps/refs; replay may use another name.
    if (name === "refs") {
      const config = join(app, "spago.yaml");
      writeFileSync(config, readFileSync(config, "utf8").replace(/path: \.\.\/\.\.\/(javapurs\/[^\n]+)/g,
        (_, path) => `path: ${JSON.stringify(join(workspace, path))}`));
    }
    const run = (phase, command, args, options = {}) => {
      result.commands.push({ application: name, phase, command, args, cwd: options.cwd || app });
      return processes.run(`${name}: ${phase}`, command, args,
        { cwd: app, env, log: join(app, `${phase}.log`), timeout: 120_000, ...options });
    };
    assert.ok(!existsSync(join(app, "output")));
    await run("spago", spago, ["build"]);
    const tast = JSON.parse(readFileSync(join(app, "output/Main/corefn.json"), "utf8"));
    for (const key of ["dataDecls", "classDecls", "typeTable"]) assert.ok(Array.isArray(tast[key]), key);
    mkdirSync(join(app, "output/java/classes"));
    await run("javac", tools.javac, [...tools.javacArgs, "-d", "output/java/classes", "-sourcepath", "output/java", "output/java/MainRun.java"]);
    const classMajor = readFileSync(join(app, "output/java/classes/MainRun.class")).readUInt16BE(6);
    assert.equal(classMajor, tools.release + 44, "bytecode target");
    assert.equal((await run("classes", tools.java, ["-cp", "output/java/classes", "MainRun"], { capture: true })).trim(), expected);
    await run("jar", jar, ["--create", "--file", "app.jar", "--main-class", "MainRun", "-C", "output/java/classes", "."]);
    const manifest = JSON.parse(readFileSync(join(app, "output/java/.javapurs-manifest.json"), "utf8"));
    if (name === "refs") {
      for (const [module, file] of [["Effect", "effect/src/Effect.java"], ["Effect.Ref", "refs/src/Effect/Ref.java"],
        ["Effect.Console", "console/src/Effect/Console.java"]]) {
        const ffi = manifest.ffi.modules.find(entry => entry.moduleName === module);
        assert.ok(ffi, `FFI report for ${module}`);
        assert.equal(ffi.status, "provided", `${module}: Java port selected`);
        assert.equal(ffi.selectedJava.realPath, realpathSync(join(workspace, "javapurs/javapurs-" + file)));
      }
    }
    // Only the jar crosses this boundary. No Node, purs, sources or classes on PATH.
    const delivered = join(destination, `${name}-delivery`);
    mkdirSync(delivered);
    cpSync(join(app, "app.jar"), join(delivered, "app.jar"));
    assert.equal((await run("delivered", tools.java, ["-jar", "app.jar"],
      { cwd: delivered, env: { PATH: dirname(tools.java) }, capture: true })).trim(), expected);
    assert.deepEqual(readdirSync(delivered), ["app.jar"]);
    result.applications[name] = { stdout: expected, classMajor, jarSha256: sha256(join(delivered, "app.jar")),
      builtWith: tast.builtWith, mainTastSha256: sha256(join(app, "output/Main/corefn.json")),
      spagoLockSha256: sha256(join(app, "spago.lock")), javaFiles: Object.keys(manifest.files).length,
      ffi: manifest.ffi };
  }
  writeFileSync(join(destination, "smoke.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const processes = new TestProcesses();
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node tools/source-smoke.mjs WORKSPACE NEW_APPS_DIRECTORY");
    await sourceSmoke(resolve(process.argv[2]), resolve(process.argv[3]), processes);
    console.log("Source smoke: hello and transitive FFI; classes and standalone JARs passed.");
  } catch (error) {
    console.error(`[source-smoke] ${error.message}`);
    process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
  } finally { processes.dispose(); }
}
