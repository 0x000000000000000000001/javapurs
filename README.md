# javapurs

<br />
<br />

_Experimental WIP._

A super-optimized **PureScript-to-Java compiler**, entirely written in PureScript, leveraging Java's **battle-tested JVM**, **advanced JIT optimizations**, and **huge enterprise ecosystem**. 

`javapurs` leverages an enriched `tcorefn` (Typed CoreFn) representation to compile your pure business logic into robust, modern Java code. It seamlessly integrates into your existing PureScript workflow as a custom backend.

## Why Java?

While the broader JS ecosystem has heavily leaned towards TypeScript, many backend services and large-scale enterprise applications rely heavily on Java for its **performance**, **mature GC**, and **massive ecosystem** (Maven/Gradle).

`javapurs` aims to provide a bridge for developers who want the elegance and strict typing of a purely functional language like PureScript, while benefiting from the JVM's massive ecosystem. It opens a door for those who want to compile their pure business logic into a `.jar` that can run anywhere the JVM runs, perfectly integrating with enterprise stacks.

## Why a new Java backend?

The `javapurs` project is largely inspired by previous efforts to compile PureScript to JVM targets (e.g., pure11). Reading through the discussions and challenges raised by users over the years, it became clear that the ecosystem has evolved drastically. This evolution unlocked new architectural paradigms that make building a completely new Java backend highly relevant today:

### 1. The optimizer & bootstrapping
While previous native compilers were often written in Haskell and parsed raw `CoreFn`, `javapurs` is written 100% in PureScript. It integrates directly with the [`purescript-backend-optimizer`](https://github.com/aristanetworks/purescript-backend-optimizer). This allows the compiler to instantly benefit from classical optimizations such as aggressive uncurrying, magic-do, and Tail Call Optimization (TCO) at the AST level. The `javapurs` compiler can then strictly focus on translating this highly-optimized AST into idiomatic, performant Java code. Being built in PureScript also ensures it remains fully accessible to anyone in the ecosystem (installable via `spago` and `npm`).

### 2. Heap vs stack: modern memory layout for Java
For `javapurs`, I decided to leverage modern Java features like Sealed Interfaces and Records (introduced in recent Java versions). This allows a very clean and performant representation of ADTs. By taking advantage of the JVM's Escape Analysis and upcoming Project Valhalla (value types), dynamic operations stay incredibly fast, bypassing unnecessary GC overhead.

### 3. TAST: Breaking the performance ceiling
To reach raw Java speeds, `javapurs` consumes an enriched `tcorefn.json` (Typed CoreFn). This custom format preserves the deep structural typing information and the exact memory layout of ADTs that standard `corefn` strips away. Combined with partial monomorphization, this allows the compiler to generate idiomatic, statically typed Java code end-to-end (using native primitives `int`, `double`, `boolean`), unlocking massive performance gains.

### 4. Zero boilerplate FFI
One of the pain points with FFI in alternative backends is the boilerplate (manual boxing/unboxing, currying). `javapurs` features a WebAssembly AST parser (`ffi_gen.wasm`) that analyzes your `.java` FFI files on the fly. You can write perfectly flat and strongly typed Java methods. The generated bridge takes care of all the uncurrying, type conversions, and Effect flattening under the hood, making FFI development feel 100% native.

### 5. Up-to-date with modern PureScript & Java
`javapurs` aims to be fully aligned with the current v0.15+ ecosystem (and v0.16+ soon). It takes full advantage of modern Java (Java 21+).

### 6. Native Parallelism behind Aff (Project Loom)
Historical hurdles involved mapping PureScript’s asynchronous monad (`Aff`) without introducing massive thread overhead. Today, the game has changed: Java 21 introduced Virtual Threads (Project Loom). `javapurs` maps `Aff` to Virtual Threads, bringing true, lightweight, shared-memory parallelism to PureScript. A heavy asynchronous workload naturally scales, crushing traditional thread-pool limits.

## How to use

If you wish to configure an existing project, `javapurs` acts as a drop-in backend for the Spago build system.

1. **Install the `javapurs` backend compiler:**
   You can install the compiler directly from GitHub. NPM will automatically compile it in the background during installation.
   ```bash
   npm install --save-dev github:0x000000000000000000001/javapurs
   ```

2. **Manage Core Library Overrides (`spago.yaml`):**
   Because standard PureScript libraries use JavaScript FFI, you must override them with their `javapurs-*` counterparts. Keep using the official PureScript registry as your base, and manually define all Java overrides using the `extraPackages` directive.

   ```yaml
   workspace:
     packageSet:
       registry: 77.10.1
     extraPackages:
       prelude:
         git: "https://github.com/0x000000000000000000001/javapurs-prelude.git"
         ref: "master"
         dependencies: []
       # ... all other javapurs-* packages
     backend:
       cmd: javapurs
   ```

3. **Build and execute:**
   The compiler will parse all `tcorefn.json` files generated by `purs` (via a TAST-enabled fork) and output native Java files in the `output/` directory.
   
   An executable `Main.java` entrypoint will be automatically generated. You can compile and run it directly:
   
   ```bash
   spago build
   cd output
   javac Main.java
   java Main
   ```

### Compiler configuration options

The `javapurs` compiler is entirely **zero-config by default**. It will automatically scan your `tcorefn` ASTs and generate a ready-to-execute `Main.java` entrypoint.

If you need advanced behavior, you can pass arguments to the `javapurs` compiler by appending them to the `spago build --backend-args` command:

```bash
spago build --backend javapurs --backend-args "--main App.Main"
```

| Option | Description |
|---|---|
| `--main <Module>` | *Optional*. Explicitly sets the entrypoint module. Without this flag, `javapurs` automatically targets the `Main` module. |

## Local development & testing

If you plan to contribute to the compiler or run the official test suite locally, you will have to follow a specific "sibling-checkout" directory layout. 

Because `javapurs` replaces the JS ecosystem with Java, it requires custom Java-compatible forks of the core PureScript libraries (e.g. `purescript-prelude` becomes `javapurs-prelude`). The internal test runner (`bin/test`) expects these core `javapurs-*` repositories to be cloned side-by-side in the same parent directory as the main `javapurs` repository.

```
workspace/
├── javapurs/
├── javapurs-prelude/
├── javapurs-effect/
├── javapurs-console/
├── javapurs-assert/
└── ... (all other core javapurs-* forks)
```

To easily clone all these required dependencies, you can simply run the provided setup script:
```bash
cd javapurs
./bin/setup
```

To run the test suite:
```bash
./bin/test
```

## Architecture

`javapurs` is built on top of [Arista's purescript-backend-optimizer](https://github.com/aristanetworks/purescript-backend-optimizer) to avoid reinventing the optimization wheel. The compilation pipeline is functionally decoupled:

1. **Optimization**: The optimizer reads the `tcorefn.json` generated by `purs`, performs aggressive Dead Code Elimination (DCE), typeclass dictionary resolution, inlining, and constant folding at the AST level, and outputs an optimized `BackendModule`.
2. **Code Generation**: `Javapurs.CodeGen` maps this heavily optimized PureScript AST to our native `JavaAst`.
3. **Printing**: `Javapurs.Printer` formats the Java AST into valid, modern Java syntax.
4. **Caching & CLI**: `Main` orchestrates the CLI, writing the generated `.java` files to their respective module directories. 

## License

MIT License. See [LICENSE](LICENSE) for details.
