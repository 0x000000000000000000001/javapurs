import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Describe the resolver's actual selection, without performing a second search
// or inferring that a supplied Java fragment covers its foreign declarations.
function location(file) {
  const absolute = path.resolve(file);
  const relative = path.relative(process.cwd(), absolute);
  const inside = relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  const first = relative.split(path.sep)[0];
  const origin = !inside ? "external" : [".spago", "spago.d"].includes(first) ? "spago" : "workspace";
  let realPath = null;
  try { realPath = fs.realpathSync(absolute); }
  catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error; }
  return { path: absolute, realPath, origin };
}

export const describeImpl = moduleName => modulePath => bindings => status => selected => source => () => {
  const moduleSource = location(modulePath);
  const adjacentJava = path.resolve(modulePath.replace(/\.purs$/, ".java"));
  const selectedJava = selected === null ? null : location(selected);
  const resolution = selectedJava === null ? "not-found" : selectedJava.path === adjacentJava ? "adjacent" : "search";
  const fragmentSha256 = source === null ? null : createHash("sha256").update(source, "utf8").digest("hex");
  const report = { moduleName, moduleSource, adjacentJava, selectedJava, fragmentSha256,
    resolution, status, bindings, verification: "not-checked" };
  if (bindings.length || selectedJava !== null) {
    const selection = selectedJava === null ? `expected adjacent ${JSON.stringify(adjacentJava)}`
      : `${JSON.stringify(selectedJava.path)} (${resolution}, ${selectedJava.origin})`;
    console.error(`[javapurs] FFI ${moduleName}: ${status}; source ${JSON.stringify(moduleSource.path)} (${moduleSource.origin}); Java ${selection}; bindings ${bindings.map(binding => binding.name).join(", ") || "none"}; coverage not checked`);
  }
  return report;
};
