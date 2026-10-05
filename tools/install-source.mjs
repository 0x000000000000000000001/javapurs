import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "./java-tools.mjs";
import { inspectTool, requireExecutable, sha256, sourceLock } from "./source-tools.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const processes = new TestProcesses();
let report, reportPath;
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node tools/install-source.mjs NEW_WORKSPACE\nFetch pinned sources, build purs and Javapurs, then compile/run two standalone JARs.\nRequires Git, Bash, Node, Spago 1.0.3, Stack and a complete JDK; see README.");
  } else {
    if (args.length !== 1 || !args[0] || args[0].startsWith("--")) throw new Error("Usage: node tools/install-source.mjs NEW_WORKSPACE");
    const workspace = resolve(args[0]);
    if (existsSync(workspace)) throw new Error(`Workspace already exists: ${workspace}. Choose a new directory; previous sources/logs are preserved.`);
    const tools = Object.fromEntries(["git", "bash", "node", "spago", "stack"].map(name => [name, inspectTool(name)]));
    if (tools.spago.version !== sourceLock.tools.spago) throw new Error(`Spago ${sourceLock.tools.spago} required for this recipe; found ${tools.spago.version} at ${tools.spago.path}`);
    const java = resolveJavaTools();
    const jar = requireExecutable(join(dirname(java.javac), "jar"));
    const git = (args, cwd = root) => execFileSync(tools.git.path, args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
    const revision = git(["rev-parse", "HEAD"]);
    const paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0")
      .filter(path => /^(src\/|bin\/|tools\/|examples\/|spago\.(yaml|lock)$|README\.md$)/.test(path) && existsSync(join(root, path))).sort();
    mkdirSync(dirname(workspace), { recursive: true });
    mkdirSync(workspace);
    mkdirSync(join(workspace, "logs"));
    mkdirSync(join(workspace, "bin"));
    reportPath = join(workspace, "installation.json");
    report = { version: 1, status: "building", workspace, started: new Date().toISOString(), sourceLock,
      backend: { source: root, revision, dirty: git(["status", "--porcelain"]).length > 0, files: {} },
      tools: { ...tools, runnerNode: { path: process.execPath, version: process.version },
        javac: inspectTool(java.javac), java: inspectTool(java.java), jar: inspectTool(jar) }, commands: [] };
    const backend = join(workspace, "javapurs/javapurs");
    for (const path of paths) {
      mkdirSync(dirname(join(backend, path)), { recursive: true });
      cpSync(join(root, path), join(backend, path));
      report.backend.files[path] = sha256(join(backend, path));
    }
    save();
    const run = async (phase, command, args, cwd = workspace, env = process.env) => {
      report.commands.push({ phase, command, args, cwd }); save();
      return processes.run(phase, command, args, { cwd, env, log: join(workspace, "logs", `${phase}.log`), capture: true });
    };
    for (const [index, repository] of sourceLock.repositories.entries()) {
      const path = join(workspace, repository.path);
      mkdirSync(path, { recursive: true });
      await run(`fetch-${index}-init`, tools.git.path, ["init", "--quiet"], path);
      await run(`fetch-${index}-remote`, tools.git.path, ["remote", "add", "origin", repository.url], path);
      await run(`fetch-${index}`, tools.git.path, ["fetch", "--depth=1", "origin", repository.ref], path);
      // Some ports track generated Java. Sparse checkout leaves all sources and
      // build metadata, without ever checking out historical generated trees.
      await run(`fetch-${index}-sparse`, tools.git.path,
        ["sparse-checkout", "set", "--no-cone", "/*", "!/output/", "!/java_output/", "!/.spago/", "!/logs/"], path);
      await run(`fetch-${index}-checkout`, tools.git.path, ["-c", "advice.detachedHead=false", "checkout", "--detach", "FETCH_HEAD"], path);
      if (git(["rev-parse", "HEAD"], path) !== repository.ref) throw new Error(`Unexpected revision: ${path}`);
    }
    const compiler = join(workspace, "purescript");
    const stackArgs = ["--stack-yaml", join(compiler, "stack.yaml"), "--lock-file", "error-on-write"];
    await run("purs-build", tools.stack.path,
      [...stackArgs, "build", "purescript:exe:purs", "--copy-bins", "--local-bin-path", join(workspace, "bin")], compiler);
    const env = { ...java.env, PATH: [join(workspace, "bin"), join(backend, "bin"), dirname(process.execPath), java.env.PATH].join(delimiter) };
    report.buildPath = env.PATH;
    report.tools.purs = { ...inspectTool(join(workspace, "bin/purs"), env), sha256: sha256(join(workspace, "bin/purs")) };
    const ghc = (await run("ghc-path", tools.stack.path, [...stackArgs, "path", "--compiler-exe"], compiler)).trim();
    report.tools.ghc = inspectTool(ghc);
    save();
    const build = await run("backend-build", process.execPath, [join(backend, "tools/build.mjs")], backend, env);
    report.tastProbe = JSON.parse(build.split("\n").find(line => line.startsWith("TAST capability: ")).slice("TAST capability: ".length));
    if (sha256(join(backend, "spago.lock")) !== report.backend.files["spago.lock"]) {
      throw new Error(`Backend lockfile changed: ${join(backend, "spago.lock")}. Review the source recipe before replaying.`);
    }
    const launcher = join(backend, "bin/javapurs").replaceAll("'", "'\\''");
    writeFileSync(join(workspace, "bin/javapurs"), `#!/usr/bin/env bash\nexec '${launcher}' "$@"\n`, { mode: 0o755 });
    // Invoke the installed copy so that its own sources, launchers and examples
    // are the ones exercised, including paths containing spaces.
    await run("applications", process.execPath, [join(backend, "tools/source-smoke.mjs"), workspace, join(workspace, "apps")], backend, env);
    report.smoke = JSON.parse(readFileSync(join(workspace, "apps/smoke.json"), "utf8"));
    report.checkouts = sourceLock.repositories.map(repository => ({ path: repository.path,
      revision: git(["rev-parse", "HEAD"], join(workspace, repository.path)),
      dirty: git(["status", "--porcelain"], join(workspace, repository.path)).length > 0 }));
    report.status = "passed"; report.finished = new Date().toISOString(); save();
    console.log(`Source installation passed. Inventory: ${reportPath}\nAdd to PATH: ${join(workspace, "bin")}\nStandalone JARs: ${join(workspace, "apps/{hello,refs}-delivery/app.jar")}`);
  }
} catch (error) {
  if (report) { report.status = "failed"; report.error = error.message; save(); }
  console.error(`[install-source] ${error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
