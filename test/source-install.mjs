import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Negative installation/build boundaries only. The real source -> JAR check is
// tools/install-source.mjs, recorded separately with actual tool/source versions.
const source = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "javapurs-source-tests-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const script = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `#!${process.execPath}\n${text}\n`, { mode: 0o755 }); };
let next = 0;
function fixture() {
  const directory = join(temp, `case ${next++}`);
  const root = join(directory, "workspace/javapurs/javapurs");
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  for (const dir of ["bin", "tools"]) cpSync(join(source, dir), join(root, dir), { recursive: true });
  for (const dep of ["../../purescript-backend-optimizer-javapurs", "../javapurs-foreign-object"]) write(resolve(root, dep, "spago.yaml"), "package: {}\n");
  for (const [name, target] of [["node", process.execPath], ["dirname", "/usr/bin/dirname"], ["bash", "/bin/bash"]]) symlinkSync(target, join(bin, name));
  const trace = join(directory, "trace.txt"); write(trace, "");
  script(join(bin, "spago"), `const fs = require('node:fs');
if (process.argv.includes('--version')) console.log(process.env.SPAGO_VERSION || '1.0.3');
else fs.appendFileSync(process.env.TRACE, process.cwd() + '\\n');`);
  script(join(bin, "purs"), `const fs = require('node:fs');
if (process.argv.includes('--version')) console.log('0.15.16');
else { fs.mkdirSync('output/Probe', { recursive: true }); fs.writeFileSync('output/Probe/corefn.json', process.env.PROBE); }`);
  const env = { ...process.env, PATH: bin, TRACE: trace, TMPDIR: directory,
    JAVA: "", JAVAC: "", JAVA_HOME: join(directory, "jdk"), JAVAPURS_JAVA_RELEASE: "17", JAVAPURS_JAVA_RUNTIME: "",
    PROBE: JSON.stringify({ builtWith: "0.15.16", dataDecls: [{}], classDecls: [{}], typeTable: [{}] }) };
  const build = () => spawnSync("/bin/bash", [join(root, "bin/build")], { cwd: directory, env, encoding: "utf8", timeout: 15_000 });
  const install = args => spawnSync(process.execPath, [join(root, "tools/install-source.mjs"), ...args],
    { cwd: directory, env, encoding: "utf8", timeout: 15_000 });
  return { directory, root, bin, env, trace, build, install };
}
function failed(result, pattern) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, pattern);
}

test("build locates its checkout from another directory and probes the selected purs", () => {
  const f = fixture(), result = f.build();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.trace, "utf8"), f.root + "\n");
  assert.match(result.stdout, /TAST capability:.*dataDecls.*classDecls.*typeTable/);
  assert.ok(!existsSync(join(f.directory, "output")));
});

test("each absent local package or build executable is named before Spago builds", () => {
  for (const dep of ["../../purescript-backend-optimizer-javapurs", "../javapurs-foreign-object"]) {
    const f = fixture(), config = resolve(f.root, dep, "spago.yaml");
    rmSync(config);
    const result = f.build(); failed(result, /Missing local package:/);
    assert.ok(result.stderr.includes(config)); assert.equal(readFileSync(f.trace, "utf8"), "");
  }
  for (const tool of ["node", "purs", "spago"]) {
    const f = fixture(); rmSync(join(f.bin, tool));
    failed(f.build(), tool === "node" ? /Node.js is required/ : new RegExp(`Required executable not found: ${tool}`));
    assert.equal(readFileSync(f.trace, "utf8"), "");
  }
});

test("a matching version with absent or malformed TAST metadata stops before the build", () => {
  for (const key of ["dataDecls", "classDecls", "typeTable"]) {
    for (const value of [undefined, [], {}]) {
      const f = fixture(), data = JSON.parse(f.env.PROBE);
      data[key] = value; f.env.PROBE = JSON.stringify(data);
      const result = f.build(); failed(result, new RegExp(`Incompatible TAST.*needs a nonempty ${key}`));
      assert.ok(result.stderr.includes(join(f.bin, "purs")));
      assert.match(result.stderr, /Select the pinned PureScript fork/);
      assert.equal(readFileSync(f.trace, "utf8"), "");
    }
  }
});

test("launcher diagnoses missing Node, backend entry and transitive built modules", () => {
  const f = fixture();
  const launch = () => spawnSync("/bin/bash", [join(f.root, "bin/javapurs"), "--help"],
    { cwd: f.directory, env: f.env, encoding: "utf8", timeout: 10_000 });
  failed(launch(), /Backend build missing or incomplete\. Run: .*bin\/build/);
  write(join(f.root, "output/Main/index.js"), "import '../Missing/index.js'; export const main = () => {};\n");
  failed(launch(), /Backend build missing or incomplete/);
  rmSync(join(f.bin, "node")); failed(launch(), /Node.js is required/);
});

test("installation rejects existing destinations and invalid arguments without writes", () => {
  const f = fixture(), destination = join(f.directory, "existing");
  write(join(destination, "keep"), "user data");
  failed(f.install([destination]), /Workspace already exists:/);
  assert.equal(readFileSync(join(destination, "keep"), "utf8"), "user data");
  for (const args of [[], ["--unknown"], ["one", "two"]]) failed(f.install(args), /Usage:/);
  const help = f.install(["--help"]); assert.equal(help.status, 0); assert.match(help.stdout, /NEW_WORKSPACE/);
});

test("installation checks all tools, Spago version and jar before creating a workspace", () => {
  for (const missing of ["git", "bash", "node", "spago", "stack", "jdk", "jar", "spago-version"]) {
    const f = fixture(), destination = join(f.directory, "destination");
    for (const name of ["git", "stack"]) script(join(f.bin, name), "if (process.argv.includes('--version')) console.log('version'); else process.exit(99);");
    if (["jdk", "jar", "spago-version"].includes(missing)) {
      for (const name of ["java", "javac"]) script(join(f.env.JAVA_HOME, "bin", name), `console.log('${name === "javac" ? "javac" : "openjdk"} 26.0.2')`);
    }
    if (missing === "jdk") rmSync(join(f.env.JAVA_HOME, "bin/java"));
    else if (missing === "spago-version") f.env.SPAGO_VERSION = "0.93.0";
    else if (missing !== "jar") rmSync(join(f.bin, missing));
    const pattern = missing === "jdk" ? /complete JDK/ : missing === "spago-version" ? /Spago 1.0.3 required/
      : missing === "jar" ? /Required executable not found: .*bin\/jar/ : new RegExp(`Required executable not found: ${missing}`);
    failed(f.install([destination]), pattern);
    assert.ok(!existsSync(destination), `${missing}: no workspace created`);
  }
});
