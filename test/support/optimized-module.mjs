import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Left } from "../../output/Data.Either/index.js";
import { Nothing } from "../../output/Data.Maybe/index.js";
import { empty } from "../../output/Data.Set/index.js";
import { runAff } from "../../output/Effect.Aff/index.js";
import { monadEffectEffect } from "../../output/Effect.Class/index.js";
import { readModules } from "../../output/Javapurs.Input/index.js";
import { loadDirectives } from "../../output/PureScript.Backend.Optimizer.App/index.js";
import { buildModules } from "../../output/PureScript.Backend.Optimizer.Builder/index.js";
import { beginPurmetaBuild, readPurmetaSync } from "../../output/PureScript.Backend.Optimizer.Cache/index.js";
import { coreForeignSemantics } from "../../output/PureScript.Backend.Optimizer.Semantics.Foreign/index.js";
import { withTemporaryDirectory } from "../../tools/test-workspace.mjs";

const run = aff => new Promise((resolve, reject) => {
  runAff(result => () => result instanceof Left ? reject(result.value0) : resolve(result.value0))(aff)();
});

// Purmeta is scratch storage for one build, not a cross-process fixture format.
// Rebuild only this module's TAST import closure, using the production loader
// and optimizer. All scratch writes belong to the isolated workspace.
export async function loadOptimizedImplementations(project, moduleName) {
  const input = resolve(project, "run/bak/java/output");
  return withTemporaryDirectory("javapurs-optimized-module-", async directory => {
    const output = join(directory, "output");
    const copied = new Set();
    function copyModule(name) {
      if (name === "Prim" || name.startsWith("Prim.") || copied.has(name)) return;
      const source = join(input, name, "corefn.json");
      const json = JSON.parse(readFileSync(source, "utf8"));
      assert.ok(Array.isArray(json.imports), `${source}: expected imports array`);
      assert.deepEqual(json.moduleName, name.split("."), `${source}: module name mismatch`);
      copied.add(name);
      mkdirSync(join(output, name), { recursive: true });
      copyFileSync(source, join(output, name, "corefn.json"));
      for (const imported of json.imports) {
        assert.ok(Array.isArray(imported.moduleName), `${source}: expected imported module name`);
        copyModule(imported.moduleName.join("."));
      }
    }
    copyModule(moduleName);
    const modules = await run(readModules(output));
    const directives = await run(loadDirectives);
    const previousDirectory = process.cwd();
    try {
      // The synchronous build and lookup share one directory and publication scope.
      process.chdir(directory);
      buildModules(monadEffectEffect)({
        directives, rewriteLimit: 10000, analyzeCustom: () => () => Nothing.value,
        foreignSemantics: coreForeignSemantics, traceIdents: empty,
        onPrepareModule: () => source => () => source,
        onSkipModule: () => () => () => Nothing.value,
        onCodegenModule: () => () => () => () => () => {},
      })(modules)();
      return readPurmetaSync(moduleName)();
    } finally {
      beginPurmetaBuild();
      process.chdir(previousDirectory);
    }
  });
}
