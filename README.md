# javapurs

<img width="949" height="332" alt="logo white" src="https://github.com/user-attachments/assets/8e1340b8-a974-41d7-bfe9-605867858669" />

_Experimental WIP. The compiler and Java library ports are under active development._

An optimizing **PureScript-to-Java compiler**, written in PureScript, bringing pure business logic to the **JVM**, its JIT compiler, garbage collector, and Java ecosystem.

`javapurs` consumes the enriched **TAST / `tcorefn`** representation produced by our [PureScript compiler fork](https://github.com/0x000000000000000000001/purescript), optimizes it through `purescript-backend-optimizer`, and emits Java source. Node.js runs the compiler; the generated application runs on the JVM.

## Features

- **Optimization before Java generation.** The compiler is written in PureScript, with JavaScript FFI and launchers. It uses the [Java branch of our TAST-aware optimizer fork](https://github.com/0x000000000000000000001/purescript-backend-optimizer/tree/edge-javapurs), based on [Arista's optimizer](https://github.com/aristanetworks/purescript-backend-optimizer), for inlining, constant folding, and other shared transformations.
- **Type-guided representations.** Enriched `output/<Module>/corefn.json` files retain expression types and declaration metadata (`dataDecls`, `classDecls`). The backend emits nested classes for ADTs, shares eligible nullary constructors, and uses immutable, Map-compatible classes for eligible closed records. Generic values and unsupported record shapes retain `Object` or Map representations.
- **Specialized integer functions.** Eligible `Int -> Int` functions implement `IntUnaryOperator` through the generated `__IntFn` interface, which also supports the generic curried `Function<Object, Object>` interface.
- **Calls and loops.** Java-specific passes implement tail-call loops, primitive integer loop variables, counted loops, lazy caches for eligible loop invariants, and direct static calls for eligible fully applied functions in the same module.
- **Java interoperability.** Foreign imports are implemented by Java snippets inserted into generated classes. Compile the resulting sources with `javac` and supply any application JAR dependencies through the classpath.

Java library FFI coverage is incomplete, and a Java `Aff` runtime remains a development goal. The current backend does not implement virtual-thread scheduling or Valhalla value types.

## Benchmarks

The [Java results in altbak.pub](https://github.com/0x000000000000000000001/altbak.pub#java) compare compiled PureScript with native Java written in a functional style and with hand-optimized Java FFI. They cover fourteen core workloads, including recursion, records, arrays, polymorphism, and closures.

Use those documented baselines and their methodology when evaluating changes. The Java results are marked WIP and measure sequential computation; they do not establish `Aff` support or multicore scaling. Performance depends on the workload, JVM configuration, and warmup, so the benchmark repository is the source of measurements rather than a fixed speedup claim here.

## Getting started

### Prerequisites

- A **TAST-capable `purs`** from the compiler fork on `PATH`, kept compatible with the optimizer checkout. An upstream binary with the same version number does not provide the same enriched format.
- **Spago** with YAML configuration support. The compiler pins registry package set `77.10.1` in [spago.yaml](spago.yaml).
- **Node.js** to run the compiler and its ES module launcher. The setup below was checked on 14 September 2026 with Node.js `24.8.0`, Spago `1.0.3`, and the local TAST fork reporting PureScript `0.15.16`.
- A **JDK** with both `javac` and `java` available. Java 21+ is the project target; this walkthrough was checked with OpenJDK `26.0.2`, without establishing the minimum supported JDK. Set the same JDK for compilation and execution.
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

`bin/build` runs `spago build`. The launcher `bin/javapurs` runs `bin/javapurs.js`, which imports `output/Main/index.js`; rebuild after changing compiler sources. The `PATH` command above applies to the current shell. Keep the compiler and optimizer revisions together when reproducing a build.

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
mkdir -p java_output
spago build
javac -d java_output java_output/*.java
java -cp java_output MainRun
```

This prints `Hello from javapurs`. The example supplies its own Java console binding. It uses registry packages for PureScript definitions; their unused foreign declarations may remain stubs. For a larger application, provide `.java` implementations for every foreign value that can execute, including those in transitive dependencies. The sibling `javapurs-*` library repositories are work in progress: `javapurs-console`, `javapurs-effect`, and `javapurs-aff` currently retain JavaScript FFI, so their names alone do not establish Java support. Override packages under `workspace.extraPackages` when a port supplies the bindings your application needs.

Create `java_output` before the backend runs: the CLI writes into it without creating it. Spago invokes the configured backend after producing enriched `output/<Module>/corefn.json`. Verify that a generated file includes `dataDecls`, `classDecls`, and, with the current fork, `typeTable`. Missing metadata indicates an incompatible compiler or stale output; select the fork explicitly on `PATH` and rebuild in a fresh output directory.

Generated classes use the default Java package, with dots in PureScript module names replaced by underscores: `App.Main` becomes `App_Main.java`. `MainRun.java` is the executable launcher. `Main.java` represents the PureScript module and is not the JVM entrypoint. Record helpers, `__IntFn.java`, and `TcoLoop.java` are emitted alongside modules. Use a fresh `java_output` when removing or renaming modules, as the backend does not remove old files.

To regenerate Java from existing TAST without recompiling PureScript, invoke the backend directly:

```bash
mkdir -p java_output
javapurs --main Main
javac -d java_output java_output/*.java
java -cp java_output MainRun
```

For an application with no external JAR dependencies, package the compiled classes with:

```bash
jar --create --file app.jar --main-class MainRun -C java_output .
java -jar app.jar
```

Java libraries used by your FFI must be added to the compile and runtime classpaths. Dependency management and JAR packaging are application responsibilities.

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
| `--main <Module>` | Select the entrypoint module; defaults to `Main`. The launcher calls its `main` as an effect thunk. |
| `--records=maps` | Compare Map records with the default typed representation on the same TAST. |
| `--loop-invariants=off` | Disable caching of eligible pure, closed `Int` computations within loops. |
| `--direct-calls=off` | Disable private static methods for known, fully applied local-module functions. Public curried functions remain available in both modes. |
| `--int-functions=off` | Disable the specialized `Int -> Int` closure/call representation. |

The input directory is fixed to `output`, and Java output to `java_output`, both relative to the application working directory. There is no configurable output path or dedicated `--help` handler; unknown arguments are currently ignored.

Loop invariant caches belong to each fully applied function invocation. They evaluate at the first original use, so skipped branches and zero-iteration loops keep their evaluation behavior. The analysis checks known definitions and closures recursively, rejects unknown FFI/effects and local captures, and only caches successful `Int` results.

Direct calls use private static methods for non-recursive functions in the same module. Only consecutive lambdas with no computation between arguments qualify; partial applications and unknown callbacks keep the public curried interface. Calls can use only earlier declarations, preserving initialization order. Method parameters remain `Object`, so casts in the original body still happen after argument evaluation. This transformation handles arities from two through 32.

## Foreign function interface

Place a `.java` file beside the corresponding `.purs` source. The resolver first checks that adjacent file, then searches local and Spago package source locations. For example, `src/Example.purs`:

```purescript
module Example where

import Prelude (Unit)
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

Access PureScript records through `java.util.Map<String, Object>` and copy them before mutation. Generated typed record classes are immutable; other record paths use Maps. Do not assume every record is a `LinkedHashMap`. Generic arrays use `Object[]`; primitive values cross the generic function interface as their Java boxed equivalents. A plain `Function<Object, Object>` remains valid when the compiler specializes an `Int -> Int` call.

When no `.java` file is found, the backend emits missing-FFI stubs that throw when called. When a file is found, it is inserted verbatim; the compiler does not validate every foreign binding or adapt ordinary Java method signatures. A successful Java compilation therefore does not prove that all application FFI paths are implemented.

## Development and testing

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

## Architecture

1. **Loading and optimization:** [Main](src/Main.purs) loads enriched `corefn.json` modules and optimization directives, then calls the optimizer's `buildModules` to obtain optimized `BackendModule` values.
2. **Java lowering:** [Javapurs.CodeGen](src/Javapurs/CodeGen.purs) applies TCO and type information while producing [JavaAst](src/Javapurs/JavaAst.purs). Record, loop, function-type, and direct-call analyses live in separate `Javapurs` modules.
3. **Printing:** [Javapurs.Printer](src/Javapurs/Printer.purs) and [RecordPrinter](src/Javapurs/RecordPrinter.purs) render Java declarations, control flow, and record helpers. [IntFunctions](src/Javapurs/IntFunctions.purs) supplies the primitive-function interface.
4. **FFI and output:** `Main` resolves Java snippets, writes one class per module and shared helpers into `java_output`, and emits `MainRun` for the selected entrypoint. `javac` and `java` perform the final compilation and execution outside the backend.

## Current status and limitations

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

## License

MIT, as declared by this project. A standalone license file has not yet been added to this repository.
