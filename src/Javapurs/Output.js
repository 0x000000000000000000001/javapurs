import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const manifestName = ".javapurs-manifest.json";
const workName = ".javapurs-work";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const validName = name => typeof name === "string" && name.endsWith(".java") &&
  path.basename(name) === name && !/[\\\0]/.test(name);
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const launcherLast = changes => changes.filter(change => change.name !== "MainRun.java")
  .concat(changes.filter(change => change.name === "MainRun.java"));

function parseJson(file, bytes) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch (cause) { throw new Error(`Invalid JSON in ${file}: ${cause.message}`, { cause }); }
}

function fileBytes(file) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!stat.isFile()) throw new Error(`Expected a regular file, preserving ${file}`);
  return fs.readFileSync(file);
}

function readManifest(file) {
  const bytes = fileBytes(file);
  if (bytes === null) return { bytes, files: {} };
  const manifest = parseJson(file, bytes);
  if (!manifest || manifest.version !== 1 || !manifest.files || Array.isArray(manifest.files) ||
      typeof manifest.files !== "object" || !Object.entries(manifest.files).every(([name, digest]) => validName(name) && validHash(digest))) {
    throw new Error(`Invalid Java output manifest: ${file}`);
  }
  return { bytes, files: manifest.files };
}

// Resolve existing ancestors too, so a symlink alias cannot hide overlapping
// input/output directories. This check performs no writes.
function canonical(file) {
  try { return fs.realpathSync(file); }
  catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(canonical(parent), path.basename(file));
  }
}
export const validatePaths = input => output => () => {
  const a = canonical(path.resolve(input)), b = canonical(path.resolve(output));
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
  };
  // Only the reserved java subtree may overlap TAST. Compare physical paths:
  // java -> Main or a nested symlink must not turn a module into an output dir.
  if ((contains(a, b) && !contains(path.join(a, "java"), b)) || contains(b, a)) {
    throw new Error(`TAST input and Java output must not overlap outside <input>/java: ${a} / ${b}`);
  }
};

function atomicWrite(file, bytes, scratch) {
  fs.writeFileSync(scratch, bytes);
  fs.renameSync(scratch, file);
}

function removeWork(session) {
  fs.rmSync(session.work, { recursive: true });
  session.closed = true;
}

function readJournal(session) {
  const bytes = fileBytes(path.join(session.work, "journal.json"));
  if (bytes === null) return null; // No destination file has been modified yet.
  const journal = parseJson(path.join(session.work, "journal.json"), bytes);
  if (!journal || !["publishing", "committed"].includes(journal.state) || !Array.isArray(journal.changes) ||
      !journal.changes.every(change => change && validName(change.name) &&
        (change.before === null || validHash(change.before)) && (change.after === null || validHash(change.after))) ||
      new Set(journal.changes.map(change => change.name)).size !== journal.changes.length ||
      !(journal.manifestBefore === null || validHash(journal.manifestBefore)) || !validHash(journal.manifestAfter)) {
    throw new Error(`Invalid Java output journal: ${session.work}`);
  }
  return journal;
}

function rollback(session, journal) {
  const changes = [...launcherLast(journal.changes), { name: manifestName, before: journal.manifestBefore, after: journal.manifestAfter }];
  // Validate the entire recovery before restoring anything. External edits are
  // never overwritten, even if a process died in the middle of publication.
  for (const change of changes) {
    const file = path.join(session.directory, change.name), current = fileBytes(file);
    if (current !== null && ![change.before, change.after].includes(hash(current))) {
      throw new Error(`Java recovery conflict; preserving edited file ${file}. Journal: ${session.work}`);
    }
    if (change.before !== null) {
      const backup = fileBytes(path.join(session.work, "backup", change.name));
      if (backup === null || hash(backup) !== change.before) throw new Error(`Missing or changed Java recovery backup: ${change.name}`);
    }
  }
  // Recovery follows the same launcher ordering as publication, including when
  // interrupted after the new launcher was written but before the commit marker.
  if (journal.changes.some(change => change.name === "MainRun.java")) {
    fs.rmSync(path.join(session.directory, "MainRun.java"), { force: true });
  }
  for (const change of changes) {
    const file = path.join(session.directory, change.name);
    if (change.before === null) fs.rmSync(file, { force: true });
    else atomicWrite(file, fs.readFileSync(path.join(session.work, "backup", change.name)), path.join(session.work, "restore.tmp"));
  }
}

function recover(directory, work) {
  const ownerFile = path.join(work, "owner.json");
  const owner = parseJson(ownerFile, fileBytes(ownerFile));
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error(`Invalid Java output owner in ${work}`);
  try {
    process.kill(owner.pid, 0);
    throw new Error(`Java output is busy (pid ${owner.pid}): ${work}`);
  } catch (error) { if (error.code !== "ESRCH") throw error; }
  const session = { directory, work };
  const journal = readJournal(session);
  if (journal?.state === "publishing") rollback(session, journal);
  removeWork(session);
  console.error(`[javapurs] Recovered interrupted Java generation in ${directory}`);
}

export const begin = directory => () => {
  directory = path.resolve(directory);
  fs.mkdirSync(directory, { recursive: true });
  const work = path.join(directory, workName);
  if (fs.existsSync(work)) {
    if (!fs.lstatSync(work).isDirectory()) throw new Error(`Invalid Java work directory: ${work}`);
    recover(directory, work);
  }
  // mkdir is the exclusive writer lock. Incomplete owner/journal metadata is
  // diagnosed rather than guessing ownership of an existing directory.
  fs.mkdirSync(work);
  const session = { directory, work, files: new Map(), foreign: new Map(), closed: false };
  try {
    fs.writeFileSync(path.join(work, "owner.json"), json({ pid: process.pid }));
    session.previous = readManifest(path.join(directory, manifestName));
    fs.mkdirSync(path.join(work, "stage"));
    fs.mkdirSync(path.join(work, "backup"));
    return session;
  } catch (error) { removeWork(session); throw error; }
};

export const writeJava = session => name => source => () => {
  if (session.closed || !validName(name)) throw new Error(`Invalid Java output file: ${name}`);
  const digest = hash(source);
  if (session.files.has(name) && session.files.get(name) !== digest) throw new Error(`Conflicting generated Java files: ${name}`);
  fs.writeFileSync(path.join(session.work, "stage", name), source);
  session.files.set(name, digest);
};

export const recordForeign = session => report => () => {
  if (session.closed) throw new Error("Java output is closed");
  session.foreign.set(report.moduleName, report);
};

export const reportWritten = directory => () => {
  console.error(`[javapurs] FFI report: ${path.join(directory, manifestName)} (ffi; binding coverage not checked)`);
};

export const commit = session => () => {
  if (session.closed) throw new Error("Java output is closed");
  const files = Object.fromEntries([...session.files].sort(([a], [b]) => a.localeCompare(b)));
  // The report and Java inventory share one publication/rollback boundary.
  const ffi = { version: 1, modules: [...session.foreign.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)) };
  const manifest = Buffer.from(json({ version: 1, files, ffi }));
  const changes = [];
  const names = new Set([...Object.keys(session.previous.files), ...Object.keys(files)]);
  // MainRun is reserved: a successful library build must not leave an old,
  // unowned launcher in place. Other unrelated files stay outside the inventory.
  if (!session.files.has("MainRun.java") && fs.existsSync(path.join(session.directory, "MainRun.java"))) names.add("MainRun.java");
  for (const name of names) {
    const file = path.join(session.directory, name), bytes = fileBytes(file);
    const before = bytes === null ? null : hash(bytes), after = files[name] ?? null;
    const owned = session.previous.files[name];
    if (before !== null && (owned ? before !== owned : before !== after)) {
      throw new Error(`Java output conflict; preserving ${owned ? "edited generated" : "unowned"} file ${file}`);
    }
    if (before === after && name !== "MainRun.java") continue;
    if (bytes !== null) fs.writeFileSync(path.join(session.work, "backup", name), bytes);
    changes.push({ name, before, after });
  }
  // Detect a concurrently edited manifest as well as edited Java files.
  const oldManifest = fileBytes(path.join(session.directory, manifestName));
  if (!((oldManifest === null && session.previous.bytes === null) ||
      (oldManifest !== null && session.previous.bytes !== null && oldManifest.equals(session.previous.bytes)))) {
    throw new Error(`Java output manifest changed during generation: ${session.directory}`);
  }
  if (oldManifest !== null) fs.writeFileSync(path.join(session.work, "backup", manifestName), oldManifest);
  const journal = { state: "publishing", changes,
    manifestBefore: oldManifest === null ? null : hash(oldManifest), manifestAfter: hash(manifest) };
  atomicWrite(path.join(session.work, "journal.json"), json(journal), path.join(session.work, "journal.tmp"));
  // Remove the old launcher first and publish the new one last. The manifest is
  // the commit record; a leftover journal makes interruption explicit/recoverable.
  const launcher = changes.find(change => change.name === "MainRun.java");
  if (launcher && launcher.before !== null) fs.rmSync(path.join(session.directory, "MainRun.java"));
  for (const change of launcherLast(changes)) {
    const file = path.join(session.directory, change.name);
    if (change.after === null) fs.rmSync(file, { force: true });
    else fs.renameSync(path.join(session.work, "stage", change.name), file);
  }
  atomicWrite(path.join(session.directory, manifestName), manifest, path.join(session.work, "manifest.tmp"));
  journal.state = "committed";
  atomicWrite(path.join(session.work, "journal.json"), json(journal), path.join(session.work, "journal.tmp"));
};

export const close = session => () => {
  if (session.closed) return;
  const journal = readJournal(session);
  if (journal?.state === "publishing") rollback(session, journal);
  removeWork(session);
};
