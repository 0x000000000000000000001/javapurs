import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJavaTools } from "./java-tools.mjs";
import { inspectTool } from "./source-tools.mjs";
import { Interrupted, TestProcesses } from "./test-process.mjs";

// Fixed, focused selection: no passing corpus or aggregate port runner.
const suites = ["driver", "representations", "chunk", "big-function", "ffi-runtimes", "ffi-ports"];
const root = fileURLToPath(new URL("../", import.meta.url));
const usage = "Usage: node tools/check-jdk.mjs --jdk17 HOME --recent-jdk HOME --output NEW_DIRECTORY";
const processes = new TestProcesses();
let report, reportPath;
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
try {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    while (args.length) {
      const key = args.shift();
      if (!["--jdk17", "--recent-jdk", "--output"].includes(key) || options[key] || !args[0] || args[0].startsWith("--")) throw new Error(usage);
      options[key] = resolve(args.shift());
    }
    if (Object.keys(options).length !== 3) throw new Error(usage);
    const destination = options["--output"];
    if (existsSync(destination)) throw new Error(`Results directory already exists: ${destination}`);
    if (!existsSync(join(root, "output/Main/index.js"))) throw new Error(`Backend not built: run ${join(root, "bin/build")}`);
    const select = (build, runtime) => resolveJavaTools({ ...process.env,
      JAVA_HOME: build, JAVAC: join(build, "bin/javac"), JAVA: join(build, "bin/java"),
      JAVAPURS_JAVA_RUNTIME: join(runtime, "bin/java"), JAVAPURS_JAVA_RELEASE: "17" });
    const jdk17 = options["--jdk17"], recent = options["--recent-jdk"];
    const rows = [["jdk17", select(jdk17, jdk17)], ["recent", select(recent, recent)], ["recent-to-17", select(recent, jdk17)]];
    assert.equal(rows[0][1].versions.javac.major, 17, "--jdk17 must select JDK 17");
    assert.equal(rows[0][1].versions.java.major, 17, "--jdk17 runtime must be Java 17");
    assert.ok(rows[1][1].versions.javac.major > 17, "--recent-jdk must be newer than JDK 17");
    assert.equal(rows[1][1].versions.javac.major, rows[1][1].versions.java.major, "recent build/runtime versions must match");
    const tools = Object.fromEntries(["node", "purs", "spago"].map(name => [name, inspectTool(name)]));
    mkdirSync(dirname(destination), { recursive: true }); mkdirSync(destination);
    reportPath = join(destination, "matrix.json");
    report = { version: 1, status: "running", started: new Date().toISOString(), root, tools,
      javaRelease: 17, suites, rows: {} }; save();
    for (const [name, toolchain] of rows) {
      const directory = join(destination, name); mkdirSync(directory);
      const { env, ...inventory } = toolchain;
      const row = report.rows[name] = { toolchain: inventory, status: "running", suites: {} }; save();
      console.log(`${name}: javac ${toolchain.versions.javac.major}, release ${toolchain.release}, JVM ${toolchain.versions.java.major}`);
      writeFileSync(join(directory, "JdkProbe.java"), 'public class JdkProbe { public static void main(String[] args) { System.out.println(System.getProperty("java.specification.version")); } }\n');
      await processes.run(`${name}: bytecode probe`, toolchain.javac, [...toolchain.javacArgs, "JdkProbe.java"],
        { cwd: directory, env, log: join(directory, "probe-javac.log"), timeout: 30_000 });
      row.classMajor = readFileSync(join(directory, "JdkProbe.class")).readUInt16BE(6);
      assert.equal(row.classMajor, 61, "release 17 bytecode");
      const runtime = await processes.run(`${name}: runtime probe`, toolchain.java, ["-cp", directory, "JdkProbe"],
        { env, log: join(directory, "probe-java.log"), capture: true, timeout: 30_000 });
      assert.equal(runtime.trim(), String(toolchain.versions.java.major));
      for (const suite of suites) {
        const log = join(directory, `${suite}.log`);
        row.suites[suite] = { status: "running", log }; save();
        await processes.run(`${name}: ${suite}`, process.execPath, [join(root, "test", `${suite}.mjs`)],
          { cwd: root, env, log, timeout: 600_000 });
        row.suites[suite].status = "passed"; save();
      }
      row.status = "passed"; save();
    }
    report.status = "passed"; report.finished = new Date().toISOString(); save();
    console.log(`JDK matrix passed: ${suites.length} focused suites × ${rows.length} configurations; ${reportPath}`);
  }
} catch (error) {
  if (report) { report.status = "failed"; report.error = error.message; save(); }
  console.error(`[check-jdk] ${error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally { processes.dispose(); }
