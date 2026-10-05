import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { withTemporaryDirectory } from "./test-workspace.mjs";

export const sourceLock = JSON.parse(readFileSync(new URL("./source-lock.json", import.meta.url), "utf8"));
export const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");

export function requireExecutable(name, env = process.env) {
  const paths = isAbsolute(name) || name.includes("/") ? [resolve(name)]
    : (env.PATH || "").split(delimiter).filter(Boolean).map(directory => resolve(directory, name));
  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return realpathSync(path);
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(`Required executable not found: ${name}. Check PATH; see README.md#prerequisites.`);
}

export function inspectTool(name, env = process.env) {
  const path = requireExecutable(name, env);
  const version = execFileSync(path, ["--version"], { env, encoding: "utf8", timeout: 15_000 }).trim();
  return { path, version };
}

export function requireLocalPackages(root) {
  for (const path of ["../../purescript-backend-optimizer-javapurs", "../javapurs-foreign-object"]) {
    const config = resolve(root, path, "spago.yaml");
    if (!statSync(config, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing local package: ${config}. Use tools/install-source.mjs or restore the README workspace layout.`);
    }
  }
}

// A version number alone cannot distinguish upstream purs from the TAST fork.
// This source has data, class and expression types, without registry dependencies.
export async function probeCompiler(purs, processes, env = process.env) {
  return withTemporaryDirectory("javapurs-tast-probe-", async directory => {
    writeFileSync(join(directory, "Probe.purs"), `module Probe where
data Probe = Probe Int
class HasInt a where
  getInt :: a -> Int
identity :: Int -> Int
identity value = value
`);
    await processes.run("TAST capability", purs, ["compile", "Probe.purs", "--codegen", "corefn"],
      { cwd: directory, env, log: join(directory, "purs.log"), timeout: 60_000 });
    const path = join(directory, "output/Probe/corefn.json");
    const json = JSON.parse(readFileSync(path, "utf8"));
    const counts = Object.fromEntries(["dataDecls", "classDecls", "typeTable"].map(key => {
      if (!Array.isArray(json[key]) || json[key].length === 0) {
        throw new Error(`Incompatible TAST from ${purs}: ${path} needs a nonempty ${key} array. Select the pinned PureScript fork on PATH and rebuild in a fresh output directory.`);
      }
      return [key, json[key].length];
    }));
    return { builtWith: json.builtWith, ...counts, sha256: sha256(path) };
  });
}
