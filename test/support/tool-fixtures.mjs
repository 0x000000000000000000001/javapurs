import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseOptions } from "../../tools/test-selection.mjs";
import { portSuites } from "../../tools/port-test-runner.mjs";

// Build the fake compiler/port workspace used by test-tools.mjs. The returned
// helpers deliberately expose only the paths and commands the tests need; the
// fixture construction stays out of the assertions file.
export function createToolFixtures({ temp, compilerRoot }) {

const root = join(temp, "workspace with spaces/javapurs/javapurs");
const fork = resolve(root, "../../purescript/tests/purs/passing");
const local = join(root, "tests/passing");
const runner = join(root, "tests/runner");
const bin = join(temp, "jdk/bin");
const trace = join(temp, "trace.txt");
const fixtureOptions = args => parseOptions(args, { fixture: true });
const write = (path, contents) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); };
const script = (path, contents) => { write(path, `#!${process.execPath}\n${contents}\n`); chmodSync(path, 0o755); };
for (const name of ["2", "10", "A", "B", "DerivingClause"]) write(join(fork, name + ".purs"), `-- ${name}\nmodule Main where\n`);
write(join(local, "A.purs"), "-- local A\nmodule Main where\n");
write(join(local, "OnlyLocal.purs"), "module Main where\n");
write(join(local, "A/Extra.purs"), "module Extra where\n");
write(join(local, "A/Extra.java"), "// auxiliary Java\n");
write(join(local, "A/Extra.js"), "// auxiliary JS\n");
write(join(local, "A.java"), "// adjacent Java\n");
write(join(local, "A.js"), "// adjacent JS\n");
write(join(root, "tests/ffi/A.java"), "// fallback Java\n");
write(join(root, "output/Main/index.js"), "// built backend placeholder\n");
const localPorts = { prelude: "javapurs-prelude", aff: "javapurs-aff", "js-promise": "javapurs-js-promise",
  "js-promise-aff": "javapurs-js-promise-aff", foreign: "javapurs-foreign" };
for (const port of Object.values(localPorts)) {
  write(resolve(root, "..", port, "spago.yaml"), `# original ${port} configuration\n`);
  write(resolve(root, "..", port, "src/Main.java"), `// original ${port} FFI\n`);
}
const templateYaml = 'package:\n  name: runner\n  dependencies:\n    - prelude\nworkspace:\n  packageSet:\n    registry: 77.10.1\n  extraPackages:\n    prelude:\n      path: "../../../javapurs-prelude"\n';
write(join(runner, "spago.yaml"), templateYaml);
cpSync(join(compilerRoot, "tools"), join(root, "tools"), { recursive: true });
write(join(root, "bin/test"), readFileSync(join(compilerRoot, "bin/test")));
chmodSync(join(root, "bin/test"), 0o755);

function fakeCommand(path, phase, output = "", major = 26) {
  script(path, `const fs = require('node:fs');
    if (process.argv.includes('--version')) { console.log('${phase}' === 'javac' ? 'javac ${major}.0.2' : 'openjdk ${major}.0.2'); process.exit(0); }
    fs.appendFileSync(process.env.TRACE, '${phase}\\n');
    if (process.env.COMMAND_TRACE) fs.appendFileSync(process.env.COMMAND_TRACE, JSON.stringify({ phase: '${phase}',
      command: process.argv[1], args: process.argv.slice(2), cwd: process.cwd(),
      release: process.env.JAVAPURS_JAVA_RELEASE, runtime: process.env.JAVAPURS_JAVA_RUNTIME }) + '\\n');
    console.log('${phase}: stdout'); console.error('${phase}: stderr');
    const input = fs.existsSync('src/Main.purs') ? fs.readFileSync('src/Main.purs', 'utf8') : '';
    if (process.env.FAIL_PHASE === '${phase}' && (!process.env.FAIL_A_ONLY || input.includes('local A'))) process.exit(7);
    if (process.env.HANG_PHASE === '${phase}') {
      process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
    }
    if (process.env.INTERRUPT_PHASE === '${phase}') {
      const signal = process.env.TEST_SIGNAL;
      const { spawn } = require('node:child_process');
      process.on(signal, () => {});
      const leaf = spawn(process.execPath, ['-e',
        "const signal = process.argv[1]; process.on(signal, () => { console.log('leaf:' + signal); process.exit(0); }); console.log('READY'); setInterval(() => {}, 1000);", signal],
        { stdio: ['ignore', 'pipe', 'inherit'] });
      let output = '', sent = false;
      leaf.stdout.on('data', chunk => {
        process.stdout.write(chunk); output += chunk;
        if (!sent && output.includes('READY')) { sent = true; process.kill(process.ppid, signal); }
      });
      leaf.on('close', () => process.exit(0));
    }
    if ('${phase}' === 'execution' && process.env.MOCK_CHECKS) {
      const mode = process.argv.find(arg => arg.startsWith('-Djavapurs.test.mode='))?.split('=')[1];
      const diagnostics = { 'late-failure': 'runner late assertion', rejection: 'runner rejection',
        timeout: 'Port suite timed out', 'spec-failure': 'Port spec failed' };
      if (diagnostics[mode]) { console.error(diagnostics[mode]); process.exit(1); }
      if (mode === 'early-exit') process.exit(0);
      const count = Number(process.env.MOCK_CHECKS) - (process.env.MOCK_INCOMPLETE ? 1 : 0);
      if (process.env.MOCK_SPEC) console.log('PORT SPEC PASSED: ' + count);
      else for (let index = 0; index < count; index++) console.log('[OK] simulated ' + index);
      if (!process.env.MOCK_NO_MARKER) console.log('PORT SUITE COMPLETED');
    }
    ${output}`);
}
fakeCommand(join(bin, "spago"), "purescript");
fakeCommand(join(bin, "javac"), "javac");
fakeCommand(join(bin, "java"), "execution");
fakeCommand(join(root, "bin/build"), "build");
fakeCommand(join(root, "bin/javapurs"), "generation",
  "fs.mkdirSync('output/java', {recursive:true}); if (!process.env.NO_LAUNCHER) fs.writeFileSync('output/java/MainRun.java', '// generated launcher');");
const env = { ...process.env, PATH: bin, JAVA_HOME: dirname(bin), JAVAC: "", JAVA: "", TRACE: trace,
  JAVAPURS_JAVA_RELEASE: "17", JAVAPURS_JAVA_RUNTIME: "" };
function cli(args, extraEnv = {}) {
  writeFileSync(trace, "");
  // Use Bash explicitly so the controlled PATH can omit system tools entirely.
  // The launcher's node lookup is supplied by a symlink below.
  return spawnSync("/bin/bash", [join(root, "bin/test"), ...args],
    { cwd: temp, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 10_000 });
}
symlinkSync(process.execPath, join(bin, "node"));
symlinkSync("/usr/bin/dirname", join(bin, "dirname"));

const pilots = ["refs", "exceptions", "strings"];
const historical = Object.keys(portSuites).filter(port => portSuites[port].template);
const portScratch = join(temp, "port workspaces with spaces"); mkdirSync(portScratch);
const commandTrace = join(temp, "commands.jsonl");
const runtime17 = join(temp, "runtime17/bin/java"); fakeCommand(runtime17, "execution", "", 17);
write(join(root, "test/port-runners.mjs"), readFileSync(join(compilerRoot, "test/port-runners.mjs")));
cpSync(join(compilerRoot, "tests/port-suites"), join(root, "tests/port-suites"), { recursive: true });
for (const port of historical) {
  const checkout = resolve(root, "..", "javapurs-" + port);
  const template = readFileSync(resolve(compilerRoot, "..", "javapurs-" + port, "spago.java.yaml"), "utf8");
  write(join(checkout, "spago.java.yaml"), template);
  for (const [, path] of template.matchAll(/^      path: (.+)$/gm)) mkdirSync(resolve(checkout, JSON.parse(path)), { recursive: true });
  if (!existsSync(join(checkout, "spago.yaml"))) symlinkSync("spago.java.yaml", join(checkout, "spago.yaml"));
  for (const [path, content] of [["src/Example.purs", "module Example where\n"], ["src/Example.java", "// source FFI\n"],
    ["src/Example.js", "// source JS\n"], ["test/Support/Extra.java", "// nested test FFI\n"],
    ["test/Support/input.txt", "test resource\n"], ["spago.lock", "original lock\n"],
    ["output/keep", "old output\n"], ["output/java/keep", "old Java\n"], [".spago/keep", "old cache\n"]]) {
    write(join(checkout, path), content);
  }
  write(join(checkout, port === "strings" ? "test/Test/Main.purs" : "test/Main.purs"), "module Test.Main where\n");
  if (port === "spec") {
    write(join(checkout, "integration-tests/cases/example/Main.purs"), "module Test.Main where\n");
    write(join(checkout, "integration-tests/cases/example/output.txt"), "ok\n");
  }
  write(join(checkout, "bin/test"), readFileSync(resolve(compilerRoot, "..", "javapurs-" + port, "bin/test")));
  chmodSync(join(checkout, "bin/test"), 0o755);
}
function tree(directory) {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = join(directory, entry.name);
    return [entry.name, entry.isSymbolicLink() ? { link: readlinkSync(path) } : entry.isDirectory() ? tree(path) : readFileSync(path, "utf8")];
  }));
}
const originalPorts = () => historical.map(port => tree(resolve(root, "..", "javapurs-" + port)));
const portOriginals = originalPorts();
function portCli(port, args = [], extraEnv = {}) {
  writeFileSync(trace, ""); writeFileSync(commandTrace, "");
  const command = port ? "/bin/bash" : process.execPath;
  const scriptPath = port ? resolve(root, "..", "javapurs-" + port, "bin/test") : join(root, "test/port-runners.mjs");
  return spawnSync(command, [scriptPath, ...args], { cwd: temp, encoding: "utf8", timeout: 10_000,
    env: { ...env, TMPDIR: portScratch, COMMAND_TRACE: commandTrace,
      MOCK_CHECKS: String(portSuites[port]?.checks ?? ""), MOCK_SPEC: portSuites[port]?.assertion === "spec" ? "1" : "", ...extraEnv } });
}
const commands = () => readFileSync(commandTrace, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  return {
    root, fork, local, runner, bin, trace, fixtureOptions, write, script, env, cli,
    pilots, historical, portScratch, commandTrace, runtime17, tree,
    originalPorts, portOriginals, portCli, commands, localPorts, templateYaml,
  };
}
