# javapurs

<br />
<br />

_Experimental WIP. The compiler and Java library ports are under active development._

An optimizing **PureScript-to-Java compiler**, written in PureScript, bringing pure business logic to the **JVM**, its JIT compiler, garbage collector, and Java ecosystem.

`javapurs` consumes the enriched **TAST / `tcorefn`** representation produced by a custom PureScript compiler, optimizes it through `purescript-backend-optimizer`, and emits Java source. Node.js runs the compiler; the generated application runs on the JVM.

## Why Java?

Java is a useful target for backend services, CLIs, and applications that already depend on JVM libraries. `javapurs` aims to combine PureScript's algebraic data types, type classes, and pure functions with that ecosystem, while keeping generated code available for inspection and compilation with ordinary Java tools.

The project follows earlier efforts to bring PureScript to JVM targets, including pure11. Its approach builds on a PureScript optimizer and a compiler fork that retains the type information needed to improve Java representations progressively.

## Benchmarks

The [Java results in altbak.pub](https://github.com/0x000000000000000000001/altbak.pub#java) compare compiled PureScript with native Java written in a functional style and with hand-optimized Java FFI. They cover fourteen core workloads, including recursion, records, arrays, polymorphism, and closures.

Use those documented baselines and their methodology when evaluating changes. The Java results are marked WIP and measure sequential computation; they do not establish `Aff` support or multicore scaling. Performance depends on the workload, JVM configuration, and warmup, so the benchmark repository is the source of measurements rather than a fixed speedup claim here.

## Why a new Java backend?

The `javapurs` project is built upon the lessons learned from earlier efforts to bring PureScript to JVM targets (including `pure11`). The ecosystem has evolved drastically, unlocking new architectural paradigms that make building a completely new Java backend highly relevant today:

### 1. The optimizer & bootstrapping
While previous native compilers were often written in Haskell and parsed raw `CoreFn`, `javapurs` is written 100% in PureScript. It uses a [TAST-aware optimizer fork](https://github.com/0x000000000000000000001/purescript-backend-optimizer), based on [Arista's purescript-backend-optimizer](https://github.com/aristanetworks/purescript-backend-optimizer). This allows the compiler to instantly benefit from classical optimizations such as aggressive uncurrying, constant folding, dead code elimination, and Tail Call Optimization (TCO) at the AST level before Java generation. The compiler itself is built to JavaScript with Spago and executed by Node.js, ensuring it remains fully accessible.

### 2. Native memory layout for Java
For `javapurs`, the runtime relies on increasingly native Java representations to reduce boxing and closures. ADT constructors become nested Java classes with final fields. Closed records become immutable classes with final fields (including primitive `int` fields), while maintaining `Map<String, Object>` interoperability. While not yet using Valhalla value types, this incremental route heavily reduces GC pressure compared to naive dynamic `Map` representations.

### 3. TAST: Breaking the performance ceiling
To reach high JVM speeds, `javapurs` consumes an enriched `tcorefn.json` (Typed CoreFn). This custom format preserves the deep structural typing information and the exact memory layout of ADTs (`dataDecls`) and type-classes (`classDecls`) that standard `corefn` strips away. This allows the compiler to generate idiomatic, strictly typed Java code where possible (like specialized `Int -> Int` functions implementing `IntUnaryOperator`) instead of falling back to curried `Function<Object, Object>` everywhere.

### 4. Direct calls and loop optimizations
Tail-call analysis and Java-specific passes handle recursive loops, primitive integer loop variables, counted loops, and caching of eligible loop invariants. Known, fully applied functions in the same module can use private static methods while retaining their public curried interface, completely bypassing closure allocations for hot paths.

### 5. Up-to-date with modern PureScript & Java
`javapurs` targets modern Java (Java 21+) and aims to be fully aligned with the current v0.15+ PureScript ecosystem. It is designed to eventually take full advantage of upcoming JVM features like Project Valhalla for flat memory layouts.

### 6. Native Parallelism behind Aff
`Aff` on Java virtual threads (Project Loom) remains an active development goal. The JVM's virtual threads provide a perfect match for PureScript's asynchronous `Aff` monad, promising true multi-core scaling for cooperative concurrency without the overhead of traditional OS threads.

## How to use

### Prerequisites

- A **TAST-capable `purs`** from the compiler fork on `PATH`, kept compatible with the optimizer checkout. An upstream binary with the same version number does not provide the same enriched format.
- **Spago** with YAML configuration support. The compiler pins registry package set `77.10.1` in [spago.yaml](spago.yaml).
- **Node.js** to run the compiler and its ES module launcher. The local development tools used when reviewing these instructions were Node.js `24.8.0`, Spago `1.0.3`, and a fork reporting PureScript `0.15.15`; these are version references, not a freshly tested compatibility matrix.
- A **JDK** with both `javac` and `java` available. Java 21+ is the project target. Set the same JDK for compilation and execution.
- Git and Bash for the checkout and launcher commands below.

### Build the backend from source

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
git clone https://github.com/0x000000000000000000001/purescript-backend-optimizer.git purescript-backend-optimizer-javapurs
mkdir javapurs
cd javapurs
git clone https://github.com/0x000000000000000000001/javapurs.git
git clone https://github.com/0x000000000000000000001/javapurs-foreign-object.git
cd javapurs
./bin/build
export PATH="$PWD/bin:$PATH"
```

`bin/build` runs `spago build`. The launcher `bin/javapurs` runs `bin/javapurs.js`, which imports `output/Main/index.js`; rebuild after changing compiler sources. The `PATH` command above applies to the current shell. Keep the compiler and optimizer revisions together when reproducing a build.

### Configure an application

Keep the registry as the base package set, then add the Java library overrides required by your application's dependency graph. For example, an application at `workspace/my-app` can start with:

```yaml
package:
  name: my-app
  dependencies:
    - prelude
    - effect
    - console

workspace:
  packageSet:
    registry: 77.10.1
  extraPackages:
    prelude:
      path: "../javapurs/javapurs-prelude"
    effect:
      path: "../javapurs/javapurs-effect"
    console:
      path: "../javapurs/javapurs-console"
  backend:
    cmd: javapurs
```

Clone the referenced library repositories under `workspace/javapurs` before using those paths. This is an override example, not a complete Java package set: audit direct and transitive foreign imports for `.java` implementations. In particular, the current `javapurs-console` and `javapurs-effect` checkouts retain JavaScript FFI; required Java bindings must be supplied for the application to use those foreign values. Pure PureScript modules can be shared across targets.

### Generate, compile, and run

From the application root, with `Main.main :: Effect Unit` as the entrypoint:

```bash
mkdir -p java_output
spago build
javac -d java_output java_output/*.java
java -cp java_output MainRun
```

Create `java_output` before the backend runs: the current CLI writes into it without creating it. Spago produces enriched `output/<Module>/corefn.json` using the fork, then invokes the configured backend. Generated classes use the default Java package, with dots in PureScript module names replaced by underscores: `App.Main` becomes `App_Main.java`.

`MainRun.java` is the executable launcher, generated when the selected module is present. `Main.java` represents the PureScript module and is not the JVM entrypoint. The compiler also writes record helper classes, `__IntFn.java`, and `TcoLoop.java`.

You can also omit `workspace.backend` and invoke the backend explicitly after Spago has produced CoreFn:

```bash
spago build
mkdir -p java_output
javapurs --main App.Main
javac -d java_output java_output/*.java
java -cp java_output MainRun
```

For an application with no external JAR dependencies, package the compiled classes with:

```bash
jar --create --file app.jar --main-class MainRun -C java_output .
java -jar app.jar
```

Java libraries used by your FFI must be added to the compile and runtime classpaths. Dependency management and JAR packaging are currently application responsibilities.

### Compiler configuration options

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
| `--main <Module>` | Select the entrypoint module; defaults to `Main`. The launcher calls its `main` as an effect thunk. |
| `--records=maps` | Compare Map records with the default typed representation on the same TAST. |
| `--loop-invariants=off` | Disable caching of eligible pure, closed `Int` computations within loops. |
| `--direct-calls=off` | Disable private static methods for known, fully applied local-module functions. Public curried functions remain available in both modes. |
| `--int-functions=off` | Disable the specialized `Int -> Int` closure/call representation. |

The input directory is fixed to `output`, and Java output to `java_output`, both relative to the application working directory. There is no configurable output path or dedicated `--help` handler; unknown arguments are currently ignored.

Loop invariant caches belong to each fully applied function invocation. They evaluate at the first original use, so skipped branches and zero-iteration loops keep their evaluation behavior. The analysis checks known definitions and closures recursively, rejects unknown FFI/effects and local captures, and only caches successful `Int` results.

Direct calls use private static methods for non-recursive functions in the same module. Only consecutive lambdas with no computation between arguments qualify; partial applications and unknown callbacks keep the public curried interface. Calls can use only earlier declarations, preserving initialization order. Method parameters remain `Object`, so casts in the original body still happen after argument evaluation. This transformation handles arities from two through 32.

## Writing Java FFI

Place a `.java` file beside the corresponding `.purs` source. The resolver first checks that adjacent file, then searches local and Spago package source locations. For example, `src/Example.purs`:

```purescript
module Example where

import Effect (Effect)

foreign import add :: Int -> Int -> Int
foreign import logLine :: String -> Effect Unit
```

The matching `src/Example.java` contains **members of the generated `Example` class**, with no enclosing class, package declaration, or import statements:

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

Access PureScript records through `java.util.Map<String, Object>` and copy them before mutation. Generated records are immutable and are not necessarily `LinkedHashMap` instances. Generic arrays use `Object[]`; primitive values cross the generic function interface as their Java boxed equivalents. A plain `Function<Object, Object>` remains valid when the compiler specializes an `Int -> Int` call.

When no `.java` file is found, the backend emits missing-FFI stubs that throw when called. When a file is found, it is inserted verbatim; the compiler does not validate every foreign binding or adapt ordinary Java method signatures. A successful Java compilation therefore does not prove that all application FFI paths are implemented.

## Local development & testing

Use the same checkout layout as the source build instructions. The repository's regression suites are the scripts in [test/](test/); there is currently no `bin/setup`, `bin/test`, or npm test command.

Rebuild the backend, select a JDK, then run one focused regression or all scripts:

```bash
./bin/build
export JAVAC="$(command -v javac)"
export JAVA="$(command -v java)"

node test/typed-records.mjs

# Or run every regression script:
for regression in test/*.mjs; do
  node "$regression" || exit 1
done
```

The Java integration scripts default to Homebrew's `/opt/homebrew/opt/openjdk/bin` tools when `JAVAC` and `JAVA` are unset. Setting both variables makes the toolchain explicit on other installations. They import the compiler's built `output/` modules, generate fixtures in temporary directories, and compile and execute Java where needed.

| Script | Coverage |
| --- | --- |
| `test/tco.mjs` | Tail-call printing, captured values, and recursive control flow. |
| `test/int-loops.mjs` | Integer loop-variable analysis. |
| `test/counted-loops.mjs` | Counted-loop generation and execution. |
| `test/nullary-constructors.mjs` | Singleton reuse and module initialization behavior. |
| `test/typed-records.mjs` | Typed records, Map interoperability, updates, and field access. |
| `test/loop-invariants.mjs` | Lazy per-invocation caches, evaluation order, and rejected candidates. |
| `test/direct-calls.mjs` | Static calls, partial application, arity limits, and initialization order. |
| `test/int-functions.mjs` | Primitive integer functions, generic interoperability, and evaluation behavior. |

Some scripts accept optional already-built benchmark projects, such as `--rbtree-project` for direct calls or `--church-project` for integer functions. Consult their source comments for the expected cache layout. Compare performance changes against the [altbak.pub Java baselines](https://github.com/0x000000000000000000001/altbak.pub#java), separately from semantic regressions.

## Current status & milestones

- [x] PureScript implementation integrated with the TAST-aware optimizer fork.
- [x] Java module generation and configurable executable launcher.
- [x] ADT classes and nullary constructor singletons.
- [x] Typed closed records with a Map-compatible fallback.
- [x] Tail-call, integer-loop, counted-loop, and loop-invariant transformations.
- [x] Direct local calls and specialized integer functions with curried interoperability.
- [x] Java FFI snippets and focused compiler regression suites.
- [x] Core Java benchmark results published in altbak.pub.
- [ ] Complete Java FFI coverage across the library ports.
- [ ] Java `Aff` runtime and virtual-thread integration.
- [ ] Turnkey installation, setup automation, and broader compatibility validation.

These checked items describe implemented facilities and available suites, not a claim that every official PureScript test passes. The project remains experimental, and library support must be checked for each application.

## Architecture

1. **Loading and optimization:** [Main](src/Main.purs) loads enriched `corefn.json` modules and optimization directives, then calls the optimizer's `buildModules` to obtain optimized `BackendModule` values.
2. **Java lowering:** [Javapurs.CodeGen](src/Javapurs/CodeGen.purs) applies TCO and type information while producing [JavaAst](src/Javapurs/JavaAst.purs). Record, loop, function-type, and direct-call analyses live in separate `Javapurs` modules.
3. **Printing:** [Javapurs.Printer](src/Javapurs/Printer.purs) and [RecordPrinter](src/Javapurs/RecordPrinter.purs) render Java declarations, control flow, and record helpers. [IntFunctions](src/Javapurs/IntFunctions.purs) supplies the primitive-function interface.
4. **FFI and output:** `Main` resolves Java snippets, writes one class per module and shared helpers into `java_output`, and emits `MainRun` for the selected entrypoint. `javac` and `java` perform the final compilation and execution outside the backend.

## License

MIT.
