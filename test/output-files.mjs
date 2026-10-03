import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import * as Output from "../src/Javapurs/Output.js";

// Real filesystem transactions, including partial publication and process death.
// No compiler build, frontend or JDK is needed for these ownership guarantees.
const root = fs.mkdtempSync(join(tmpdir(), "javapurs-output-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let next = 0;
const fresh = () => join(root, String(next++), "Java output");
const manifest = ".javapurs-manifest.json", work = ".javapurs-work";
function publish(directory, files) {
  const session = Output.begin(directory)();
  try {
    for (const [name, source] of Object.entries(files)) Output.writeJava(session)(name)(source)();
    Output.commit(session)();
  } finally { Output.close(session)(); }
}
function snapshot(directory) {
  return Object.fromEntries(fs.readdirSync(directory).filter(name => name !== work).sort()
    .map(name => [name, fs.readFileSync(join(directory, name), "utf8")]));
}
function seed(directory) {
  publish(directory, { "MainRun.java": "main A", "__M$A.java": "old A", "__Record$Old.java": "old record" });
  fs.writeFileSync(join(directory, "User.java"), "foreign Java");
  return snapshot(directory);
}
const changed = { "__M$A.java": "new A", "__M$B.java": "new B", "MainRun.java": "main B" };

test("staging preserves the last generation; publication prunes only owned files", () => {
  const directory = fresh(), before = seed(directory);
  const session = Output.begin(directory)();
  Output.writeJava(session)("__M$B.java")("B")();
  assert.deepEqual(snapshot(directory), before);
  assert.throws(() => Output.begin(directory)(), /busy/);
  Output.commit(session)(); Output.close(session)(); Output.close(session)();
  assert.deepEqual(Object.keys(snapshot(directory)), [manifest, "User.java", "__M$B.java"]);
  assert.equal(fs.readFileSync(join(directory, "User.java"), "utf8"), "foreign Java");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(join(directory, manifest))).files), ["__M$B.java"]);
  assert.ok(!fs.existsSync(join(directory, work)));
});

test("foreign collisions, edited generated files, directories and symlinks are preserved", () => {
  for (const kind of ["foreign", "edited", "directory", "symlink", "old-launcher"]) {
    const directory = fresh(); fs.mkdirSync(directory, { recursive: true });
    const file = join(directory, kind === "old-launcher" ? "MainRun.java" : "__M$A.java");
    if (kind === "edited") publish(directory, { "__M$A.java": "original" });
    if (kind === "directory") fs.mkdirSync(file);
    else if (kind === "symlink") { fs.writeFileSync(join(directory, "untouched.txt"), "keep"); fs.symlinkSync("untouched.txt", file); }
    else fs.writeFileSync(file, "keep");
    const session = Output.begin(directory)();
    Output.writeJava(session)("__M$A.java")("new")();
    try { assert.throws(() => Output.commit(session)(), /preserving/); }
    finally { Output.close(session)(); }
    if (kind === "directory") assert.ok(fs.statSync(file).isDirectory());
    else assert.equal(fs.readFileSync(file, "utf8"), "keep");
  }
});

test("legacy byte-identical Java is adopted; a staging error leaves the old inventory intact", () => {
  const directory = fresh(); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(join(directory, "__M$A.java"), "same");
  publish(directory, { "__M$A.java": "same" });
  const before = snapshot(directory), session = Output.begin(directory)();
  Output.writeJava(session)("__M$A.java")("new")();
  assert.throws(() => Output.writeJava(session)("../escape.java")("bad")(), /Invalid Java output/);
  assert.throws(() => Output.writeJava(session)("__M$A.java")("different")(), /Conflicting generated/);
  fs.mkdirSync(join(directory, work, "stage", "blocked.java"));
  assert.throws(() => Output.writeJava(session)("blocked.java")("bad")(), /EISDIR/);
  Output.close(session)();
  assert.deepEqual(snapshot(directory), before);
});

test("every publication rename failure rolls back Java, stale-file removal and manifest", () => {
  for (let failAt = 1; failAt <= 6; failAt++) {
    const directory = fresh(), before = seed(directory), session = Output.begin(directory)();
    for (const [name, source] of Object.entries(changed)) Output.writeJava(session)(name)(source)();
    const rename = fs.renameSync; let calls = 0, failed = false;
    fs.renameSync = (...args) => {
      if (++calls === failAt) { failed = true; throw new Error("injected publication I/O failure"); }
      if (args[1] === join(directory, "MainRun.java")) {
        // A visible launcher must always refer to its generation's modules,
        // both during publication and restoration after an I/O failure.
        assert.equal(fs.readFileSync(join(directory, "__M$A.java"), "utf8"), failed ? "old A" : "new A");
      }
      return rename(...args);
    };
    try {
      assert.throws(() => Output.commit(session)(), /injected publication/);
      Output.close(session)();
    } finally { fs.renameSync = rename; }
    assert.ok(failed, `publication failure ${failAt} reached`);
    assert.deepEqual(snapshot(directory), before);
    assert.ok(!fs.existsSync(join(directory, work)));
  }
});

test("an unchanged launcher is still hidden until all modules have been published", () => {
  const directory = fresh(); seed(directory);
  const rename = fs.renameSync; let observed = false;
  fs.renameSync = (from, to) => {
    if (to === join(directory, "__M$A.java")) {
      observed = true;
      assert.ok(!fs.existsSync(join(directory, "MainRun.java")));
    }
    return rename(from, to);
  };
  try { publish(directory, { ...changed, "MainRun.java": "main A" }); }
  finally { fs.renameSync = rename; }
  assert.ok(observed);
  assert.equal(fs.readFileSync(join(directory, "MainRun.java"), "utf8"), "main A");
});

function crash(directory, point) {
  const module = new URL("../src/Javapurs/Output.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import * as Output from ${JSON.stringify(module)};
    const directory = ${JSON.stringify(directory)};
    const session = Output.begin(directory)();
    for (const [name, source] of Object.entries(${JSON.stringify(changed)})) Output.writeJava(session)(name)(source)();
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      const point = ${JSON.stringify(point)};
      if ((point === 'module' && to === directory + '/__M$A.java') ||
          (point === 'manifest' && to === directory + '/${manifest}') ||
          (point === 'committed' && to.endsWith('/journal.json') && JSON.parse(fs.readFileSync(to)).state === 'committed')) {
        process.kill(process.pid, 'SIGKILL');
      }
    };
    Output.commit(session)();
    throw new Error('crash point not reached');
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.ok(fs.existsSync(join(directory, work, "journal.json")));
}

test("SIGKILL during publication restores the prior generation; committed recovery keeps the new one", () => {
  for (const point of ["module", "manifest", "committed"]) {
    const directory = fresh(), before = seed(directory);
    crash(directory, point);
    if (point === "module") assert.ok(!fs.existsSync(join(directory, "MainRun.java")));
    const session = Output.begin(directory)();
    try {
      if (point === "committed") {
        assert.equal(fs.readFileSync(join(directory, "__M$A.java"), "utf8"), "new A");
        assert.equal(fs.readFileSync(join(directory, "MainRun.java"), "utf8"), "main B");
        assert.ok(!fs.existsSync(join(directory, "__Record$Old.java")));
      } else assert.deepEqual(snapshot(directory), before);
    } finally { Output.close(session)(); }
  }
});

test("recovery preserves external edits and its journal for diagnosis", () => {
  const directory = fresh(); seed(directory); crash(directory, "module");
  fs.writeFileSync(join(directory, "__M$A.java"), "external edit");
  const before = snapshot(directory);
  assert.throws(() => Output.begin(directory)(), /recovery conflict/);
  assert.deepEqual(snapshot(directory), before);
  assert.ok(fs.existsSync(join(directory, work, "journal.json")));
});

test("invalid ownership metadata cannot name paths outside the Java directory", () => {
  const directory = fresh(); fs.mkdirSync(directory, { recursive: true });
  const outside = join(directory, "..", "keep.java"); fs.writeFileSync(outside, "keep");
  fs.writeFileSync(join(directory, manifest), JSON.stringify({ version: 1, files: { "../keep.java": "0".repeat(64) } }));
  assert.throws(() => Output.begin(directory)(), /Invalid Java output manifest/);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");
  assert.ok(!fs.existsSync(join(directory, work)));
  for (const value of ["null", "{", JSON.stringify({ version: 2, files: {} })]) {
    fs.writeFileSync(join(directory, manifest), value);
    assert.throws(() => Output.begin(directory)(), /Invalid .*manifest/);
    assert.equal(fs.readFileSync(join(directory, manifest), "utf8"), value);
  }
  fs.rmSync(join(directory, manifest));
  fs.mkdirSync(join(directory, work));
  fs.writeFileSync(join(directory, work, "owner.json"), "null");
  assert.throws(() => Output.begin(directory)(), /Invalid Java output owner/);
  fs.rmSync(join(directory, work), { recursive: true });
  seed(directory); crash(directory, "module");
  const journalFile = join(directory, work, "journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile)); journal.changes = [null];
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  const before = snapshot(directory);
  assert.throws(() => Output.begin(directory)(), /Invalid Java output journal/);
  assert.deepEqual(snapshot(directory), before);
});

test("input/output overlap is rejected through missing children and symlink aliases", () => {
  const directory = fresh(); fs.mkdirSync(directory, { recursive: true });
  const alias = join(directory, "..", "alias"); fs.symlinkSync(directory, alias);
  for (const [input, output] of [[directory, directory], [directory, join(alias, "new")],
    [join(directory, "new"), alias], ["/", directory]]) {
    assert.throws(() => Output.validatePaths(input)(output)(), /must not overlap/);
  }
  Output.validatePaths(join(directory, "input"))(join(directory, "java"))();
  assert.deepEqual(fs.readdirSync(directory), []);
});
