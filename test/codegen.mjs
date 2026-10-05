import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import * as PursMap from "../output/Data.Map/index.js";
import { Just } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { lowerModule } from "../output/Javapurs.Pipeline/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { intFunctionSource, tcoLoopSource } from "../output/Javapurs.Runtime/index.js";
import { moduleClass } from "./support/module-classes.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Exercise BackendSyntax -> CodeGen -> Rename -> optional Chunk -> JVM.
// The event trace observes evaluation order, laziness and multiplicity, rather
// than the implementation's choice of temporary names or Java node shapes.
const { javac, java, javacArgs } = resolveJavaTools();
const moduleName = "Codegen.Fixtures";
const className = moduleClass(moduleName);
const runtimeName = moduleClass("Codegen.Runtime");
const int = n => new S.Lit(new C.LitInt(n));
const string = s => new S.Lit(new C.LitString(s));
const local = (name, level) => new S.Local(new Just(name), level);
const ref = (name, mod = moduleName) => new S.Var(new C.Qualified(new Just(mod), name));
const app = (fn, ...args) => new S.App(fn, args);
const foreign = (name, ...args) => app(ref(name, "Codegen.Runtime"), ...args);
const note = (label, value) => foreign("note", string(label), value);
const abs = (name, level, body) => new S.Abs([new Tuple(new Just(name), level)], body);
const let_ = (name, level, value, body) => new S.Let(new Just(name), level, value, body);
const pure = value => new S.EffectPure(value);
const bind = (name, level, value, rest) => new S.EffectBind(new Just(name), level, value, rest);
const binary = (op, left, right) => new S.PrimOp(new S.Op2(op, left, right));
const add = (a, b) => binary(new S.OpIntNum(S.OpAdd.value), a, b);
const sub = (a, b) => binary(new S.OpIntNum(S.OpSubtract.value), a, b);
const eq = (a, b) => binary(new S.OpIntOrd(S.OpEq.value), a, b);
const choose = (cond, yes, no) => new S.Branch([new S.Pair(cond, yes)], no);
const group = (name, value, recursive = false) => ({ recursive, bindings: [new Tuple(name, value)] });
const fixture = (name, value) => group(name, abs("input", 0, value));
const input = local("input", 0);
const setup = (label, value) => let_("setup", 8, note(label, int(0)), value);
const write = (reference, value) => new S.PrimEffect(new S.EffectRefWrite(reference, value));
const guards = [0, 1].map(n => new S.Pair(
  setup(`guard${n}`, eq(input, int(n))), setup(`branch${n}`, int(n + 10)),
));
const fixtures = { name: moduleName, dataDecls: [], foreign: PursMap.empty, bindings: [
  fixture("guards", new S.Branch(guards, setup("default", int(12)))),
  fixture("uncurriedCall", new S.UncurriedApp(note("callee", ref("pair", "Codegen.Runtime")), [
    setup("arg0", int(4)), setup("arg1", int(2)),
  ])),
  fixture("argumentFailure", new S.UncurriedApp(ref("pair", "Codegen.Runtime"), [
    foreign("fail", string("argument")), note("unreached", int(2)),
  ])),
  fixture("deferredPure", pure(note("pure", input))),
  fixture("sequence", bind("first", 1,
    new S.EffectDefer(foreign("action", string("first"), input)),
    new S.UncurriedAbs([], let_("next", 2, note("between", add(local("first", 1), int(1))),
      bind("second", 3, pure(local("next", 2)), foreign("action", string("last"), local("second", 3))))))),
  fixture("effectFailure", bind("ignored", 1, foreign("failingAction", int(0)),
    pure(note("unreached", int(0))))),
  fixture("uncurriedEffect", new S.UncurriedEffectApp(
    new S.UncurriedEffectAbs([new Tuple(new Just("x"), 1)], pure(note("effect-body", local("x", 1)))),
    [note("effect-argument", input)])),
  fixture("references", bind("cell", 1, new S.PrimEffect(new S.EffectRefNew(input)),
    bind("written", 2, write(local("cell", 1), int(9)),
      new S.PrimEffect(new S.EffectRefRead(local("cell", 1)))))),
  fixture("writeFresh", write(note("reference", input), foreign("fresh", int(0)))),
  fixture("writeStatements", write(setup("ref-setup", note("reference", input)),
    setup("value-setup", foreign("fresh", int(0))))),
  fixture("writeSequence", bind("first", 1, write(input, foreign("fresh", int(0))),
    bind("second", 2, write(input, foreign("fresh", int(0))),
      pure(new S.Lit(new C.LitArray([local("first", 1), local("second", 2)])))))),
  fixture("writeFailure", write(foreign("fail", string("reference")), foreign("fresh", int(0)))),
  fixture("localLoop", new S.LetRec(1, [new Tuple("loop", abs("n", 2,
    choose(eq(local("n", 2), int(0)), int(7),
      new S.UncurriedApp(local("loop", 1), [sub(local("n", 2), int(1))]))))], app(local("loop", 1), input))),
  // An escaping lambda can call its enclosing recursive binding later. That
  // invocation must use the ordinary call path and the captured iteration.
  group("escape", abs("n", 0, abs("acc", 1,
    choose(eq(local("n", 0), int(0)), local("acc", 1),
      app(ref("escape"), sub(local("n", 0), int(1)),
        new S.UncurriedAbs([new Tuple(new Just("unused"), 2)],
          app(ref("escape"), int(0), local("n", 0))))))), true),
] };

const runtime = `
import java.util.*;
import java.util.function.*;
public final class ${runtimeName} {
  static final List<String> events = new ArrayList<>();
  static final RuntimeException failure = new IllegalArgumentException("expected");
  public static final Object note = (Function<Object,Object>) label -> (Function<Object,Object>) value -> {
    events.add((String)label); return value;
  };
  public static final Object pair = (Function<Object,Object>) a -> {
    events.add("partial"); return (Function<Object,Object>) b -> { events.add("body"); return (int)a * 10 + (int)b; };
  };
  public static final Object action = (Function<Object,Object>) label -> (Function<Object,Object>) value ->
    (Supplier<Object>) () -> { events.add((String)label); return value; };
  public static final Object failingAction = (Function<Object,Object>) unused ->
    (Supplier<Object>) () -> { events.add("failure"); throw failure; };
  public static final Object fail = (Function<Object,Object>) label -> { events.add((String)label); throw failure; };
  public static final Object fresh = (Function<Object,Object>) unused -> { events.add("value"); return new Object[]{42}; };
}
`;
const checks = `
import java.util.*;
import java.util.function.*;
public final class CodegenChecks {
  static int count;
  static final List<String> failures = new ArrayList<>();
  static Object apply(Object fn, Object... args) {
    for (Object arg : args) fn = ((Function<Object,Object>)fn).apply(arg);
    return fn;
  }
  static Object force(Object effect) { return ((Supplier<Object>)effect).get(); }
  static void equal(String label, Object actual, Object expected) {
    count++;
    if (!Objects.equals(actual, expected)) failures.add(label + ": " + actual + " != " + expected);
  }
  static void events(String... expected) {
    equal("events", List.copyOf(${runtimeName}.events), List.of(expected));
    ${runtimeName}.events.clear();
  }
  static void failure(Runnable action) {
    try { action.run(); failures.add("missing exception"); }
    catch (RuntimeException ex) { equal("exception identity", ex, ${runtimeName}.failure); }
  }
  public static void main(String[] args) {
    equal("first guard", apply(${className}.guards, 0), 10); events("guard0", "branch0");
    equal("second guard", apply(${className}.guards, 1), 11); events("guard0", "guard1", "branch1");
    equal("default", apply(${className}.guards, 2), 12); events("guard0", "guard1", "default");
    equal("uncurried result", apply(${className}.uncurriedCall, 0), 42);
    events("callee", "arg0", "partial", "arg1", "body");
    failure(() -> apply(${className}.argumentFailure, 0)); events("argument");
    Object effect = apply(${className}.deferredPure, 7); events();
    equal("pure first force", force(effect), 7); events("pure");
    equal("pure second force", force(effect), 7); events("pure");
    Object sequence = apply(${className}.sequence, 7); events();
    equal("sequence first force", force(sequence), 8); events("first", "between", "last");
    equal("sequence second force", force(sequence), 8); events("first", "between", "last");
    Object failed = apply(${className}.effectFailure, 0); events();
    failure(() -> force(failed)); events("failure");
    Object uncurried = apply(${className}.uncurriedEffect, 9); events("effect-argument");
    equal("uncurried effect force", force(uncurried), 9); events("effect-body");
    Object references = apply(${className}.references, 1); events();
    equal("new/write/read", force(references), 9); events();
    for (Object writer : new Object[]{${className}.writeFresh, ${className}.writeStatements}) {
      Object[] cell = new Object[]{null};
      Object deferred = apply(writer, (Object)cell); events();
      Object result = force(deferred);
      equal("write returns stored identity", result == cell[0], true);
      equal("write stores fresh array", ((Object[])cell[0])[0], 42);
      if (writer == ${className}.writeFresh) events("reference", "value");
      else events("ref-setup", "reference", "value-setup", "value");
    }
    Object[] shared = new Object[]{null};
    Object writes = apply(${className}.writeSequence, (Object)shared); events();
    Object[] results = (Object[])force(writes); events("value", "value");
    equal("sequential writes allocate separately", results[0] != results[1], true);
    equal("sequential writes keep last identity", results[1] == shared[0], true);
    boolean invalidReference = false;
    try { force(apply(${className}.writeFresh, 17)); }
    catch (ClassCastException expected) { invalidReference = true; }
    equal("invalid reference fails", invalidReference, true); events("reference");
    failure(() -> force(apply(${className}.writeFailure, 0))); events("reference");
    equal("deep local uncurried TCO", apply(${className}.localLoop, 200000), 7);
    Object closure = apply(${className}.escape, 4, 0);
    equal("escaped closure first invocation", apply(closure, 0), 1);
    equal("escaped closure second invocation", apply(closure, 0), 1);
    System.out.println("CodeGen: " + count + " JVM checks, " + failures.size() + " failures");
    if (!failures.isEmpty()) throw new AssertionError(String.join("\\n", failures));
  }
}
`;

for (const chunkEnabled of [false, true]) {
  const file = lowerModule({ chunkEnabled, codegen: {
    typedRecords: true, loopInvariants: true, directCalls: true, intFunctions: true, ownership: true,
  } })(fixtures);
  assert.equal(file.recordShapes.length, 0);
  const sources = new Map([
    [`${className}.java`, `public final class ${className} {\n${file.decls.map(printExpr).join("\n")}\n}`],
    [`${runtimeName}.java`, runtime], ["CodegenChecks.java", checks],
    ["__IntFn.java", intFunctionSource], ["TcoLoop.java", tcoLoopSource],
  ]);
  await withTemporaryDirectory(`javapurs-codegen-${chunkEnabled ? "chunk" : "plain"}-`, directory => {
    for (const [name, source] of sources) writeFileSync(join(directory, name), source);
    runCommandSync(javac, [...javacArgs, "-nowarn", ...sources.keys()], { cwd: directory, stdio: "pipe" });
    const result = runCommandSync(java, ["-Xss256k", "-cp", directory, "CodegenChecks"],
      { cwd: directory, encoding: "utf8", stdio: "pipe", timeout: 30000 });
    console.log(`${chunkEnabled ? "chunk" : "plain"}: ${result.trim()}`);
  });
}
