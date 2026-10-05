import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const defaultJavaRelease = 17;

function executable(name, env) {
  const candidates = isAbsolute(name) || name.includes("/")
    ? [resolve(name)]
    : (env.PATH || "").split(delimiter).map(directory => resolve(directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      return realpathSync(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

function version(command, env) {
  let text;
  try { text = execFileSync(command, ["--version"], { env, encoding: "utf8", timeout: 10_000 }).trim(); }
  catch (cause) { throw new Error(`Cannot inspect Java tool ${command}: ${cause.message}`, { cause }); }
  const match = text.match(/^(?:javac|openjdk|java) (?:version ")?(?:1\.)?(\d+)(?=[.\s"+-]|$)/);
  if (!match) throw new Error(`Unrecognized Java version from ${command}: ${text}`);
  return { major: Number(match[1]), text };
}

// Resolve one build installation, including when only one executable is overridden.
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
  const buildJava = java;
  if (env.JAVAPURS_JAVA_RUNTIME) {
    java = executable(env.JAVAPURS_JAVA_RUNTIME, env);
    if (!java) throw new Error(`JAVAPURS_JAVA_RUNTIME is not executable: ${env.JAVAPURS_JAVA_RUNTIME}`);
  }
  const selected = env.JAVAPURS_JAVA_RELEASE ?? String(defaultJavaRelease);
  const release = Number(selected);
  if (!/^[1-9][0-9]*$/.test(selected) || !Number.isSafeInteger(release) || release < defaultJavaRelease) {
    throw new Error(`JAVAPURS_JAVA_RELEASE must be an integer >= ${defaultJavaRelease}; found ${JSON.stringify(selected)}`);
  }
  const versions = { javac: version(javac, env), java: version(java, env) };
  if (release > versions.javac.major) {
    throw new Error(`Java release ${release} requires javac >= ${release}; found ${versions.javac.text} at ${javac}`);
  }
  if (release > versions.java.major) {
    throw new Error(`Java release ${release} requires a runtime >= ${release}; found ${versions.java.text.split("\n")[0]} at ${java}`);
  }
  // JAVA/JAVAC remain the build pair for nested resolution. Only the explicit
  // runtime override may cross JDKs; Node runners execute the returned java path.
  return { javac, java, buildJava, release, versions, javacArgs: ["--release", String(release)],
    env: { ...env, JAVAC: javac, JAVA: buildJava, JAVAPURS_JAVA_RELEASE: String(release), JAVAPURS_JAVA_RUNTIME: java,
      PATH: dirname(javac) + delimiter + (env.PATH || "") } };
}

export function javaCompileArgs(tools, extra = []) {
  if (extra.some(arg => /^(--release|--source|--target|-source|-target)(=|$)|^--enable-preview$/.test(arg))) {
    throw new Error("Configure the Java target with JAVAPURS_JAVA_RELEASE; javacArgs must not override release/source/target or enable preview.");
  }
  return [...tools.javacArgs, ...extra];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: node tools/java-tools.mjs (prints selected build JDK, release and runtime)");
    const { env, ...inventory } = resolveJavaTools();
    console.log(JSON.stringify(inventory, null, 2));
  } catch (error) { console.error(`[java-tools] ${error.message}`); process.exitCode = 1; }
}
