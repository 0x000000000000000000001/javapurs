import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { translateWithIntFunctions } from "../output/Javapurs.CodeGen/index.js";
import { runtimeSource } from "../output/Javapurs.IntFunctions/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { printRecordShape } from "../output/Javapurs.RecordPrinter/index.js";
import { recordClassName } from "../output/Javapurs.RecordShapes/index.js";

// Build the backend first. This generates and compiles real Java for both
// representations; no backend rebuild or PureScript source compilation occurs.
// Optional current optimized benchmark IR:
// node test/int-functions.mjs --church-project ../../altbak.pub-javapurs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const moduleName = "Int.Functions";
const int = C.Int.value;
const any = C.Any.value;
const fn = new C.Func([int], int);
const typed = (type, value) => new S.Typed(type, value);
const integer = value => new S.Lit(new C.LitInt(value));
const local = (name, level) => new S.Local(new Just(name), level);
const reference = (name, module = moduleName) => new S.Var(new C.Qualified(new Just(module), name));
const foreign = name => reference(name, "IntClosureRuntime");
const application = (head, ...args) => new S.App(head, args);
const lambda = (name, level, body) => new S.Abs([new Tuple(new Just(name), level)], body);
const binary = (operator, left, right) => new S.PrimOp(new S.Op2(operator, left, right));
const add = (left, right) => binary(new S.OpIntNum(S.OpAdd.value), left, right);
const sub = (left, right) => binary(new S.OpIntNum(S.OpSubtract.value), left, right);
const zero = value => binary(new S.OpIntOrd(S.OpEq.value), value, integer(0));
const choose = (condition, yes, no) => new S.Branch([new S.Pair(condition, yes)], no);
const group = (name, expression, recursive = false) => ({ recursive, bindings: [new Tuple(name, expression)] });
const callLocal = (name, level, value) => application(typed(fn, local(name, level)), value);
const fixture = (name, body) => group(name, typed(new C.Func([any], int), lambda("unused", 0, body)));

const fixtures = { name: moduleName, dataDecls: [], bindings: [
  group("inc", typed(fn, lambda("x", 0, add(local("x", 0), integer(1))))),
  // The outer function type must also provide evidence when optimized locals
  // and the nested lambda body no longer have their own Typed wrappers.
  group("twice", typed(new C.Func([fn], fn), lambda("f", 0,
    lambda("x", 1, application(local("f", 0), application(local("f", 0), local("x", 1))))))),
  group("makeAdder", typed(new C.Func([int], fn), lambda("x", 0,
    typed(fn, lambda("x", 1, add(local("x", 0), local("x", 1))))))),
  group("compose", typed(new C.Func([fn, fn], fn), lambda("f", 0, lambda("g", 1,
    typed(fn, lambda("x", 2, callLocal("f", 0, callLocal("g", 1, local("x", 2))))))))),
  group("escaped", typed(fn, application(reference("makeAdder"), integer(7)))),
  group("applyTyped", typed(new C.Func([fn, int], int), lambda("f", 0,
    lambda("x", 1, application(local("f", 0), local("x", 1)))))),
  group("genericIdentity", typed(new C.Func([any], any), lambda("x", 0, local("x", 0)))),
  group("polymorphicIdentity", typed(new C.ForAll(["a"], new C.Func([new C.TypeVar("a")], new C.TypeVar("a"))),
    lambda("x", 0, local("x", 0)))),
  group("typeAppOnly", new S.TypeApp(lambda("x", 0, local("x", 0)), fn)),
  group("applyUnknown", typed(new C.Func([any, any], any), lambda("f", 0,
    lambda("x", 1, application(local("f", 0), local("x", 1)))))),
  group("resultIsNotCalleeEvidence", typed(new C.Func([any], int), lambda("f", 0,
    typed(int, application(local("f", 0), typed(int, integer(5))))))),
  group("ignoreCallback", typed(new C.Func([fn], int), lambda("f", 0, integer(9)))),
  group("deferCallback", typed(new C.Func([fn], fn), lambda("f", 0,
    typed(fn, lambda("x", 1, callLocal("f", 0, local("x", 1))))))),
  group("returnNullCallback", typed(new C.Func([int], fn), lambda("x", 0, typed(fn, foreign("nullCallback"))))),
  fixture("nullCall", application(typed(fn, foreign("nullCallback")), application(foreign("markArgument"), integer(7)))),
  fixture("badCallee", application(typed(fn, foreign("badCallback")), application(foreign("markArgument"), integer(7)))),
  fixture("orderedCall", application(typed(fn, application(foreign("getCallback"), integer(0))),
    application(foreign("markArgument"), integer(7)))),
  fixture("argumentFailure", application(typed(fn, foreign("recordBody")), application(foreign("throwArgument"), integer(0)))),
  fixture("bodyFailure", application(typed(fn, foreign("throwBody")), application(foreign("markArgument"), integer(7)))),
  // Recursive globals retain their generic callable representation. Wrapping
  // each saturated call in a primitive adapter regressed Fibonacci execution.
  group("genericFib", typed(fn, lambda("n", 0,
    choose(binary(new S.OpIntOrd(S.OpLt.value), local("n", 0), integer(2)), local("n", 0),
      add(application(typed(fn, reference("genericFib")), sub(local("n", 0), integer(1))),
        application(typed(fn, reference("genericFib")), sub(local("n", 0), integer(2))))))), true),
  group("callGenericFib", typed(fn, lambda("n", 0,
    application(typed(fn, reference("genericFib")), local("n", 0))))),
  group("countDown", typed(fn, lambda("n", 0, choose(zero(local("n", 0)), integer(7),
    application(reference("countDown"), sub(local("n", 0), integer(1)))))), true),
  group("captureLoop", typed(new C.Func([int, fn], fn), lambda("n", 0, lambda("acc", 1,
    choose(zero(local("n", 0)), local("acc", 1), application(reference("captureLoop"),
      sub(local("n", 0), integer(1)), typed(fn, lambda("x", 2,
        add(callLocal("acc", 1, local("x", 2)), local("n", 0))))))))), true),
] };

function nodes(value, Constructor, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Constructor && value instanceof Constructor) result.push(value);
  for (const child of Object.values(value)) nodes(child, Constructor, result);
  return result;
}
function declaration(file, name) {
  const result = file.decls.find(value =>
    (value instanceof A.JavaAssign || value instanceof A.JavaLazyAssign) && value.value0 === name);
  assert.ok(result, `${name}: generated declaration must be present`);
  return result;
}

let church;
const projectFlag = process.argv.indexOf("--church-project");
if (projectFlag >= 0) {
  assert.ok(process.argv[projectFlag + 1], "--church-project requires an existing project directory");
  const project = resolve(process.argv[projectFlag + 1]);
  const { readPurmetaSync } = await import("../output/PureScript.Backend.Optimizer.Cache/index.js");
  const previousDirectory = process.cwd();
  let cache;
  try { process.chdir(project); cache = readPurmetaSync("Test.Church")(); }
  finally { process.chdir(previousDirectory); }
  assert.ok(cache instanceof Just, "build the Church project first to produce its current purmeta");
  const implementations = new Map();
  function collect(tree) {
    if (tree.constructor.name !== "Node") return;
    collect(tree.value4);
    if (tree.value3.value1.constructor.name === "ExternExpr") implementations.set(tree.value2.value1, tree.value3.value1.value1);
    collect(tree.value5);
  }
  collect(cache.value0);
  const corefn = JSON.parse(readFileSync(join(project, "run/bak/java/output/Test.Church/corefn.json"), "utf8"));
  const recursiveNames = new Set(corefn.decls.filter(decl => decl.bindType === "Rec")
    .flatMap(decl => decl.binds.map(binding => binding.identifier)));
  const names = ["zeroC", "succC", "addC", "mulC", "fromInt", "toInt", "c10", "c100", "c10k", "c100k"];
  church = { name: "Test.Church", dataDecls: corefn.dataDecls, bindings: names.map(name => {
    assert.ok(implementations.has(name), `real optimized ${name} must be available`);
    return group(name, implementations.get(name), recursiveNames.has(name));
  }) };
}

const runtime = `
import java.util.*;
import java.util.function.*;
public final class IntClosureRuntime {
  public static final List<String> events = new ArrayList<>();
  public static final RuntimeException failure = new IllegalArgumentException("expected");
  public static final Object nullCallback = null;
  public static final Object badCallback = "not a function";
  public static final Object markArgument = (Function<Object,Object>) x -> { events.add("argument"); return x; };
  public static final Object recordBody = (Function<Object,Object>) x -> { events.add("body"); return (int)x + 1; };
  public static final Object getCallback = (Function<Object,Object>) unused -> { events.add("callee"); return recordBody; };
  public static final Object throwArgument = (Function<Object,Object>) unused -> { events.add("failure"); throw failure; };
  public static final Object throwBody = (Function<Object,Object>) unused -> { events.add("body"); throw failure; };
  public static Object mark(String label, Object value) { events.add(label); return value; }
}
`;
const churchChecks = church ? `
    for (int n : new int[]{0, 1, 2, 3, 10}) {
      Object numeral = apply(Test_Church.c100k, n);
      equal("current Church c100k at " + n, apply(Test_Church.toInt, numeral), (int)Math.pow(n, 5));
    }
    Object four = apply(Test_Church.fromInt, 4);
    equal("current Church with ordinary foreign Function", apply(four, genericDouble, 1), 16);
    equal("current Church generic bridge to specialized inc", apply(four, Int_Functions.inc, 3), 7);
` : "";
const checks = `
import java.util.*;
import java.util.function.*;
public final class IntFunctionChecks {
  static Object apply(Object value, Object... arguments) {
    for (Object argument : arguments) value = ((Function<Object,Object>)value).apply(argument);
    return value;
  }
  static void equal(String label, Object actual, Object expected) {
    if (!Objects.equals(actual, expected)) throw new AssertionError(label + ": " + actual + " != " + expected);
  }
  static Throwable caught(Runnable action) {
    try { action.run(); throw new AssertionError("expected failure"); }
    catch (RuntimeException expected) { return expected; }
  }
  static void events(String... expected) { equal("evaluation order", IntClosureRuntime.events, List.of(expected)); }
  public static void main(String[] args) {
    boolean enabled = Boolean.parseBoolean(args[0]);
    Function<Object,Object> genericDouble = x -> (int)x * 2;
    Function<Object,Object> genericIdentity = x -> x;
    equal("generic bridge", apply(Int_Functions.inc, 41), 42);
    equal("typed closure retains Function interface", Int_Functions.inc instanceof Function, true);
    if (enabled) {
      equal("typed closure has primitive interface", Int_Functions.inc instanceof IntUnaryOperator, true);
      equal("direct primitive invocation", ((IntUnaryOperator)Int_Functions.inc).applyAsInt(41), 42);
    }
    equal("opaque generic callback in typed caller", apply(Int_Functions.applyTyped, genericDouble, 6), 12);
    equal("specialized callback in generic caller", apply(Int_Functions.applyUnknown, Int_Functions.inc, 6), 7);
    equal("generic callback through higher-order returned closure", apply(Int_Functions.twice, genericDouble, 3), 12);
    equal("specialized callback through higher-order returned closure", apply(Int_Functions.twice, Int_Functions.inc, 3), 5);
    Object returned = apply(Int_Functions.makeAdder, 7);
    equal("escaping captured closure", apply(returned, 8), 15);
    equal("same-name parameters keep distinct lexical captures", apply(Int_Functions.makeAdder, 4, 9), 13);
    equal("closure escaping in global initializer", apply(Int_Functions.escaped, 8), 15);
    equal("generic and specialized composition", apply(Int_Functions.compose, Int_Functions.inc, genericDouble, 3), 7);
    equal("composition with reversed callback representations", apply(Int_Functions.compose, genericDouble, Int_Functions.inc, 3), 8);
    equal("overflow through generic bridge", apply(Int_Functions.inc, Integer.MAX_VALUE), Integer.MIN_VALUE);
    equal("captured primitive overflow", apply(Int_Functions.makeAdder, -1, Integer.MIN_VALUE), Integer.MAX_VALUE);
    equal("Any identity remains generic", apply(Int_Functions.genericIdentity, "kept"), "kept");
    equal("polymorphic identity remains generic", apply(Int_Functions.polymorphicIdentity, "kept"), "kept");
    equal("TypeApp argument is not result evidence", apply(Int_Functions.typeAppOnly, "kept"), "kept");
    equal("typed call result cannot type the unknown callee", apply(Int_Functions.resultIsNotCalleeEvidence, genericDouble), 10);
    equal("unused null callback is not adapted eagerly", apply(Int_Functions.ignoreCallback, new Object[]{null}), 9);
    equal("returning null callback does not force it", apply(Int_Functions.returnNullCallback, 1), null);
    Object deferredNull = apply(Int_Functions.deferCallback, new Object[]{null});
    equal("null capture can escape before invocation", deferredNull instanceof Function, true);
    IntClosureRuntime.events.clear();
    equal("deferred null fails at invocation", caught(() -> apply(deferredNull, IntClosureRuntime.mark("argument", 7))) instanceof NullPointerException, true);
    events("argument");
    IntClosureRuntime.events.clear();
    equal("null callee still evaluates argument", caught(() -> apply(Int_Functions.nullCall, 0)) instanceof NullPointerException, true);
    events("argument");
    IntClosureRuntime.events.clear();
    equal("invalid callee cast precedes argument", caught(() -> apply(Int_Functions.badCallee, 0)) instanceof ClassCastException, true);
    events();
    IntClosureRuntime.events.clear();
    equal("ordered callee/argument/body", apply(Int_Functions.orderedCall, 0), 8);
    events("callee", "argument", "body");
    IntClosureRuntime.events.clear();
    equal("argument failure identity", caught(() -> apply(Int_Functions.argumentFailure, 0)), IntClosureRuntime.failure);
    events("failure");
    IntClosureRuntime.events.clear();
    equal("body failure identity", caught(() -> apply(Int_Functions.bodyFailure, 0)), IntClosureRuntime.failure);
    events("argument", "body");
    for (int[] example : new int[][]{{0, 0}, {1, 1}, {2, 1}, {10, 55}, {20, 6765}}) {
      equal("generic recursive Fibonacci", apply(Int_Functions.genericFib, example[0]), example[1]);
      equal("direct call to generic recursive Fibonacci", apply(Int_Functions.callGenericFib, example[0]), example[1]);
    }
    equal("deep self TCO", apply(Int_Functions.countDown, 200000), 7);
    equal("loop escape captures iteration snapshots", apply(Int_Functions.captureLoop, 10, genericIdentity, 3), 58);
    ${churchChecks}
    System.out.println("Int closure interop, scope, timing, fallbacks and TCO passed");
  }
}
`;

const outputs = [];
for (const enabled of [false, true]) {
  const options = { typedRecords: true, loopInvariants: true, directCalls: true, intFunctions: enabled };
  const files = new Map([
    ["__IntFn.java", runtimeSource], ["IntClosureRuntime.java", runtime], ["IntFunctionChecks.java", checks],
    ["TcoLoop.java", `public final class TcoLoop extends RuntimeException {
      public final String loopId; public final Object[] args;
      public TcoLoop(String id, Object[] values) { loopId = id; args = values; }
      @Override public synchronized Throwable fillInStackTrace() { return this; }
    }`],
  ]);
  function addModule(module) {
    const result = translateWithIntFunctions(options)(module);
    const name = module.name.replaceAll(".", "_");
    for (const shape of result.recordShapes) files.set(`${recordClassName(shape)}.java`, printRecordShape(shape));
    files.set(`${name}.java`, `public final class ${name} {\n${result.decls.map(printExpr).join("\n")}\n}\n`);
    return result;
  }
  const generated = addModule(fixtures);
  assert.equal(nodes(declaration(generated, "inc"), A.JavaIntAbs).length, enabled ? 1 : 0,
    "typed Int-to-Int closure representation follows the switch");
  assert.equal(nodes(declaration(generated, "genericFib"), A.JavaIntAbs).length, 0,
    "the recursive Fibonacci function retains its generic representation");
  for (const name of ["genericFib", "callGenericFib"]) {
    const decl = declaration(generated, name);
    assert.equal(nodes(decl, A.JavaIntApply).length, 0,
      `${name}: saturated calls to a known generic recursive function need no primitive adapter`);
    assert.ok(nodes(decl, A.JavaApply).length > 0, `${name}: exercise a retained generic call`);
  }
  for (const name of ["genericIdentity", "polymorphicIdentity", "typeAppOnly", "applyUnknown", "resultIsNotCalleeEvidence"]) {
    const decl = declaration(generated, name);
    assert.equal(nodes(decl, A.JavaIntAbs).length, 0, `${name}: no unjustified primitive lambda`);
    assert.equal(nodes(decl, A.JavaIntApply).length, 0, `${name}: no unjustified primitive call`);
  }
  if (!enabled) {
    assert.equal(nodes(generated, A.JavaIntAbs).length, 0);
    assert.equal(nodes(generated, A.JavaIntApply).length, 0);
  } else {
    assert.ok(nodes(generated, A.JavaIntApply).length > 0, "typed callback applications actually use the primitive dispatch path");
    assert.ok(nodes(declaration(generated, "twice"), A.JavaIntAbs).length > 0,
      "the higher-order function type must type its otherwise bare returned lambda");
  }
  if (church) addModule(church);
  const directory = mkdtempSync(join(tmpdir(), `javapurs-int-functions-${enabled ? "on" : "off"}-`));
  let success = false;
  try {
    for (const [name, source] of files) writeFileSync(join(directory, name), source);
    execFileSync(javac, ["-nowarn", ...files.keys()], { cwd: directory, encoding: "utf8", stdio: "pipe" });
    const output = execFileSync(java, ["-Xss256k", "-cp", directory, "IntFunctionChecks", String(enabled)],
      { cwd: directory, encoding: "utf8", stdio: "pipe", timeout: 30000 }).trim();
    outputs.push(output);
    console.log(`${enabled ? "enabled" : "disabled"}: ${output}`);
    success = true;
  } catch (error) {
    console.error(`Generated Java retained for inspection: ${directory}`);
    if (error.stderr) console.error(String(error.stderr));
    throw error;
  } finally { if (success) rmSync(directory, { recursive: true, force: true }); }
}
assert.equal(outputs[0], outputs[1], "specialized and generic modes pass the same behavioral checks");
console.log(`Int function representation checks${church ? " and current optimized Church" : ""} passed`);
