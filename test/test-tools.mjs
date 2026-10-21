import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compilerRoot, prepareWorkspace, runFixture } from "../tools/fixture-runner.mjs";
import { javaCompileArgs, resolveJavaTools } from "../tools/java-tools.mjs";
import { portSuites, parsePortOptions, preparePortSuite, runPortSuite } from "../tools/port-test-runner.mjs";
import { Interrupted, ProcessFailure, runCommandSync, TestProcesses } from "../tools/test-process.mjs";
import { parseOptions, selectFixtures, selectModules, UsageError } from "../tools/test-selection.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";
import { createToolFixtures } from "./support/tool-fixtures.mjs";

// Test the runner with fake commands and a tiny corpus: no compiler build,
// application workspace, aggregate port runner, or installed JDK is required.
const temp = realpathSync(mkdtempSync(join(tmpdir(), "javapurs-test-tools-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const {
  root, fork, local, runner, bin, trace, fixtureOptions, write, script, env, cli,
  pilots, historical, portScratch, commandTrace, runtime17, tree,
  originalPorts, portOriginals, portCli, commands, localPorts, templateYaml,
} = createToolFixtures({ temp, compilerRoot });

function retained(result) {
  const path = result.stderr.match(/^Test workspace retained: (.+)$/m)?.[1];
  assert.ok(path && existsSync(path), result.stderr);
  return path;
}

test("fixture selection is strict, ordered and applies local overrides", () => {
  const select = args => selectFixtures(root, fixtureOptions(args), temp);
  assert.deepEqual(select(["10", "A", "2", "A.purs"]).map(f => f.name), ["10", "A", "2"]);
  assert.equal(select(["A"])[0].source, join(local, "A.purs"));
  assert.equal(select(["OnlyLocal"])[0].source, join(local, "OnlyLocal.purs"));
  assert.deepEqual(select(["A", "B", "--skip-before=A", "until=B"]).map(f => f.name), ["A", "B"]);
  assert.deepEqual(select([join(fork, "A.purs")]).map(f => f.name), ["A"]);
  for (const args of [["missing"], ["A", "missing"], ["A", "skip_before=missing"], ["A", "until=B"],
    ["A", "B", "skip_before=B", "until=A"], ["DerivingClause"], ["--clena"], ["--until"], ["until="], ["--all", "A"]]) {
    assert.throws(() => select(args), UsageError, args.join(" "));
  }
});

test("port selection keeps explicit names and inclusive resume", () => {
  assert.deepEqual(selectModules(root, parseOptions(["refs", "javapurs-prelude", "--skip-before=prelude"])),
    [resolve(root, "../javapurs-prelude")]);
  assert.throws(() => selectModules(root, parseOptions(["missing"])), UsageError);
});

test("--list with --clean and invalid selections have no build or cleanup side effects", () => {
  const marker = join(runner, "src/keep.txt");
  write(marker, "keep");
  const result = cli(["A", "B", "--list", "-c"], { JAVAC: "/missing/javac" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "A\nB\n2 tests selected.\n");
  assert.equal(readFileSync(trace, "utf8"), "");
  for (const args of [["missing", "-c"], ["A", "missing", "--keep-going"], ["A", "--until=missing"], ["--bad-flag"]]) {
    const failure = cli(args);
    assert.equal(failure.status, 2, failure.stderr);
    assert.equal(readFileSync(trace, "utf8"), "");
    assert.equal(readFileSync(marker, "utf8"), "keep");
  }
});

test("runner prepares auxiliary/FFI files and records separate phase logs", () => {
  const sources = ["A.purs", "A.java", "A.js", "A/Extra.purs", "A/Extra.java", "A/Extra.js"];
  const originals = sources.map(file => readFileSync(join(local, file), "utf8"));
  const result = cli(["A"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(trace, "utf8"), "purescript\ngeneration\njavac\nexecution\n");
  assert.equal(readFileSync(join(runner, "src/Main.purs"), "utf8"), readFileSync(join(local, "A.purs"), "utf8"));
  assert.equal(readFileSync(join(runner, "src/Main.java"), "utf8"), "// adjacent Java\n");
  assert.ok(existsSync(join(runner, "src/Extra.purs")));
  assert.equal(readFileSync(join(runner, "src/Extra.java"), "utf8"), "// auxiliary Java\n");
  assert.equal(readFileSync(join(runner, "src/Extra.js"), "utf8"), "// auxiliary JS\n");
  assert.ok(existsSync(join(runner, "src/Main.js")));
  for (const [index, file] of sources.entries()) {
    assert.equal(readFileSync(join(local, file), "utf8"), originals[index]);
  }
  for (const phase of ["purescript", "generation", "javac", "execution"]) {
    const log = readFileSync(join(root, "logs/tests/A", phase + ".log"), "utf8");
    assert.match(log, new RegExp(phase + ": stdout"));
    assert.match(log, new RegExp(phase + ": stderr"));
  }
});

test("each pipeline failure reports its phase, preserves logs, and stops the selection", () => {
  const phases = ["purescript", "generation", "javac", "execution"];
  for (const [index, phase] of phases.entries()) {
    const result = cli(["A", "B"], { FAIL_PHASE: phase });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`A: ${phase} failed \\(exit 7\\)`));
    assert.deepEqual(readFileSync(trace, "utf8").trim().split("\n"), phases.slice(0, index + 1));
    assert.ok(existsSync(join(root, "logs/tests/A", phase + ".log")));
    if (index < phases.length - 1) assert.ok(!existsSync(join(root, "logs/tests/A", phases[index + 1] + ".log")));
  }
  const missing = cli(["A"], { NO_LAUNCHER: "1" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /generation did not produce MainRun/);
});

test("keep-going runs only the remaining named fixtures; clean happens after selection", () => {
  const result = cli(["A", "B", "--keep-going"], { FAIL_PHASE: "javac", FAIL_A_ONLY: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Summary: 1 passed, 1 failed/);
  write(join(runner, ".spago/stale"), "stale");
  write(join(runner, ".purmeta/stale"), "stale");
  const rebuilt = cli(["B", "-c"]);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(readFileSync(trace, "utf8"), "build\npurescript\ngeneration\njavac\nexecution\n");
  assert.ok(!existsSync(join(runner, ".spago/stale")));
  assert.ok(!existsSync(join(runner, ".purmeta/stale")));
});

test("JDK overrides, JAVA_HOME and PATH always select a complete sibling pair", () => {
  for (const variables of [{ JAVAC: join(bin, "javac") }, { JAVA: join(bin, "java") },
    { JAVA_HOME: dirname(bin) }, { PATH: bin }]) {
    const tools = resolveJavaTools(variables);
    assert.equal(tools.javac, join(bin, "javac"));
    assert.equal(tools.java, join(bin, "java"));
    assert.ok(tools.env.PATH.startsWith(bin));
  }
  const other = join(temp, "other/bin");
  script(join(other, "java"), "process.exit(0)");
  assert.throws(() => resolveJavaTools({ JAVAC: join(bin, "javac"), JAVA: join(other, "java") }), /same JDK/);
  assert.throws(() => resolveJavaTools({ JAVA: join(other, "java") }), /complete JDK/);
  assert.throws(() => resolveJavaTools({ JAVAC: temp }), /not executable/);
  assert.throws(() => resolveJavaTools({ JAVA_HOME: "/missing" }), /complete JDK/);
  assert.throws(() => resolveJavaTools({ JAVAC: "/missing" }), /not executable/);
});

test("release and explicit execution JVM are validated independently of the build pair", () => {
  const jdk17 = join(temp, "jdk17/bin");
  script(join(jdk17, "java"), "console.log('openjdk 17.0.20.1')");
  script(join(jdk17, "javac"), "console.log('javac 17.0.20.1')");
  const base = { JAVA_HOME: dirname(bin), TRACE: trace };
  const tools = resolveJavaTools({ ...base, JAVAPURS_JAVA_RUNTIME: join(jdk17, "java") });
  assert.equal(tools.release, 17); assert.equal(tools.versions.javac.major, 26); assert.equal(tools.versions.java.major, 17);
  assert.equal(tools.java, join(jdk17, "java")); assert.equal(tools.env.JAVA, join(bin, "java"));
  assert.equal(resolveJavaTools(tools.env).java, tools.java, "nested resolution keeps the explicit runtime");
  assert.deepEqual(javaCompileArgs(tools, ["-J-Xmx4g"]), ["--release", "17", "-J-Xmx4g"]);
  assert.deepEqual(resolveJavaTools({ ...base, JAVAPURS_JAVA_RELEASE: "26" }).javacArgs, ["--release", "26"]);
  for (const value of ["", "0", "16", "17.0", "017", "17x", "NaN", " 17", "9007199254740992"]) {
    assert.throws(() => resolveJavaTools({ ...base, JAVAPURS_JAVA_RELEASE: value }), /JAVAPURS_JAVA_RELEASE must be an integer/);
  }
  assert.throws(() => resolveJavaTools({ ...base, JAVAPURS_JAVA_RELEASE: "27" }), /requires javac >= 27/);
  assert.throws(() => resolveJavaTools({ JAVA_HOME: dirname(jdk17), JAVAPURS_JAVA_RELEASE: "26" }), /requires javac >= 26/);
  assert.throws(() => resolveJavaTools({ ...base, JAVAPURS_JAVA_RELEASE: "26", JAVAPURS_JAVA_RUNTIME: join(jdk17, "java") }), /requires a runtime >= 26/);
  assert.throws(() => resolveJavaTools({ ...base, JAVAPURS_JAVA_RUNTIME: "/missing/java" }), /JAVAPURS_JAVA_RUNTIME is not executable/);
  const unknown = join(temp, "unknown-version/java"); script(unknown, "console.log('unrecognized version')");
  assert.throws(() => resolveJavaTools({ ...base, JAVAPURS_JAVA_RUNTIME: unknown }), /Unrecognized Java version/);
});

test("a conflicting fixture target fails before cleanup or any build phase", async () => {
  const tools = resolveJavaTools(env);
  for (const flag of ["--release", "--release=17", "--source", "-source", "--target", "-target", "--enable-preview"]) {
    const marker = join(runner, "src/keep.txt"); write(marker, "keep");
    writeFileSync(trace, "");
    await assert.rejects(runFixture({ fixture: { name: "A", source: join(local, "A.purs") }, root,
      directory: runner, tools, javacArgs: [flag], processes: null }), /JAVAPURS_JAVA_RELEASE/);
    assert.equal(readFileSync(marker, "utf8"), "keep"); assert.equal(readFileSync(trace, "utf8"), "");
  }
});

test("isolated workspaces rebase package paths and retain failed inputs", async () => {
  const original = readFileSync(join(runner, "spago.yaml"), "utf8");
  let successful;
  await withTemporaryDirectory("javapurs-tools-success-", directory => {
    successful = directory;
    prepareWorkspace(root, directory);
    assert.ok(readFileSync(join(directory, "spago.yaml"), "utf8").includes(resolve(root, "../javapurs-prelude")));
  });
  assert.ok(!existsSync(successful));
  let failed;
  await assert.rejects(withTemporaryDirectory("javapurs-tools-failure-", directory => {
    failed = directory;
    write(join(directory, "input.txt"), "retained");
    throw new Error("expected failure");
  }), /expected failure/);
  assert.equal(readFileSync(join(failed, "input.txt"), "utf8"), "retained");
  rmSync(failed, { recursive: true });
  assert.equal(readFileSync(join(runner, "spago.yaml"), "utf8"), original);
});

test("workspace profiles preserve dependencies, local FFI and the registry-only Foreign probe", () => {
  const expected = {
    fixture: ["prelude"],
    "ffi-ports": ["aff", "js-promise", "js-promise-aff", "either", "maybe", "parallel", "prelude"],
    "port-suite": ["aff", "js-promise", "js-promise-aff", "foreign", "either", "maybe", "parallel",
      "datetime", "transformers", "control", "bifunctors", "prelude"],
  };
  for (const [profile, dependencies] of Object.entries(expected)) {
    const directory = join(temp, "prepared profiles", profile);
    const config = prepareWorkspace(root, directory, { profile });
    assert.deepEqual(config.dependencies, dependencies);
    assert.equal(config.packageSet, "77.10.1");
    assert.deepEqual(config.extraPackages, Object.fromEntries(Object.entries(localPorts)
      .filter(([name]) => profile !== "fixture" || name === "prelude")
      .map(([name, port]) => [name, resolve(root, "..", port)])));
    const yaml = readFileSync(join(directory, "spago.yaml"), "utf8");
    assert.deepEqual([...yaml.matchAll(/^    - (.+)$/gm)].map(match => match[1]), dependencies);
    for (const path of Object.values(config.extraPackages)) assert.ok(yaml.includes(`path: ${JSON.stringify(path)}\n`));
    assert.match(yaml, /registry: 77\.10\.1/);
  }
  const directory = join(temp, "prepared profiles/ffi-ports");
  const registry = prepareWorkspace(root, directory, { profile: "ffi-ports", registryPackages: ["foreign"] });
  assert.deepEqual(registry.dependencies, expected["ffi-ports"]);
  assert.deepEqual(Object.keys(registry.extraPackages), ["prelude", "aff", "js-promise", "js-promise-aff"]);
  assert.ok(!readFileSync(join(directory, "spago.yaml"), "utf8").includes("    foreign:"));
  assert.equal(readFileSync(join(runner, "spago.yaml"), "utf8"), templateYaml);
  for (const port of Object.values(localPorts)) {
    assert.equal(readFileSync(resolve(root, "..", port, "spago.yaml"), "utf8"), `# original ${port} configuration\n`);
    assert.equal(readFileSync(resolve(root, "..", port, "src/Main.java"), "utf8"), `// original ${port} FFI\n`);
  }
});

test("alternate templates keep their package set, test entrypoint and paths relative to the template", () => {
  const template = join(temp, 'port with spaces and "quotes"/spago.java.yaml');
  const yaml = templateYaml.replace("  name: runner", "  name: example")
    .replace("workspace:\n", "\n  test:\n    main: Test.Main\n    dependencies:\n      - assert\n      - prelude\n\nworkspace:\n")
    .replace("77.10.1", "77.7.0").replace('"../../../javapurs-prelude"', '"../local package with spaces"');
  write(template, yaml);
  mkdirSync(join(temp, "local package with spaces"));
  const directory = join(temp, "alternate workspace");
  const config = prepareWorkspace(root, directory, { template });
  assert.equal(config.name, "example");
  assert.equal(config.packageSet, "77.7.0");
  assert.deepEqual(config.test, { main: "Test.Main", dependencies: ["assert", "prelude"] });
  assert.deepEqual(config.extraPackages, { prelude: join(temp, "local package with spaces") });
  const prepared = readFileSync(join(directory, "spago.yaml"), "utf8");
  assert.match(prepared, /registry: 77\.7\.0/);
  assert.ok(prepared.includes("  test:\n    main: Test.Main\n    dependencies:\n      - assert\n      - prelude\n"));
  assert.ok(prepared.includes(`path: ${JSON.stringify(join(temp, "local package with spaces"))}`));
  assert.equal(readFileSync(template, "utf8"), yaml);
});

test("invalid templates and selections fail before creating or rewriting a workspace", () => {
  const template = join(temp, "invalid template/spago.yaml");
  const destination = join(temp, "invalid workspace");
  const mutations = [
    text => text.replace("  dependencies:\n", "  depends:\n"),
    text => text.replace("    - prelude\n", "    - prelude\n    - prelude\n"),
    text => text.replace("  extraPackages:", "  extraPackages: {}"),
    text => text.replace("    registry: 77.10.1", "    registry: latest"),
    text => text.replace('"../../../javapurs-prelude"', "../unquoted"),
    text => text.replace('"../../../javapurs-prelude"', "null"),
    text => text.replace('"../../../javapurs-prelude"', '""'),
    text => text + '    prelude:\n      path: "../duplicate"\n',
    text => text + '  buildOpts:\n    output: elsewhere\n',
  ];
  for (const mutate of mutations) {
    const yaml = mutate(templateYaml); write(template, yaml);
    assert.throws(() => prepareWorkspace(root, destination, { template }), /Unexpected workspace template/);
    assert.ok(!existsSync(destination));
    assert.equal(readFileSync(template, "utf8"), yaml);
  }
  write(join(destination, "spago.yaml"), "original workspace config\n");
  for (const options of [{ profile: "unknown" }, { profile: "toString" }, { registryPackages: ["typo"] }, { template }]) {
    assert.throws(() => prepareWorkspace(root, destination, options), /Unknown|Unexpected/);
    assert.equal(readFileSync(join(destination, "spago.yaml"), "utf8"), "original workspace config\n");
  }
  const unbuilt = join(temp, "backend not built");
  assert.throws(() => prepareWorkspace(unbuilt, join(unbuilt, "workspace")), /Backend not built/);
  assert.ok(!existsSync(unbuilt));
});

test("missing selected packages and conflicting local paths fail before workspace writes", () => {
  const isolatedRoot = join(temp, "missing packages/compiler");
  write(join(isolatedRoot, "output/Main/index.js"), "// backend\n");
  const template = join(isolatedRoot, "tests/runner/spago.yaml");
  write(template, templateYaml);
  const directory = join(temp, "missing package workspace");
  assert.throws(() => prepareWorkspace(isolatedRoot, directory), /Missing package checkout prelude:/);
  assert.ok(!existsSync(directory));
  for (const port of Object.values(localPorts).filter(name => name !== "javapurs-foreign")) {
    mkdirSync(resolve(isolatedRoot, "..", port), { recursive: true });
  }
  // A regular file is not a checkout either; the error names the selected port.
  write(resolve(isolatedRoot, "../javapurs-foreign"), "not a directory");
  write(join(directory, "spago.yaml"), "keep existing config\n");
  for (const profile of ["ffi-ports", "port-suite"]) {
    assert.throws(() => prepareWorkspace(isolatedRoot, directory, { profile }), /Missing package checkout foreign:.*javapurs-foreign/);
    assert.equal(readFileSync(join(directory, "spago.yaml"), "utf8"), "keep existing config\n");
  }
  prepareWorkspace(isolatedRoot, directory, { profile: "ffi-ports", registryPackages: ["foreign"] });
  const prepared = readFileSync(join(directory, "spago.yaml"), "utf8");
  write(template, templateYaml + '    aff:\n      path: "../another-aff"\n');
  assert.throws(() => prepareWorkspace(isolatedRoot, directory, { profile: "ffi-ports" }), /Conflicting local package aff/);
  assert.equal(readFileSync(join(directory, "spago.yaml"), "utf8"), prepared);
});

test("source templates and symlinked port configurations cannot be overwritten by profiles", () => {
  const alias = join(temp, "runner alias"); symlinkSync(runner, alias);
  for (const directory of [runner, alias]) {
    prepareWorkspace(root, directory);
    assert.throws(() => prepareWorkspace(root, directory, { profile: "ffi-ports" }), /Cannot apply workspace profile to source template/);
    assert.equal(readFileSync(join(runner, "spago.yaml"), "utf8"), templateYaml);
  }
  const directory = join(temp, "linked configuration"); mkdirSync(directory);
  const portConfig = resolve(root, "../javapurs-aff/spago.yaml");
  const destination = join(directory, "spago.yaml"); symlinkSync(portConfig, destination);
  assert.throws(() => prepareWorkspace(root, directory, { profile: "ffi-ports" }), /must not be a symlink/);
  assert.equal(readlinkSync(destination), portConfig);
  assert.equal(readFileSync(portConfig, "utf8"), "# original javapurs-aff configuration\n");
});

test("port options and all 45 historical delegations reject mistakes before side effects; help is read-only", () => {
  assert.deepEqual(parsePortOptions([]).selected, ["aff", "promise", "promise-aff"]);
  assert.deepEqual(parsePortOptions(["--port", "strings", "-c"]).selected, ["strings"]);
  assert.equal(historical.length, 45);
  for (const port of historical) {
    const help = portCli(port, ["--help", "--clean"], { JAVAC: "/missing/javac" });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Usage:.*--port=NAME/);
    assert.equal(readFileSync(trace, "utf8"), "");
    for (const args of [["--clena"], ["-c", "--unknown"], ["--help", "--clena"], ["--port=refs"], ["refs"]]) {
      const result = portCli(port, args);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(readFileSync(trace, "utf8"), "");
      assert.deepEqual(readdirSync(portScratch), []);
    }
  }
  assert.deepEqual(originalPorts(), portOriginals);
  for (const args of [["--port=missing"], ["--port=toString"], ["--port="], ["--port"], ["--port", "--clean"]]) {
    const result = portCli(null, args);
    assert.equal(result.status, 2, result.stderr); assert.equal(readFileSync(trace, "utf8"), "");
  }
  const invalidJava = portCli("refs", ["-c"], { JAVAPURS_JAVA_RELEASE: "16" });
  assert.equal(invalidJava.status, 1); assert.match(invalidJava.stderr, /JAVAPURS_JAVA_RELEASE/);
  assert.equal(readFileSync(trace, "utf8"), ""); assert.deepEqual(readdirSync(portScratch), []);
});

test("all historical templates preserve dependency sets, local paths, entrypoints and resources", () => {
  for (const port of historical) {
    const source = resolve(root, "..", "javapurs-" + port);
    const template = join(source, "spago.java.yaml");
    const yaml = readFileSync(template, "utf8");
    const destination = join(temp, "all templates", port);
    const config = prepareWorkspace(root, destination, { template });
    assert.deepEqual(config.dependencies, [...yaml.matchAll(/^    - (.+)$/gm)].map(match => match[1]));
    assert.deepEqual(config.test.dependencies, [...yaml.matchAll(/^      - (.+)$/gm)].map(match => match[1]));
    assert.equal(config.test.main, "Test.Main"); assert.equal(config.packageSet, "77.7.0");
    assert.deepEqual(Object.values(config.extraPackages), [...yaml.matchAll(/^      path: (.+)$/gm)]
      .map(match => resolve(source, JSON.parse(match[1]))));
    // Round-trip explicit empty dependencies (Prelude/Partial), not YAML null.
    assert.deepEqual(prepareWorkspace(root, join(destination, "round-trip"), { template: join(destination, "spago.yaml") }), config);
    if (portSuites[port].completion === "unsupported") continue;
    preparePortSuite(port, destination, { root });
    assert.equal(readFileSync(join(destination, "test/Support/input.txt"), "utf8"), "test resource\n");
    assert.equal(readFileSync(join(destination, "test/Support/Extra.java"), "utf8"), "// nested test FFI\n");
    assert.deepEqual(tree(join(destination, "src")), tree(join(source, "src")));
    for (const name of ["spago.lock", "output/keep", "output/java/keep", ".spago/keep"]) assert.ok(!existsSync(join(destination, name)));
    if (portSuites[port].assertion === "spec") {
      const ffi = readFileSync(join(destination, "test/PortRunner.java"), "utf8");
      assert.match(ffi, /awaitAff/); assert.ok(!ffi.includes("Promise_Internal"));
    }
  }
  assert.deepEqual(originalPorts(), portOriginals);
});

test("all migrated delegations select their pipeline or explicitly reject unsupported completion", () => {
  for (const port of historical.filter(port => !pilots.includes(port))) {
    const suite = portSuites[port];
    const result = portCli(port, ["-c"], suite.completion === "unsupported" ? { JAVAC: "/missing/javac" } : {});
    if (suite.completion === "unsupported") {
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`${port}: unsupported suite completion protocol: ${suite.reason}`));
      assert.deepEqual(commands(), []); assert.ok(!result.stdout.includes("passed"));
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`${port}: suite and runner checks passed`));
      const events = commands();
      assert.deepEqual(events.slice(0, 5).map(event => event.phase), ["build", "purescript", "generation", "javac", "execution"]);
      assert.deepEqual(events[2].args, ["--main", suite.main]);
      assert.deepEqual(events[3].args, ["--release", "17", ...suite.javacArgs,
        "-d", "output/java/classes", "-sourcepath", "output/java", "output/java/MainRun.java"]);
      assert.deepEqual(events[4].args, [...suite.javaArgs, "-cp", "output/java/classes", "MainRun"]);
      assert.ok(events[4].cwd.startsWith(portScratch + "/javapurs-port-" + port + "-"));
      assert.equal(events.length, suite.assertion === "spec" ? 10 : 5);
      assert.ok(!existsSync(events[4].cwd));
    }
  }
  assert.deepEqual(readdirSync(portScratch), []);
  assert.deepEqual(originalPorts(), portOriginals);
});

test("Spec completion rejects an early exit and an incomplete test inventory", () => {
  for (const extraEnv of [{ MOCK_NO_MARKER: "1" }, { MOCK_INCOMPLETE: "1" }]) {
    const result = portCli("uuid", [], extraEnv);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /suite-completion marker|incomplete assertion inventory/);
    assert.deepEqual(commands().map(event => event.phase), ["purescript", "generation", "javac", "execution"]);
    rmSync(retained(result), { recursive: true });
  }
  assert.deepEqual(originalPorts(), portOriginals);
});

test("pilot pipelines preserve source trees and apply build, target, runtime and stack selections", () => {
  for (const port of pilots) {
    const release = port === "strings" ? "26" : "17";
    const result = portCli(port, port === "refs" ? ["--clean"] : [], {
      JAVAPURS_JAVA_RELEASE: release, JAVAPURS_JAVA_RUNTIME: port === "refs" ? runtime17 : "",
    });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /synchronous Test.Main completed/);
    assert.match(result.stdout, /package set 77\.7\.0, entrypoint Test.Main/);
    const events = commands();
    assert.deepEqual(events.map(event => event.phase), [...(port === "refs" ? ["build"] : []), "purescript", "generation", "javac", "execution"]);
    if (port === "refs") {
      assert.equal(events[0].command, join(root, "bin/build")); assert.equal(events[0].cwd, root);
      assert.equal(events[0].release, "17"); assert.equal(events[0].runtime, runtime17);
    }
    const generation = events.find(event => event.phase === "generation");
    assert.deepEqual(generation.args, ["--main", "Test.Main"]);
    const javac = events.find(event => event.phase === "javac");
    assert.deepEqual(javac.args, ["--release", release, ...(port === "strings" ? ["-J-Xss64m"] : []),
      "-d", "output/java/classes", "-sourcepath", "output/java", "output/java/MainRun.java"]);
    assert.equal(javac.command, join(bin, "javac"));
    const execution = events.find(event => event.phase === "execution");
    assert.equal(execution.command, port === "refs" ? runtime17 : join(bin, "java"));
    assert.deepEqual(execution.args, [port === "strings" ? "-Xss64m" : "-Xss8m", "-cp", "output/java/classes", "MainRun"]);
    assert.ok(execution.cwd.startsWith(portScratch + "/javapurs-port-" + port + "-"));
    assert.ok(events.filter(event => event.phase !== "build").every(event => event.cwd === execution.cwd));
    assert.ok(!existsSync(execution.cwd)); assert.deepEqual(originalPorts(), portOriginals);
  }
});

test("all five port phase failures retain inputs and logs, stop the pipeline and preserve the checkout", () => {
  const phases = ["build", "purescript", "generation", "javac", "execution"];
  for (const [index, phase] of phases.entries()) {
    const result = portCli("refs", ["-c"], { FAIL_PHASE: phase });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`refs: ${phase === "build" ? "backend build" : phase} failed \\(exit 7\\)`));
    assert.deepEqual(commands().map(event => event.phase), phases.slice(0, index + 1));
    const directory = retained(result);
    for (const selected of phases.slice(0, index + 1)) {
      assert.match(readFileSync(join(directory, "logs", selected + ".log"), "utf8"), new RegExp(selected + ": stdout"));
    }
    for (const skipped of phases.slice(index + 1)) assert.ok(!existsSync(join(directory, "logs", skipped + ".log")));
    if (phase !== "build") {
      const source = resolve(root, "../javapurs-refs");
      assert.deepEqual(tree(join(directory, "src")), tree(join(source, "src")));
      assert.deepEqual(tree(join(directory, "test")), tree(join(source, "test")));
      assert.ok(!existsSync(join(directory, "spago.lock")));
      assert.ok(!existsSync(join(directory, ".spago/keep")));
      assert.ok(!existsSync(join(directory, "output/keep")));
      assert.ok(!existsSync(join(directory, "output/java/keep")));
      assert.ok(readFileSync(join(directory, "spago.yaml"), "utf8").includes(JSON.stringify(resolve(root, "../javapurs-prelude"))));
    }
    assert.deepEqual(originalPorts(), portOriginals);
  }
  const missing = portCli("strings", [], { NO_LAUNCHER: "1" });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /generation did not produce MainRun.java/);
  assert.deepEqual(commands().map(event => event.phase), ["purescript", "generation"]);
  assert.ok(existsSync(join(retained(missing), "logs/generation.log")));
});

test("every port pipeline phase is bounded and a timeout retains its workspace", async () => {
  for (const phase of ["purescript", "generation", "javac", "execution"]) {
    const processes = new TestProcesses();
    const tools = resolveJavaTools({ ...env, HANG_PHASE: phase });
    const seen = [];
    let failed;
    writeFileSync(trace, "");
    try {
      await assert.rejects(withTemporaryDirectory("javapurs-tools-port-timeout-", async directory => {
        failed = directory; preparePortSuite("refs", directory, { root });
        await runPortSuite("refs", directory, tools, { run(label, command, args, options) {
          const selected = label.split(": ")[1]; seen.push(selected);
          assert.equal(options.timeout, selected === "execution" ? 45000 : 120000);
          return processes.run(label, command, args, { ...options,
            timeout: selected === phase ? 200 : options.timeout, reportFailure: false });
        } }, { root });
      }), error => error instanceof ProcessFailure && error.timeout === 200 && error.signal === "SIGKILL");
      assert.equal(seen.at(-1), phase);
      assert.match(readFileSync(join(failed, "logs", phase + ".log"), "utf8"), new RegExp(phase + ": stdout"));
      assert.deepEqual(originalPorts(), portOriginals);
    } finally { processes.dispose(); if (failed) rmSync(failed, { recursive: true, force: true }); }
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`port launcher propagates ${signal} to descendants and retains its phase log`, () => {
    const result = portCli("refs", [], { INTERRUPT_PHASE: "purescript", TEST_SIGNAL: signal });
    assert.equal(result.status, new Interrupted(signal).exitCode, result.stderr);
    assert.match(result.stderr, new RegExp(`Interrupted by ${signal}`));
    assert.deepEqual(commands().map(event => event.phase), ["purescript"]);
    assert.match(readFileSync(join(retained(result), "logs/purescript.log"), "utf8"), new RegExp(`leaf:${signal}`));
    assert.deepEqual(originalPorts(), portOriginals);
  });
}

test("process helpers report launch errors, exit status, output and timeout", async () => {
  const processes = new TestProcesses();
  try {
    const log = join(temp, "command.log");
    const output = await processes.run("capture", process.execPath,
      ["-e", "console.log(process.env.VALUE); console.error('stderr')"],
      { log, capture: true, env: { ...process.env, VALUE: "stdout — é" } });
    assert.equal(output, "stdout — é\n");
    assert.match(readFileSync(log, "utf8"), /stderr/);
    await assert.rejects(processes.run("launch", "/missing/executable", [], { log }),
      error => error instanceof ProcessFailure && /launch failed.*ENOENT/.test(error.message));
    await assert.rejects(processes.run("exit", process.execPath, ["-e", "console.error('expected failure'); process.exit(9)"], { log, reportFailure: false }),
      error => error instanceof ProcessFailure && error.code === 9 && error.log === log);
    assert.match(readFileSync(log, "utf8"), /expected failure/);
    await assert.rejects(processes.run("failed parent", process.execPath, ["-e", `
      const { spawn } = require('node:child_process');
      const leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      leaf.once('spawn', () => process.exit(9));`], { log, timeout: 2000 }),
      error => error instanceof ProcessFailure && error.code === 9 && !error.timeout);
    await assert.rejects(processes.run("timeout", process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { log, timeout: 250 }),
      error => error instanceof ProcessFailure && error.timeout === 250 && error.signal === "SIGKILL");
    assert.equal(runCommandSync(process.execPath, ["-e", "process.stdout.write('sync')"], { encoding: "utf8" }), "sync");
    assert.throws(() => runCommandSync(process.execPath, ["-e", "process.exit(8)"], { stdio: "pipe" }),
      error => error instanceof ProcessFailure && error.code === 8);
  } finally { processes.dispose(); }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} propagates to grandchildren and preserves the runner exit code`, { timeout: 10_000 }, async () => {
    const leaf = join(temp, "leaf.cjs");
    script(leaf, `process.on('${signal}', () => { console.log('leaf:${signal}'); process.exit(0); });
      console.log('READY'); setInterval(() => {}, 1000);`);
    const parent = join(temp, "parent.cjs");
    script(parent, `const { spawn } = require('node:child_process');
      process.on('${signal}', () => {});
      const child = spawn(process.execPath, [${JSON.stringify(leaf)}], { stdio: 'inherit' });
      child.on('exit', () => process.exit(0));`);
    const module = new URL("../tools/test-process.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { Interrupted, TestProcesses } from ${JSON.stringify(module)};
      const p = new TestProcesses();
      try { await p.run('signal', process.execPath, [${JSON.stringify(parent)}]); }
      catch (e) { if (!(e instanceof Interrupted)) throw e; process.exitCode = e.exitCode; }
      finally { p.dispose(); }`], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let sent = false;
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!sent && output.includes("READY")) { sent = true; child.kill(signal); }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, new Interrupted(signal).exitCode, output);
    assert.equal(result.signal, null, output);
    assert.match(output, new RegExp(`leaf:${signal}`));
  });
}
