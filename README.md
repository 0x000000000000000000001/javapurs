# javapurs

<img height="160" alt="Screenshot 2026-09-17 at 16 44 38" src="https://github.com/user-attachments/assets/e2e22be7-47a1-4130-9f3f-a77bdde43964" />

_Experimental WIP. The compiler and Java library ports are under active development._

An optimizing **PureScript-to-Java compiler**, written in PureScript, bringing pure business logic to the **JVM**, its JIT compiler, garbage collector, and Java ecosystem.

`javapurs` consumes the enriched **TAST / `tcorefn`** representation produced by our [PureScript compiler fork](https://github.com/0x000000000000000000001/purescript), optimizes it through `purescript-backend-optimizer`, and emits Java source. Node.js runs the compiler; the generated application runs on the JVM.

For maintainers: [handoff and repository maintenance](docs/maintenance.md) · [compiler guide](docs/compiler.md) · [types and calling conventions](docs/representations.md) · [FFI and runtime contracts](docs/ffi-runtime.md) · [expression translation](docs/expressions.md) · [specialized passes](docs/specialized-passes.md) · [Java rendering](docs/printing.md) · [Java AST and scope contracts](docs/ast.md) · [focused testing and validation records](docs/testing.md).

## Features

- **Optimization before Java generation.** The compiler is written in PureScript, with JavaScript FFI and launchers. It uses the [Java branch of our TAST-aware optimizer fork](https://github.com/0x000000000000000000001/purescript-backend-optimizer/tree/edge-javapurs), based on [Arista's optimizer](https://github.com/aristanetworks/purescript-backend-optimizer), for inlining, constant folding, and other shared transformations.
- **Type-guided representations.** Enriched `output/<Module>/corefn.json` files retain expression types and declaration metadata (`dataDecls`, `classDecls`). The backend emits nested classes for ADTs, shares eligible nullary constructors, and uses immutable, Map-compatible classes for eligible closed records. Generic values and unsupported record shapes retain `Object` or Map representations.
- **Specialized integer functions.** Eligible `Int -> Int` functions implement `IntUnaryOperator` through the generated `__IntFn` interface, which also supports the generic curried `Function<Object, Object>` interface.
- **Calls and loops.** Java-specific passes implement tail-call loops, primitive integer loop variables, counted loops, lazy caches for eligible loop invariants, and direct static calls for eligible fully applied functions in the same module.
- **Bounded expression trees.** Lexical renaming precedes extraction into static helper methods. The chunker accounts for both expression size and nested scopes, and passes captured locals with their Java types.
- **Java effects and Aff.** The library ports provide effect thunks, synchronized reference operations, and an Aff runtime with trampolined binds, platform-thread fibers, cancellation checks, supervision and parallel combinators.
- **Java interoperability.** Foreign imports are implemented by Java snippets inserted into generated classes. Compile the resulting sources with `javac` and supply any application JAR dependencies through the classpath.

Java library FFI coverage remains package-specific. Aff uses ordinary daemon threads with cooperative cancellation. Promise supports pending settlement and adoption, with eager reactions rather than a JavaScript microtask queue. The [runtime and FFI contracts](docs/ffi-runtime.md) describe callback lifetimes, synchronization and process completion. Virtual-thread scheduling and Valhalla value types remain future work.

## Benchmarks

The [Java results in altbak.pub](https://github.com/0x000000000000000000001/altbak.pub#java) compare compiled PureScript with native Java written in a functional style and with hand-optimized Java FFI. They cover fourteen core workloads, including recursion, records, arrays, polymorphism, and closures.

Use those documented baselines and their methodology when evaluating changes. The Java results are marked WIP and measure sequential computation; they do not establish `Aff` support or multicore scaling. Performance depends on the workload, JVM configuration, and warmup, so the benchmark repository is the source of measurements rather than a fixed speedup claim here.

## Getting started

### Prerequisites

- A **TAST-capable `purs`** from the compiler fork on `PATH`, kept compatible with the optimizer checkout. An upstream binary with the same version number does not provide the same enriched format.
- **Spago** with YAML configuration support. The compiler pins registry package set `77.10.1` in [spago.yaml](spago.yaml).
- **Node.js** to run the compiler and its ES module launcher. The local tool inventory on 1 October 2026 reports Node.js `24.8.0`, Spago `1.0.3`, and a development build of the TAST fork reporting PureScript `0.15.16`. Exact binary and checkout references are recorded in [testing.md](docs/testing.md#outils-et-versions-java).
- A **JDK** with both `javac` and `java` available. The local compiler/runtime is OpenJDK `26.0.2`; b8x and the chunk fixtures target Java 17 through `javac --release 17`. Build JDK, bytecode target and execution JVM are separate choices. The examples below use that bytecode target; the project has no exhaustive minimum-JDK compatibility matrix. Select the same JDK for compilation and execution.
- Git and Bash for the checkout and launcher commands below.

### Build the backend

The current repository has no `package.json`, npm installation hook, or bundled release artifact. Build the checkout with Spago. Its two local package paths require this layout:

```text
workspace/
├── purescript-backend-optimizer-javapurs/
└── javapurs/
    ├── javapurs/                 # this repository
    ├── javapurs-foreign-object/
    ├── javapurs-prelude/         # application library ports, as needed
    └── ...
```

For a fresh workspace, after installing the prerequisites:

```bash
mkdir javapurs-workspace
cd javapurs-workspace
git clone --branch edge-javapurs https://github.com/0x000000000000000000001/purescript-backend-optimizer.git purescript-backend-optimizer-javapurs
mkdir javapurs
cd javapurs
git clone https://github.com/0x000000000000000000001/javapurs.git
git clone https://github.com/0x000000000000000000001/javapurs-foreign-object.git
cd javapurs
./bin/build
export PATH="$PWD/bin:$PATH"
```

`bin/build` runs `spago build`. The launcher `bin/javapurs` runs `bin/javapurs.js`, which imports `output/Main/index.js`; rebuild after changing compiler sources or the optimizer dependency. The launcher defaults to a 16,384 MiB Node heap, configurable through `JAVAPURS_HEAP`. This is separate from the heap of `javac` or the generated application. The `PATH` command above applies to the current shell. Keep the compiler and optimizer revisions together when reproducing a build.

### Compile and run an application

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

From the application root, with the built backend and the TAST compiler on `PATH`:

```bash
mkdir -p classes
spago build
javac --release 17 -d classes -sourcepath java_output java_output/MainRun.java
java -cp classes MainRun
```

The example prints `Hello from javapurs` using its own Java console binding. It uses registry packages for PureScript definitions; their unused foreign declarations may remain stubs. For a larger application, provide `.java` implementations for the foreign values it executes, including transitive dependencies. The sibling `javapurs-console`, `javapurs-effect` and `javapurs-aff` repositories now contain Java implementations. JavaScript FFI can coexist with Java FFI to support PureScript compilation and the JS target. Select the required ports through `workspace.extraPackages`; the [runner workspace](tests/runner/spago.yaml) gives a concrete core-package example.

The backend creates `java_output` and its parent directories. Spago invokes it after producing enriched `output/<Module>/corefn.json`. Verify that a generated file includes `dataDecls`, `classDecls`, and, with the current fork, `typeTable`. Missing metadata indicates an incompatible compiler or stale output; select the fork explicitly on `PATH` and rebuild in a fresh output directory.

Each compilation reports monotonic elapsed times in milliseconds to stderr: TAST loading and sorting, preparation, optimization and staged emission, Java publication, and the backend total. The total includes these phases; it excludes the preceding `purs` compilation and subsequent `javac` compilation. A failed phase and its enclosing total are marked `(failed)` before the error is propagated. TAST loading, FFI reading and Java writing failures include their operation and path; module emission errors also name the module.

Generated classes use the default Java package and the reserved prefix `__M$`, with module dots replaced by underscores: `App.Main` becomes `__M$App_Main.java`. The PureScript module `Main` becomes `__M$Main.java`; `MainRun.java` is the executable launcher. Record helpers named `__Record$…`, `__IntFn.java`, and `TcoLoop.java` are emitted alongside modules. Use single quotes for literal file names containing `$` in shell commands. A manifest tracks generated Java and removes obsolete owned sources on subsequent successful generations. Use a fresh class directory after module removals or renames: `.class` files belong to the `javac` build.

To regenerate Java from existing TAST without recompiling PureScript, invoke the backend directly:

```bash
mkdir -p classes
javapurs --main Main
javac --release 17 -d classes -sourcepath java_output java_output/MainRun.java
java -cp classes MainRun
```

For an application with no external JAR dependencies, package the compiled classes with:

```bash
jar --create --file app.jar --main-class MainRun -C classes .
java -jar app.jar
```

Java libraries used by your FFI must be added to both classpaths. For example, with application JARs under `lib/` on macOS/Linux:

```bash
javac --release 17 -cp "lib/*" -d classes -sourcepath java_output java_output/MainRun.java
java -cp "classes:lib/*" MainRun
```

Dependency management and JAR packaging are application responsibilities.

### Compiler options

Arguments can be supplied directly to `javapurs`, or through Spago's backend configuration:

```yaml
workspace:
  backend:
    cmd: javapurs
    args: ["--main", "App.Main"]
```

Merge this fragment with the rest of your workspace configuration.

| Option | Description |
| --- | --- |
| `--help` | Print usage and exit without reading TAST or writing files. |
| `--input <DIR>` | Read enriched CoreFn/TAST from this directory; defaults to `output`. |
| `--output <DIR>` | Alias of `--input`, matching the argument Spago appends for its own output option. |
| `--java-output <DIR>` | Create and manage Java sources in this directory; defaults to `java_output`. |
| `--main <Module>` | Select a module defining and exporting a local `main`; defaults to `Main`. `MainRun` forces a `Supplier` or applies a `Function` to `null`. All loaded modules are generated. |
| `--no-main` | Generate a library without `MainRun.java`. An empty input directory is accepted in this mode. |
| `--records=maps` | Compare Map records with the default typed representation on the same TAST. |
| `--loop-invariants=off` | Disable caching of eligible pure, closed `Int` computations within loops. |
| `--direct-calls=off` | Disable private static methods for known, fully applied local-module functions. Public curried functions remain available in both modes. |
| `--int-functions=off` | Disable the specialized `Int -> Int` closure/call representation. |
| `--ownership=off` | Disable consuming workers selected by the ownership analysis. |
| `--no-chunk` | Disable extraction into `__chunk$N` helpers; useful for focused comparisons of the same input. |

Options taking a value accept `--name VALUE` or `--name=VALUE`. Paths are relative to the caller; quote paths containing spaces. Each option may appear once, including the `--input`/`--output` alias pair. `--main` and `--no-main` are mutually exclusive. Unknown arguments, missing/empty values, repeated options and conflicts fail before compilation with exit code **2**. Success and help return **0**; compilation and I/O failures return **1**. These rules live in [Config](src/Javapurs/Config.purs).

Spago **1.0.3** passes `backend.args`, then appends `--output` with an absolute TAST path when its output option is set. It supplies no `build` positional argument. Configure the Java destination with `backend.args: ["--java-output", "Java sources"]`; let Spago provide its TAST path. Input and Java directories must be disjoint, including through symlink aliases.

```bash
javapurs --help
javapurs --input "TAST cache" --java-output "Java sources" --main App.Main
javapurs --input "TAST cache" --java-output "Java library" --no-main
```

The selected entrypoint is checked before output preparation: the module must exist and its `main` must be local and exported. A re-export alone does not qualify. Library mode removes the previous owned launcher; with empty input it emits only `__IntFn.java` and the manifest.

Loop invariant caches belong to each fully applied function invocation. They evaluate at the first original use, so skipped branches and zero-iteration loops keep their evaluation behavior. The analysis checks known definitions and closures recursively, rejects unknown FFI/effects and local captures, and only caches successful `Int` results.

Direct calls use private static methods for eligible functions in the same module. Consecutive nonempty lambdas qualify at arities 2–32 for eager bindings and 1–32 for lazy bindings. Public curried functions remain available. Calls between eager declarations use earlier workers directly. Calls to lazy declarations, or from lazy bindings that can be entered early through a getter, retain an initialization guard. Saturated self calls through their own getter use a separate direct path. Proven `Int` worker parameters are primitive and receive explicit unboxing casts at call sites; other parameters use `Object`. See [DirectCalls](src/Javapurs/DirectCalls.purs) for the admission rules.

Ownership workers consume eligible fresh trees after proving that retained subtrees do not alias and that later reads remain valid. Reads are snapshotted before writes; shared leaves are never reusable cells. The [specialized-pass guide](docs/specialized-passes.md) maps candidate selection, usage proofs, cells, worker emission and fallbacks, together with the contracts of direct calls, loops, invariants and constructor reuse.

### Generated-file ownership and recovery

`.javapurs-manifest.json` records the names and SHA-256 hashes of generated Java. Subsequent successful generations replace these files and remove owned modules/helpers that are no longer emitted. Files outside this inventory are preserved. A collision with a foreign file, or an edited generated file, fails with the affected path rather than overwriting it.

All sources are first staged under `.javapurs-work`. Publication backs up changed files, removes the old launcher first, publishes the new launcher last, then writes the manifest and commit marker. An ordinary publication error restores the previous generation. If the process is killed, the next generation recovers an uncommitted publication or keeps a committed one. The work directory contains the owner PID and recovery journal; a live owner rejects another writer. Invalid recovery metadata or a recovery conflict preserves the work directory for diagnosis. Consume the Java output after a successful compiler exit; publication is journaled file by file.

For an older directory without a manifest, files identical to newly generated Java are adopted. Other old files remain outside the inventory; an unowned `MainRun.java` also prevents library mode from silently retaining a stale launcher. To migrate differing historical output, select a fresh `--java-output` directory or archive the identified old generated files before regenerating. See the [output lifecycle contract](docs/compiler.md#cycle-de-vie-des-sorties-java) for recovery details.

## Foreign function interface

Place a `.java` file beside the corresponding `.purs` source. The resolver first checks that adjacent file, then searches local and Spago package source locations. For example, `src/Example.purs`:

```purescript
module Example where

import Prelude (Unit)
import Effect (Effect)

foreign import add :: Int -> Int -> Int
foreign import logLine :: String -> Effect Unit
```

The matching `src/Example.java` contains **members of the generated `__M$Example` class**, with no enclosing class, package declaration, or import statements:

```java
public static final Object add =
    (java.util.function.Function<Object, Object>) x ->
    (java.util.function.Function<Object, Object>) y ->
        (int) x + (int) y;

public static final Object logLine =
    (java.util.function.Function<Object, Object>) message ->
    (java.util.function.Supplier<Object>) () -> {
        System.out.println((String) message);
        return null;
    };
```

Export a static value with the foreign import's generated Java name. Functions use one `Function<Object, Object>` per curried argument; an `Effect a` returns a `Supplier` so effects run only when forced. Use fully qualified Java class names in snippets. Private helper methods can hold ordinary Java implementation code behind these bindings.

Names are escaped by [Naming](src/Javapurs/Naming.purs), including Java keywords. An `Effect (Promise a)` returns a thunk whose result uses the Promise port's `PromiseValue`; Aff values use the Aff port's `AffRun`. The [runtime guide](docs/ffi-runtime.md) maps calling conventions, state ownership and error conversion to their implementations. Select transitive Java ports as well, including `javapurs-foreign` for Promise/Aff rejection conversion.

Access PureScript records through `java.util.Map<String, Object>` and copy them before mutation. Generated typed record classes are immutable; other record paths use Maps. Do not assume every record is a `LinkedHashMap`. Generic arrays use `Object[]`; primitive values cross the generic function interface as their Java boxed equivalents. A plain `Function<Object, Object>` remains valid when the compiler specializes an `Int -> Int` call.

When no `.java` file is found, or the selected file is empty, the backend emits missing-FFI stubs that throw when called. A selected nonempty file is inserted verbatim; the compiler does not validate every foreign binding or adapt ordinary Java method signatures. Failure to read a selected file stops compilation with its path in the diagnostic. A successful Java compilation therefore does not prove that all application FFI paths are implemented.

## Development and testing

Use the same checkout layout as the source build instructions and select tests by the responsibility being changed:

- **`./bin/test`** compiles and runs the PureScript passing tests (`purescript/tests/purs/passing`) through the Java backend, like the other backend checkouts do.
- **`test/*.mjs`** are the backend's own regression suites, run after `./bin/build`. The Node-only `test/test-tools.mjs` checks the runners with simulated commands and requires no backend build or JDK.
- **Each port's `bin/test`** selects its suite. Aff, Promise and Promise/Aff use isolated workspaces and await all assertions and cleanup, with explicit failure/timeout checks. For Aff/Ref/Promise protocols, the four ports also provide **`bin/test-runtime`**; see the [runtime recipe](docs/testing.md#runtimes-ffi-et-interopérabilité).

```bash
# Inspect an explicit selection before running it:
./bin/test BigFunction DerivingTraversable --list

# Run the selected regression:
./bin/test DerivingTraversable
```

Each selected test replaces `tests/runner/src`, `output`, `java_output` and `classes`, then builds with Spago, generates Java, compiles with `javac` and executes `MainRun`. Backend-local overrides and FFI are described in the [testing guide](docs/testing.md). An invalid explicit name, option or range boundary fails before building or cleaning. `--list` only resolves the selection, including when combined with `-c`. An executing `-c` run also rebuilds the backend and cleans caches. Phase logs remain in `logs/tests/<Name>/`.

After a compiler-source change, rebuild the backend, select a JDK, then run the focused regression:

```bash
./bin/build
export JAVAC="$(command -v javac)"
export JAVA="$(command -v java)"

node test/typed-records.mjs
```

The shared JDK resolver uses explicit `JAVAC`/`JAVA` first, then `JAVA_HOME`, then `javac` on `PATH`, with a Homebrew fallback. If only one executable is supplied, its sibling is selected; mixed JDK bin directories are rejected. Most scripts import the compiler's built `output/` modules and generate Java fixtures under `TMPDIR` (or the OS temporary directory). Successful temporary workspaces are removed; failed ones are retained and their path is printed. `test/int-loops.mjs` has a Node-only analysis path.

`node test/big-function.mjs` prepares BigFunction in its own temporary Spago workspace, executes the corpus entrypoint and performs 155 branch checks. It can run independently of the last test in `tests/runner`. It caps the fixture's `javac` heap at 4 GiB and the branch-check JVM at 512 MiB.

`node test/driver.mjs` builds a small, isolated TAST application and exercises the real compiler CLI, two actual Spago invocations, entrypoint selection, output lifecycle, FFI and I/O diagnostics, then compiles and runs its Java with `--release 17`. It requires the built backend, Spago, the TAST-capable `purs` and a JDK. Its recording/comparison modes preserve identical inputs for refactoring checks; see the [driver recipe](docs/testing.md#pilote-de-compilation). `node --test test/output-files.mjs` checks filesystem ownership, rollback and recovery after `SIGKILL` using Node alone.

`node test/ast-scopes.mjs` checks local shadowing, sibling branches, recursive captures, method selectors, nested loop targets and the raw-Java boundary. It compiles and executes the same fixtures after renaming, with and without chunking, targeting Java 17.

`node test/ffi-runtimes.mjs` compiles the actual Ref/Promise/Aff Java fragments and runs 36 deterministic protocol checks; it needs Node, a JDK and the sibling ports. `node test/ffi-ports.mjs` additionally uses Spago, the TAST frontend and the built backend for 17 PureScript integration assertions per record mode, including the real Promise/Aff bridge. Both target Java 17.

`node test/port-runners.mjs --port=aff` runs the Aff suite through the same isolated runner as its `bin/test`; `--port=promise` and `--port=promise-aff` select the other two suites. The runner requires a completion marker and the expected check count, and probes delayed assertions, rejections, timeouts and premature process exit. See the [port-suite recipe](docs/testing.md#suites-asynchrones-des-ports).

The [test matrix](docs/testing.md#matrice-des-tests) covers all 25 scripts and identifies optional benchmark-cache inputs. The [specialized-pass recipe](docs/testing.md#passes-spécialisées) includes ownership admission and deep-recursion checks in both modes. See the [BigFunction recipe](docs/testing.md#chunker-et-bigfunction) and [runner checks](docs/testing.md#outillage-des-tests) for focused commands. Compare performance changes against the [altbak.pub Java baselines](https://github.com/0x000000000000000000001/altbak.pub#java), separately from semantic regressions.

`node tools/check-docs.mjs` checks local documentation links/anchors, shell-example syntax, the suite inventory, CLI options and plan progress using Node and Bash. The [maintenance guide](docs/maintenance.md#statut-des-fichiers-et-des-sorties) records which artifacts are active, generated or historical, including Git recovery instructions for the retired `.bak` snapshots.

The maintainability plan v1 is complete: **11/11 milestones, 100/100 points**, with its history in the [M11 validation record](docs/testing.md#validation-m11). The [active plan v2](../todo.md) tracks five follow-up milestones (M12–M16): reliable asynchronous test runners, CLI/output handling, FFI diagnostics, reproducible source setup and measured JDK compatibility.

## Architecture

1. **Configuration and orchestration:** [Main](src/Main.purs) passes process arguments through [Config](src/Javapurs/Config.purs) to [Driver](src/Javapurs/Driver.purs). The driver loads enriched `corefn.json` modules and directives, prepares shared helpers, then calls PBO's `buildModules` to obtain optimized `BackendModule` values.
2. **FFI resolution and Java lowering:** Each module callback reads the Java snippet through [Ffi](src/Javapurs/Ffi.purs) and calls [Pipeline](src/Javapurs/Pipeline.purs). Its [CodeGen](src/Javapurs/CodeGen.purs) step prepares ownership workers, analyzes TCO and types, translates expressions and emits constructor classes into [JavaAst](src/Javapurs/JavaAst.purs), then applies direct calls and constructor reuse.
3. **Lexical names and chunking:** `Pipeline` runs [Rename](src/Javapurs/Rename.purs) before [Chunk](src/Javapurs/Chunk.purs). [Chunk.Captures](src/Javapurs/Chunk/Captures.purs) analyzes dependencies and movement barriers; [Chunk.Extraction](src/Javapurs/Chunk/Extraction.purs) owns costs and the extraction decision. `Chunk` tracks effective Java local types and constructs helpers.
4. **Printing and templates:** [Printer](src/Javapurs/Printer.purs) and [RecordPrinter](src/Javapurs/RecordPrinter.purs) render Java declarations, control flow, and record helpers. [Runtime](src/Javapurs/Runtime.purs) owns the `__IntFn`, `TcoLoop` and `MainRun` templates.
5. **Assembly and output:** [Emit](src/Javapurs/Emit.purs) assembles modules with the members supplied by `Ffi`, stages module/record classes and the selected launcher, and stages shared runtime files once during preparation. [Output](src/Javapurs/Output.purs) owns the generated-file inventory, publication, rollback and recovery. [Diagnostics](src/Javapurs/Diagnostics.purs) adds context to propagated I/O errors. `javac` and `java` perform the final compilation and execution outside the backend.

The [compiler guide](docs/compiler.md) details the pass order, source modules, representation contracts and workspace boundaries. The [AST guide](docs/ast.md) defines valid node positions, shared traversals, lexical scopes and raw-Java admission. The [chunker guide](docs/chunking.md) explains extraction decisions, the separate cost/parameter limits, recursive captures and evaluation-once array groups. [ControlFlow](src/Javapurs/ControlFlow.purs) owns the continuation analyses shared by translation and printing.

## Current status and limitations

- [x] PureScript implementation integrated with the TAST-aware optimizer fork.
- [x] Java module generation and configurable executable launcher.
- [x] ADT classes and nullary constructor singletons.
- [x] Typed closed records with a Map-compatible fallback.
- [x] Tail-call, integer-loop, counted-loop, and loop-invariant transformations.
- [x] Direct local calls and specialized integer functions with curried interoperability.
- [x] Java FFI snippets and focused compiler regression suites.
- [x] Scope-aware chunking, with BigFunction and captured-local regression checks.
- [x] Java Aff runtime using platform threads, with reference and Promise ports.
- [x] Core Java benchmark results published in altbak.pub.
- [ ] Complete Java FFI coverage across the library ports.
- [ ] Virtual-thread integration and broader asynchronous interoperability.
- [ ] Turnkey installation, setup automation, and broader compatibility validation.

These checked items describe implemented facilities and available suites, not a claim that every official PureScript test passes. The project remains experimental, and library support must be checked for each application.

## License

MIT, as declared by this project. A standalone license file has not yet been added to this repository.
