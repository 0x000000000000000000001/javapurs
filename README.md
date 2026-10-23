# javapurs

An optimizing **PureScript-to-Java compiler**, written in PureScript. Node.js
runs the compiler; the generated application runs on the JVM.

Javapurs consumes the enriched **TAST / `tcorefn`** from our
[PureScript fork](https://github.com/0x000000000000000000001/purescript),
optimizes it through the [Java branch of PBO](https://github.com/0x000000000000000000001/purescript-backend-optimizer/tree/edge-javapurs),
and emits Java source. The compiler and Java library ports are experimental.

For contributors: [start here](docs/start-here.md), then use the
[code map](docs/code-map.md) and [test matrix](docs/testing.md#matrice-des-tests).
The [FFI port matrix](docs/port-ffi.md) describes library coverage and limits.

## Features

- Type-guided ADT classes, immutable typed records and generic fallbacks.
- Tail-call loops, integer loops, direct local calls and specialized `Int -> Int` functions.
- Scope-aware extraction of large expressions into bounded Java helpers.
- Java FFI snippets, effects, references, Aff and Promise ports.
- Manifest-based publication and recovery of generated Java sources.

The [compiler guide](docs/compiler.md) explains the pipeline;
[representations](docs/representations.md) and [specialized passes](docs/specialized-passes.md)
define the conditions and fallbacks of each optimization.

## Benchmarks

Use the [documented Java baselines in altbak.pub](https://github.com/0x000000000000000000001/altbak.pub#java)
and their methodology when evaluating performance. Those WIP results measure
sequential workloads; they do not establish Aff support or multicore scaling.

## Getting started

### Prerequisites

- **Node.js**, **Bash** and **Spago 1.0.3**. The source recipe was exercised with
  Node 24.8.0; the backend pins registry package set 77.10.1 and [spago.lock](spago.lock).
- A complete **JDK 17+**, including `javac`, `java` and `jar`.
- The **TAST-capable PureScript fork**. An upstream `purs` with the same version
  number does not provide the required metadata.
- **Git** and **Stack** for a source installation. The pinned fork uses
  lts-23.18 / GHC 9.8.4; see the [native prerequisites](docs/installation.md#références-et-prérequis).

### Build the backend

The installer fetches the exact revisions in [tools/source-lock.json](tools/source-lock.json),
builds the fork and backend, and runs Hello/Refs as standalone JARs:

```sh
git clone https://github.com/0x000000000000000000001/javapurs.git javapurs-source
cd javapurs-source
export JAVAPURS_WORKSPACE="$(dirname "$PWD")/javapurs-workspace"
node tools/install-source.mjs "$JAVAPURS_WORKSPACE"
export PATH="$JAVAPURS_WORKSPACE/bin:$PATH"
javapurs --help
```

The destination must be new. Logs and partial work remain on failure; replay into
another new directory. Keep `installation.json`, which records revisions, source
hashes and the actual tools. See the [installation and delivery contract](docs/installation.md).

In an existing checkout, provide the local packages from [spago.yaml](spago.yaml)
and put the fork's binary directory first on `PATH`, then run:

```sh
command -v purs
./bin/build
export PATH="$PWD/bin:$PATH"
```

`bin/build` locates its checkout, prints the selected tools and compiles a probe
requiring `dataDecls`, `classDecls` and `typeTable` before Spago.
**`purs --version` alone cannot verify TAST capability.** `bin/javapurs` loads
`output/Main/index.js`; rebuild after changing the backend or PBO.
The launcher defaults to a 16,384 MiB Node heap, configurable with `JAVAPURS_HEAP`.

### Compile and run an application

The checked-in [Hello example](examples/hello/spago.yaml) uses the following files.
Create an application directory with this `spago.yaml`:

```yaml
package:
  name: hello-java
  dependencies:
    - prelude
    - effect
workspace:
  packageSet:
    registry: 77.10.1
  backend:
    cmd: javapurs
```

Create `src/Main.purs`:

```purescript
module Main where

import Prelude (Unit)
import Effect (Effect)

foreign import logLine :: String -> Effect Unit

main :: Effect Unit
main = logLine "Hello from javapurs"
```

Supply the foreign binding in `src/Main.java`:

```java
public static final Object logLine =
    (java.util.function.Function<Object, Object>) message ->
    (java.util.function.Supplier<Object>) () -> {
        System.out.println((String) message);
        return null;
    };
```

From the application root, with the built backend, fork and JDK on `PATH`:

```sh
spago build
javac --release 17 -d output/java/classes -sourcepath output/java output/java/MainRun.java
java -cp output/java/classes MainRun
```

It prints `Hello from javapurs`. Spago supplies enriched `output/<Module>/corefn.json`;
the backend writes Java under `<input>/java`, or the explicit `--java-output`.
Modules become `__M$App_Main.java` for `App.Main`; the executable launcher is
`MainRun.java`. Quote literal filenames containing `$` in shell commands.

To regenerate Java from existing TAST, run `javapurs --main Main`. Keep compiled
classes in a separate directory and recreate that directory after module removals
or renames. For an application without external JAR dependencies:

```sh
jar --create --file app.jar --main-class MainRun -C output/java/classes .
java -jar app.jar
```

The runtime delivery is **`app.jar` and a compatible JVM**. For Java libraries,
add their JARs to both compilation and execution classpaths, for example
`javac --release 17 -cp "lib/*" …` and
`java -cp "output/java/classes:lib/*" MainRun` on macOS/Linux.
Dependency management and packaging belong to the application.

The [Refs example](examples/refs/spago.yaml) selects Java ports for its executed
foreign imports, including transitive dependencies. Its paths describe the
installer's `workspace/apps/refs` layout. Larger applications must likewise
select every required implementation through `workspace.extraPackages`; see the
[runner workspace](tests/runner/spago.yaml) and [FFI contracts](docs/ffi-runtime.md).

### Compiler options

Supply arguments directly to `javapurs`, or in Spago's
`workspace.backend.args`, for example `["--main", "App.Main"]`.

| Option | Description |
| --- | --- |
| `--help` | Print usage and exit without reading TAST or writing files. |
| `--input <DIR>` | Read enriched CoreFn/TAST from this directory; defaults to `output`. |
| `--output <DIR>` | Alias of `--input`, matching the argument Spago appends for its own output option. |
| `--java-output <DIR>` | Override the Java destination; defaults to `<input>/java` (`output/java`). |
| `--main <Module>` | Select a module defining and exporting a local `main`; defaults to `Main`. `MainRun` forces a `Supplier` or applies a `Function` to `null`. All loaded modules are generated. |
| `--no-main` | Generate a library without `MainRun.java`. An empty input directory is accepted in this mode. |
| `--records=maps` | Compare Map records with the default typed representation on the same TAST. |
| `--loop-invariants=off` | Disable caching of eligible pure, closed `Int` computations within loops. |
| `--direct-calls=off` | Disable private static methods for known, fully applied local-module functions. Public curried functions remain available in both modes. |
| `--int-functions=off` | Disable the specialized `Int -> Int` closure/call representation. |
| `--ownership=off` | Disable consuming workers selected by the ownership analysis. |
| `--no-chunk` | Disable extraction into `__chunk$N` helpers; useful for focused comparisons of the same input. |


Value options accept `--name VALUE` or `--name=VALUE`. Paths are relative to the
caller. Repeated options, conflicting aliases, unknown arguments and missing
values fail with exit code **2**; compilation/I/O failures return **1**; success
and help return **0**. Each option may occur once; `--main` and `--no-main` are
mutually exclusive. The selected `main` must be local and exported.

Spago 1.0.3 appends its TAST destination as `--output`; `--java-output` overrides
the Java destination. Existing `java_output/` files are not migrated automatically.
Use a fresh destination, or select the old layout explicitly with
`--java-output java_output`. The [compiler guide](docs/compiler.md#1-entrée-et-configuration)
details input, entrypoint and path validation; the
[specialized-pass guide](docs/specialized-passes.md) describes optimization switches.

### Generated-file ownership and recovery

`.javapurs-manifest.json` records generated Java names, hashes and the selected
FFI. Successful generations update that inventory and remove obsolete owned
sources. Edited generated files and collisions are reported; unrelated files
are preserved. `.javapurs-work/` holds staging, locking and recovery metadata.
Consume output only after a successful compiler exit. Follow the
[output lifecycle contract](docs/compiler.md#cycle-de-vie-des-sorties-java)
before intervening in an interrupted publication.

## Foreign function interface

Place Java members in a `.java` file beside the corresponding `.purs` source,
as in `Main.java` above. The fragment is inserted into the generated module class:
use static bindings, fully qualified Java names, and no enclosing class, package
or import declarations. Private helpers may contain ordinary Java implementation.

Curried arguments use `Function<Object, Object>`; an `Effect a` returns a `Supplier`
so effects run when forced. Access records through `Map<String, Object>` and copy
before mutation; typed records are immutable. Arrays use `Object[]`, and generic
calls use boxed primitives. The [runtime guide](docs/ffi-runtime.md) defines name
escaping, calling conventions, async values, resolution order and transitive ports.

A missing or empty Java fragment produces binding-specific stubs that throw when
called. A provided fragment is inserted verbatim; successful compilation does not
prove that all foreign paths are implemented.

### Inspect the selected FFI

The manifest's `ffi.modules` identifies selected fragments, origins, hashes and
bindings; `status` distinguishes `provided`, `empty`, `missing` and `not-required`.
`verification: "not-checked"` records that supplying a fragment is not proof of
executed coverage. To list missing or empty fragments:

```sh
node -e 'const {ffi} = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(JSON.stringify(ffi.modules.filter(m => m.status === "missing" || m.status === "empty"), null, 2))' output/java/.javapurs-manifest.json
```

If a binding resolves to a registry package without Java, select its Java port
through `extraPackages` and rebuild the TAST and Java. The
[report contract](docs/ffi-runtime.md#relevé-de-la-génération) describes each field.
After a failed generation, the manifest still describes the last successful one.

## Development and testing

Follow [Démarrer et valider](docs/start-here.md) to select the fork and tools.
After compiler-source changes, rebuild, then choose suites by responsibility:

```sh
./bin/build
node test/typed-records.mjs
node tools/check-all.mjs --quick
```

`--quick` checks docs, port configurations, FFI inventory and generated outputs;
**it rebuilds the backend** to verify output stability. `--full` includes those
checks and adds test-tools, child-process, Spec and Node FS. Logs go to
`logs/check-all/`. These profiles do not cover every compiler suite or port.

The [test matrix](docs/testing.md#matrice-des-tests) covers all 30 scripts,
including their prerequisites and optional benchmark inputs. For a named
PureScript fixture, use `./bin/test NAME`; inspect selections with `--list`.
The 48 port launchers use the common isolated runner. Failed temporary workspaces
are retained and their paths printed; see the [runner recipes](docs/testing.md).

For documentation alone, `node tools/check-docs.mjs` uses Node and Bash without
building. [Maintenance](docs/maintenance.md) describes tracked/generated files;
[validation history](docs/validation-history.md) preserves dated campaigns.

### Java target and runtime

[tools/java-tools.mjs](tools/java-tools.mjs) resolves the JDK for test runners:

| Setting | Meaning |
| --- | --- |
| `JAVA_HOME` or `JAVAC`/`JAVA` | Build JDK; explicit executables take priority. `JAVA` remains the build JDK's sibling runtime. |
| `JAVAPURS_JAVA_RELEASE` | Decimal target version, **17 by default**, minimum accepted target 17. Passed as `javac --release N`. |
| `JAVAPURS_JAVA_RUNTIME` | Optional executable used to run the classes; defaults to the build JDK's `java`. |


Explicit `JAVAC`/`JAVA` take priority, then `JAVA_HOME`, then `javac` on `PATH`
with a Homebrew fallback. The build pair must belong to the same real JDK bin
directory. `node tools/java-tools.mjs` prints selected paths, versions and target.
A system launcher such as macOS `/usr/bin/javac` may require selecting an installed
JDK explicitly. Raw `javac` commands need their own `--release` and classpath.
See [Java configuration and cross-JDK checks](docs/testing.md#build-jdk-cible-et-jvm)
for the replayable matrix and its measured limits.

## Architecture

`Main` → `Config` → `Driver` loads and validates TAST, then invokes PBO.
For each optimized module, `Pipeline` runs `CodeGen` → `Rename` → `Chunk`.
`Printer` renders the Java AST; `Emit` assembles modules and runtime templates;
`Output` publishes them through a recoverable file transaction.

The [code map](docs/code-map.md) assigns each responsibility to its module.
The [compiler](docs/compiler.md), [AST](docs/ast.md), [chunking](docs/chunking.md)
and [printing](docs/printing.md) guides define the detailed contracts.

## Current status and limitations

Library coverage is package-specific: consult the [FFI matrix](docs/port-ffi.md).
Aff uses platform daemon threads with cooperative cancellation; Promise reactions
are eager rather than queued as JavaScript microtasks. Virtual-thread scheduling,
Valhalla value types, broader platform coverage and distribution modes remain
future work. The [runtime contracts](docs/ffi-runtime.md) and
[maintenance guide](docs/maintenance.md#points-ouverts-après-le-plan) describe these limits.

## License

MIT, as declared by this project. A standalone license file has not yet been added.
