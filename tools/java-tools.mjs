import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

function executable(name, env) {
  const candidates = isAbsolute(name) || name.includes("/")
    ? [resolve(name)]
    : (env.PATH || "").split(delimiter).map(directory => resolve(directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

// Resolve one installation, including when only one executable is overridden.
// Real paths keep Homebrew's symlinked binaries paired with their own JDK.
export function resolveJavaTools(env = process.env) {
  let javac;
  let java;
  if (env.JAVAC || env.JAVA) {
    javac = env.JAVAC ? executable(env.JAVAC, env) : null;
    java = env.JAVA ? executable(env.JAVA, env) : null;
    if (env.JAVAC && !javac) throw new Error(`JAVAC is not executable: ${env.JAVAC}`);
    if (env.JAVA && !java) throw new Error(`JAVA is not executable: ${env.JAVA}`);
    javac ??= executable(join(dirname(java), "javac"), env);
    java ??= executable(join(dirname(javac), "java"), env);
  } else if (env.JAVA_HOME) {
    javac = executable(join(env.JAVA_HOME, "bin/javac"), env);
    java = executable(join(env.JAVA_HOME, "bin/java"), env);
  } else {
    javac = executable("javac", env) || executable("/opt/homebrew/opt/openjdk/bin/javac", env);
    java = javac && executable(join(dirname(javac), "java"), env);
  }
  if (!javac || !java) throw new Error("A complete JDK is required. Set JAVA_HOME or JAVAC/JAVA to its executables.");
  if (dirname(javac) !== dirname(java)) {
    throw new Error(`JAVAC and JAVA must belong to the same JDK bin directory:\n  ${javac}\n  ${java}`);
  }
  // Also support the individual port scripts which call the tools on PATH.
  return { javac, java, env: { ...env, JAVAC: javac, JAVA: java, PATH: dirname(javac) + delimiter + (env.PATH || "") } };
}
