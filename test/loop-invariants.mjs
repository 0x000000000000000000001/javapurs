import assert from "node:assert/strict";
import { runtimeSource } from "../output/Javapurs.IntFunctions/index.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import * as T from "../output/PureScript.Backend.Optimizer.Codegen.Tco/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { renameExpr } from "../output/Javapurs.Rename/index.js";
import { isPureIntInvariant } from "../output/Javapurs.PureInvariants/index.js";
import { prepareLoop } from "../output/Javapurs.LoopInvariants/index.js";
import { extractUncurriedAbs, translateOperator1, translateOperator2, translateWithOptions } from "../output/Javapurs.CodeGen/index.js";

// Run after the project backend build: node test/loop-invariants.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = value => new A.JavaRaw(value);
const local = name => new A.JavaLocal(name);
const integer = expression => new A.JavaCast("int", expression);
const snapshot = name => local(`__final_${name}`);
const binary = (operator, left, right) => new A.JavaBinaryOp(operator, integer(left), integer(right));
const zero = name => binary("==", snapshot(name), raw("0"));
const decrement = name => binary("-", snapshot(name), raw("1"));
const call = (name, args = []) => new A.JavaCall(raw(name), args);
const choose = (condition, yes, no) => new A.JavaTernary(condition, yes, no);
const next = (name, values) => new A.JavaContinue(name, values);
const invariant = name => new A.JavaLoopInvariant(name);
const memo = (params, values, body) => new A.JavaMemoizedLoop(params, params,
  values.map(({ name, value }) => new Tuple(name, value)), body);
const functionOf = (params, expression) => printExpr(renameExpr(new A.JavaAbs(params, expression)));
const note = (label, value) => call("note", [new A.JavaString(label), value]);
const definitions = {};

const moduleName = "Invariant.Fixtures";
const bTyped = (type, value) => new S.Typed(type, value);
const bInt = value => new S.Lit(new C.LitInt(value));
const bLocal = (name, level = 0) => new S.Local(new Just(name), level);
const bVar = (name, module = moduleName) => new S.Var(new C.Qualified(new Just(module), name));
const bApp = (fn, args) => new S.App(fn, args);
const bCall = (name, args, module = moduleName) => bApp(bVar(name, module), args);
const bAbs = (args, body) => new S.Abs(args.map(([name, level]) => new Tuple(new Just(name), level)), body);
const bAdd = (left, right) => new S.PrimOp(new S.Op2(new S.OpIntNum(S.OpAdd.value), left, right));
const bSub = (left, right) => new S.PrimOp(new S.Op2(new S.OpIntNum(S.OpSubtract.value), left, right));
const bZero = value => new S.PrimOp(new S.Op2(new S.OpIntOrd(S.OpEq.value), value, bInt(0)));
const bBranch = (condition, yes, no) => new S.Branch([new S.Pair(condition, yes)], no);
const bLet = (value, body = bInt(7)) => new S.Let(new Just("unused"), 19, value, body);
const analyze = expression => T.analyze([])(expression);
const callbackType = new C.Func([C.Int.value], C.Int.value);
const pureCallback = bTyped(callbackType, bAbs([["x", 0]], bAdd(bLocal("x"), bInt(1))));
const impureCallback = bTyped(callbackType, bAbs([["x", 0]],
  bTyped(C.Int.value, bCall("effect", [bLocal("x")], "Unknown.Foreign"))));
const backendDefinitions = [
  ["increment", pureCallback],
  ["applyCallback", bTyped(new C.Func([callbackType, C.Int.value], C.Int.value),
    bAbs([["f", 0], ["x", 1]], bApp(bLocal("f"), [bLocal("x", 1)])))],
  ["returnCallback", bTyped(new C.Func([callbackType, C.Int.value], callbackType),
    bAbs([["f", 0], ["n", 1]], bBranch(bZero(bLocal("n", 1)), bLocal("f"),
      bCall("returnCallback", [bLocal("f"), bSub(bLocal("n", 1), bInt(1))]))))],
  ["threeArguments", bTyped(new C.Func([C.Int.value, C.Int.value, C.Int.value], C.Int.value),
    bAbs([["a", 0], ["b", 1]], bAbs([["c", 2]], bAdd(bAdd(bLocal("a"), bLocal("b", 1)), bLocal("c", 2)))))],
  ["recursive", bTyped(callbackType, bAbs([["n", 0]], bBranch(bZero(bLocal("n")), bInt(0),
    bCall("recursive", [bSub(bLocal("n"), bInt(1))]))))],
  ["unitValue", bTyped(new C.Func([C.Unit.value], C.Int.value), bAbs([["unit", 0]], bInt(7)))],
  ["cycleA", bTyped(C.Int.value, bVar("cycleB"))],
  ["cycleB", bTyped(C.Int.value, bVar("cycleA"))],
  ["functionValueCycle", bTyped(callbackType, bAbs([["x", 0]], bVar("cyclicValue")))],
  ["cyclicValue", bTyped(C.Int.value, bCall("functionValueCycle", [bInt(0)]))],
].map(([name, expression]) => new Tuple(name, analyze(expression)));
let classificationChecks = 0;
function pureCheck(label, expression, expected) {
  assert.equal(isPureIntInvariant(moduleName)(backendDefinitions)(analyze(expression)), expected, label);
  classificationChecks++;
}
const closedCall = bCall("increment", [bInt(3)]);
pureCheck("closed pure scalar call", closedCall, true);
pureCheck("known recursive pure function", bCall("recursive", [bInt(4)]), true);
pureCheck("pure callback", bCall("applyCallback", [pureCallback, bInt(4)]), true);
pureCheck("impure callback", bCall("applyCallback", [impureCallback, bInt(4)]), false);
pureCheck("pure callback returned through recursion",
  bApp(bCall("returnCallback", [pureCallback, bInt(2)]), [bInt(4)]), true);
pureCheck("impure callback returned through recursion",
  bApp(bCall("returnCallback", [impureCallback, bInt(2)]), [bInt(4)]), false);
pureCheck("arity-three function returning a closure", bCall("threeArguments", [bInt(1), bInt(2), bInt(3)]), true);
pureCheck("partial application is not an Int", bCall("threeArguments", [bInt(1), bInt(2)]), false);
pureCheck("loop-dependent call", bCall("increment", [bLocal("counter", 8)]), false);
pureCheck("unknown foreign call even with Int annotation", bTyped(C.Int.value, bCall("effect", [bInt(1)], "Unknown.Foreign")), false);
pureCheck("global value cycle", bTyped(C.Int.value, bVar("cycleA")), false);
pureCheck("function recursion through a global value", bCall("functionValueCycle", [bInt(0)]), false);
pureCheck("trusted Unit runtime constant", bCall("unitValue", [bTyped(C.Unit.value, bVar("unit", "Data.Unit"))]), true);
pureCheck("Unit annotation does not trust unknown global", bCall("unitValue", [bTyped(C.Unit.value, bVar("unit", "Unknown.Foreign"))]), false);
pureCheck("effectful deferred body", bTyped(C.Int.value, new S.EffectDefer(bInt(7))), false);
pureCheck("effect node under otherwise scalar let", bTyped(C.Int.value, bLet(new S.EffectPure(bInt(1)))), false);
pureCheck("explicit failure", bTyped(C.Int.value, new S.Fail("no speculation")), false);
pureCheck("aggregate construction under scalar let", bTyped(C.Int.value,
  bLet(new S.Lit(new C.LitRecord([new C.Prop("x", bInt(1))])))), false);
pureCheck("array construction under scalar let", bTyped(C.Int.value,
  bLet(new S.Lit(new C.LitArray([bInt(1)])))), false);
pureCheck("aggregate access", bTyped(C.Int.value,
  new S.Accessor(new S.Lit(new C.LitRecord([new C.Prop("x", bInt(1))])), new S.GetProp("x"))), false);
pureCheck("unreachable-looking impure branch still rejected", bTyped(C.Int.value,
  bBranch(bZero(bInt(0)), bInt(7), bTyped(C.Int.value, bCall("effect", [], "Unknown.Foreign")))), false);
pureCheck("unused closure with an impure body rejected", bTyped(C.Int.value, bLet(impureCallback)), false);
pureCheck("escaped local-name collision does not hide a free variable", bApp(
  bTyped(callbackType, bAbs([["x'", 0]], bLocal("x_prime_"))), [bInt(3)]), false);

let selectionChecks = 0;
function planCheck(label, expression, expected) {
  const result = prepareLoop(moduleName)(backendDefinitions)("fixtureLoop")(analyze(expression));
  assert.equal(result.invariants.length, expected, label);
  selectionChecks++;
  return result;
}
planCheck("scalar call in arithmetic selected", bAdd(bLocal("acc", 8), closedCall), 1);
planCheck("tail call retains TCO", closedCall, 0);
planCheck("typed tail call retains TCO", bTyped(C.Int.value, closedCall), 0);
planCheck("branch tail calls retain TCO", bBranch(bZero(bLocal("n", 8)), closedCall, closedCall), 0);
planCheck("nested lambda is a separate invocation", bAbs([["x", 0]], bAdd(bInt(1), closedCall)), 0);
planCheck("deferred effect is a separate invocation", new S.EffectDefer(bAdd(bInt(1), closedCall)), 0);
planCheck("explicit EffectPure is excluded", new S.EffectPure(bAdd(bInt(1), closedCall)), 0);
planCheck("explicit EffectBind is excluded", new S.EffectBind(new Just("effectValue"), 9,
  new S.EffectPure(bInt(1)), bAdd(bInt(1), closedCall)), 0);
planCheck("uncurried lambda is a separate invocation", new S.UncurriedAbs([], bAdd(bInt(1), closedCall)), 0);
planCheck("uncurried effect lambda is separate", new S.UncurriedEffectAbs([], bAdd(bInt(1), closedCall)), 0);
planCheck("recursive bindings belong to their own loops", new S.LetRec(4,
  [new Tuple("inner", bAbs([["x", 5]], bAdd(bLocal("x", 5), closedCall)))], bInt(0)), 0);
planCheck("LetRec continuation still belongs to outer loop", new S.LetRec(4,
  [new Tuple("inner", bAbs([["x", 5]], bAdd(bLocal("x", 5), closedCall)))], bAdd(bLocal("acc", 8), closedCall)), 1);
const separate = planCheck("separate occurrences keep independent first-use caches", bAdd(closedCall, closedCall), 2);
assert.notEqual(separate.invariants[0].name, separate.invariants[1].name);
console.log(`Loop invariant classification: ${classificationChecks} purity checks and ${selectionChecks} scope checks passed`);

// Exercise CodeGen before Rename, including operators that previously embedded
// printed child expressions in JavaRaw and thereby hid cache references.
const unaryExpression = bTyped(new C.Func([C.Int.value, C.Int.value], C.Int.value),
  bAbs([["n", 0], ["acc", 1]], bBranch(bZero(bLocal("n")), bLocal("acc", 1),
    bCall("unaryLoop", [bSub(bLocal("n"), bInt(1)), bAdd(bLocal("acc", 1),
      bAdd(new S.PrimOp(new S.Op1(S.OpIntNegate.value, bCall("increment", [bInt(3)]))),
        new S.PrimOp(new S.Op1(S.OpIntBitNot.value, bCall("increment", [bInt(4)])))))]))));
const indexExpression = bTyped(new C.Func([C.Int.value, C.Int.value], C.Int.value),
  bAbs([["n", 0], ["acc", 1]], bBranch(bZero(bLocal("n")), bLocal("acc", 1),
    bCall("indexLoop", [bSub(bLocal("n"), bInt(1)), bAdd(bLocal("acc", 1),
      new S.PrimOp(new S.Op2(S.OpArrayIndex.value,
        new S.Lit(new C.LitArray([bInt(10), bInt(20), bInt(30)])), bCall("increment", [bInt(0)]))))]))));
const unaryModule = translateWithOptions({ typedRecords: true, loopInvariants: true })({
  name: moduleName, dataDecls: [], bindings: [
    { recursive: false, bindings: [new Tuple("increment", pureCallback)] },
    { recursive: true, bindings: [new Tuple("unaryLoop", unaryExpression)] },
    { recursive: true, bindings: [new Tuple("indexLoop", indexExpression)] },
  ],
});
const unaryModuleSource = `public final class Invariant_Fixtures {\n${unaryModule.decls.map(decl => printExpr(renameExpr(decl))).join("\n")}\n}`;

const projectFlag = process.argv.indexOf("--lazy-project");
if (projectFlag >= 0) {
  assert.ok(process.argv[projectFlag + 1], "--lazy-project requires a project directory");
  const project = resolve(process.argv[projectFlag + 1]);
  const { readPurmetaSync } = await import("../output/PureScript.Backend.Optimizer.Cache/index.js");
  const previousDirectory = process.cwd();
  let cached;
  try {
    process.chdir(project);
    cached = readPurmetaSync("Test.LazyEvaluation")();
  } finally { process.chdir(previousDirectory); }
  assert.ok(cached instanceof Just, "build the project first to produce Test.LazyEvaluation.purmeta");
  const entries = [];
  function collect(map) {
    if (map.constructor.name !== "Node") return;
    collect(map.value4);
    const expression = map.value3.value1;
    if (expression.constructor.name === "ExternExpr") entries.push({ name: map.value2.value1, expression: expression.value1 });
    collect(map.value5);
  }
  collect(cached.value0);
  const realBindings = entries.map(({ name, expression }) => new Tuple(name, analyze(expression)));
  const many = realBindings.find(entry => entry.value0 === "runManyTimes");
  assert.ok(many, "runManyTimes must retain its optimized expression");
  const abstraction = extractUncurriedAbs(many.value1);
  assert.ok(abstraction instanceof Just);
  const plan = prepareLoop("Test.LazyEvaluation")(realBindings)("runManyTimes")(abstraction.value0.body);
  assert.equal(plan.invariants.length, 1, "the real benchmark has one closed forced-thunk invariant");
  assert.equal(isPureIntInvariant("Test.LazyEvaluation")(realBindings)(plan.invariants[0].value), true);
  const backendModule = {
    name: "Test.LazyEvaluation", dataDecls: [],
    bindings: entries.map(({ name, expression }) => ({
      recursive: name === "buildThunks" || name === "runManyTimes", bindings: [new Tuple(name, expression)],
    })),
  };
  const enabled = translateWithOptions({ typedRecords: true, loopInvariants: true })(backendModule);
  const disabled = translateWithOptions({ typedRecords: true, loopInvariants: false })(backendModule);
  function count(value, constructor) {
    if (!value || typeof value !== "object") return 0;
    return Number(value instanceof constructor) + Object.values(value).reduce((sum, child) => sum + count(child, constructor), 0);
  }
  const generated = enabled.decls.find(decl => decl.value0 === "runManyTimes");
  assert.equal(count(generated, A.JavaMemoizedLoop), 1, "real loop gets one invocation-local cache");
  assert.equal(count(generated, A.JavaLoopInvariant), 1, "the invariant is forced at its original use");
  assert.equal(count(disabled, A.JavaMemoizedLoop), 0, "disabled option retains baseline loop generation");
  console.log("Optimized LazyEvaluation: one pure closed Int invariant, tail loop and disabled baseline preserved");
}

definitions.basic = functionOf(["n", "acc"], memo(["n", "acc"], [
  { name: "constant", value: note("value", raw("7")) },
], choose(zero("n"), snapshot("acc"), next("basic", [
  decrement("n"), binary("+", snapshot("acc"), invariant("constant")),
]))));

definitions.ordered = functionOf(["orderN", "orderAcc", "orderScratch"],
  memo(["orderN", "orderAcc", "orderScratch"], [
    { name: "orderedValue", value: note("value", raw("7")) },
  ], choose(zero("orderN"), snapshot("orderAcc"), next("ordered", [
    note("counter", decrement("orderN")),
    binary("+", snapshot("orderAcc"), invariant("orderedValue")),
    note("after", raw("0")),
  ]))));

definitions.guarded = functionOf(["guardN", "guardAcc"], memo(["guardN", "guardAcc"], [
  { name: "guardedValue", value: note("guarded-value", raw("7")) },
], choose(zero("guardN"), snapshot("guardAcc"), next("guarded", [
  decrement("guardN"), binary("+", snapshot("guardAcc"), choose(
    binary("==", snapshot("guardN"), raw("2")), invariant("guardedValue"), raw("0"),
  )),
]))));

definitions.twoValues = functionOf(["twoN", "twoAcc"], memo(["twoN", "twoAcc"], [
  { name: "leftValue", value: note("left", raw("5")) },
  { name: "rightValue", value: note("right", raw("7")) },
], choose(zero("twoN"), snapshot("twoAcc"), next("twoValues", [
  decrement("twoN"), binary("+", snapshot("twoAcc"), binary("+", invariant("rightValue"), invariant("leftValue"))),
]))));

definitions.negative = functionOf(["negativeN", "negativeAcc"], memo(["negativeN", "negativeAcc"], [
  { name: "negativeValue", value: note("negative", raw("3")) },
], choose(zero("negativeN"), snapshot("negativeAcc"), next("negative", [
  binary("+", snapshot("negativeN"), raw("1")), binary("+", snapshot("negativeAcc"), invariant("negativeValue")),
]))));

definitions.counterOverflow = functionOf(["overflowN", "overflowAcc"], memo(["overflowN", "overflowAcc"], [
  { name: "overflowValue", value: note("overflow", raw("7")) },
], choose(binary("==", snapshot("overflowN"), raw("Integer.MIN_VALUE")), snapshot("overflowAcc"), next("counterOverflow", [
  binary("+", snapshot("overflowN"), raw("1")), binary("+", snapshot("overflowAcc"), invariant("overflowValue")),
]))));

// The observed calls are deliberately Java helpers here. These printer tests
// exercise cache behavior independently of the classifier, which must reject
// unknown FFI calls as optimization candidates.
definitions.retry = functionOf(["retryN", "retryAcc"], memo(["retryN", "retryAcc"], [
  { name: "retryValue", value: call("failOnce") },
], choose(zero("retryN"), snapshot("retryAcc"), next("retry", [
  decrement("retryN"), binary("+", snapshot("retryAcc"),
    call("recover", [new A.JavaAbs([], invariant("retryValue"))])),
]))));

definitions.failure = functionOf(["failureN", "failureAcc"], memo(["failureN", "failureAcc"], [
  { name: "failureValue", value: call("alwaysFail") },
], choose(zero("failureN"), snapshot("failureAcc"), next("failure", [
  note("before-failure", decrement("failureN")),
  binary("+", snapshot("failureAcc"), invariant("failureValue")),
]))));

definitions.captured = functionOf(["seed", "captureN", "captureAcc"],
  memo(["captureN", "captureAcc"], [
    { name: "capturedValue", value: note("captured", local("seed")) },
  ], choose(zero("captureN"), snapshot("captureAcc"), next("captured", [
    decrement("captureN"), binary("+", snapshot("captureAcc"), invariant("capturedValue")),
  ]))));

const inner = new A.JavaAbs(["innerN", "innerAcc"], memo(["innerN", "innerAcc"], [
  { name: "constant", value: note("inner", raw("2")) },
], choose(zero("innerN"), snapshot("innerAcc"), next("inner", [
  decrement("innerN"), binary("+", snapshot("innerAcc"), invariant("constant")),
]))));
definitions.nested = functionOf(["outerN", "outerAcc"], memo(["outerN", "outerAcc"], [
  { name: "constant", value: note("outer", raw("1")) },
], choose(zero("outerN"), snapshot("outerAcc"), new A.JavaBlock([
  new A.JavaLocalAssign("innerFunction", inner),
], next("nested", [
  decrement("outerN"), binary("+", snapshot("outerAcc"), binary("+", invariant("constant"),
    new A.JavaApply(new A.JavaApply(local("innerFunction"), raw("2")), raw("0")))),
])))));

for (const [name, expression] of Object.entries(definitions)) {
  assert.match(expression, /java\.util\.function\.Function<Object,\s*Object>/, `${name}: curried function boundary retained`);
  assert.match(expression, /\bcontinue\s*;/, `${name}: direct loop continuation retained`);
}

const legacyDefinitions = {
  negate: functionOf(["operand"], translateOperator1(moduleName)(S.OpIntNegate.value)(local("operand"))),
  complement: functionOf(["operand"], translateOperator1(moduleName)(S.OpIntBitNot.value)(local("operand"))),
  booleanNot: functionOf(["operand"], translateOperator1(moduleName)(S.OpBooleanNot.value)(local("operand"))),
  numberNegate: functionOf(["operand"], translateOperator1(moduleName)(S.OpNumberNegate.value)(local("operand"))),
  arrayLength: functionOf(["array"], translateOperator1(moduleName)(S.OpArrayLength.value)(local("array"))),
  arrayAt: functionOf(["array", "index"], translateOperator2(moduleName)(S.OpArrayIndex.value)(local("array"))(local("index"))),
  stringLess: functionOf(["left", "right"], translateOperator2(moduleName)(new S.OpStringOrd(S.OpLt.value))(local("left"))(local("right"))),
  stringGreaterEqual: functionOf(["left", "right"], translateOperator2(moduleName)(new S.OpStringOrd(S.OpGte.value))(local("left"))(local("right"))),
};

const source = `
import java.util.*;
import java.util.function.*;
public final class LoopInvariantChecks {
  private static final List<String> events = new ArrayList<>();
  private static int checks;
  private static int failures;
  private static int attempts;
  private static int recovered;
  private static final IllegalArgumentException expectedFailure = new IllegalArgumentException("expected invariant failure");
  ${Object.entries({ ...definitions, ...legacyDefinitions }).map(([name, expression]) => `private static final Object ${name} = ${expression};`).join("\n  ")}
  private static Object note(String label, Object value) { events.add(label); return value; }
  private static Object failOnce() {
    attempts++;
    if (attempts == 1) throw expectedFailure;
    return 7;
  }
  @SuppressWarnings("unchecked") private static Object recover(Object value) {
    Supplier<Object> thunk = (Supplier<Object>) value;
    try { return thunk.get(); }
    catch (IllegalArgumentException exception) {
      if (exception != expectedFailure) throw exception;
      recovered++;
      return thunk.get();
    }
  }
  private static Object alwaysFail() { failures++; events.add("failure"); throw expectedFailure; }
  @SuppressWarnings("unchecked") private static Object apply(Object function, Object... arguments) {
    Object result = function;
    for (Object argument : arguments) result = ((Function<Object, Object>) result).apply(argument);
    return result;
  }
  private static void equal(String label, Object actual, Object expected) {
    checks++;
    if (!Objects.equals(actual, expected)) throw new AssertionError(label + ": " + actual + " != " + expected);
  }
  public static void main(String[] args) {
    equal("zero iterations", apply(basic, 0, 17), 17);
    equal("CodeGen unary cache references survive Rename", apply(Invariant_Fixtures.unaryLoop, 3, 1), -29);
    equal("CodeGen array index cache survives Rename", apply(Invariant_Fixtures.indexLoop, 3, 1), 61);
    equal("legacy unary negation", apply(negate, 42), -42);
    equal("legacy negation overflow", apply(negate, Integer.MIN_VALUE), Integer.MIN_VALUE);
    equal("legacy bitwise complement", apply(complement, 42), -43);
    equal("legacy boolean negation", apply(booleanNot, false), true);
    equal("legacy Number negation", apply(numberNegate, 1.25), -1.25);
    equal("legacy Number signed zero", apply(numberNegate, 0.0), -0.0);
    Object[] array = new Object[]{10, 20, 30};
    equal("legacy array length", apply(arrayLength, (Object) array), 3);
    equal("legacy array indexing", apply(arrayAt, array, 1), 20);
    try { apply(arrayAt, array, 3); throw new AssertionError("array bounds check disappeared"); }
    catch (ArrayIndexOutOfBoundsException expected) { checks++; }
    equal("legacy String less", apply(stringLess, "a", "b"), true);
    equal("legacy String equal is not less", apply(stringLess, "same", "same"), false);
    equal("legacy String greater-or-equal", apply(stringGreaterEqual, "same", "same"), true);
    equal("zero iterations do not force invariant", events, List.of());
    Object partial = apply(basic, 3);
    equal("partial application does not force invariant", events, List.of());
    equal("first complete application", apply(partial, 0), 21);
    equal("one evaluation for three iterations", events, List.of("value"));
    equal("reuse of partial application", apply(partial, 1), 22);
    equal("cache is per fully applied call", events, List.of("value", "value"));
    events.clear();
    equal("ordered result", apply(ordered, 2, 0, 0), 14);
    equal("invariant stays at its first evaluation point", events, List.of("counter", "value", "after", "counter", "after"));
    events.clear();
    equal("guard never uses invariant", apply(guarded, 1, 5), 5);
    equal("guard prevents evaluation", events, List.of());
    equal("guarded use", apply(guarded, 4, 5), 12);
    equal("guarded expression evaluated once", events, List.of("guarded-value"));
    events.clear();
    equal("two invariant values", apply(twoValues, 3, 0), 36);
    equal("first use determines order, not declarations", events, List.of("right", "left"));
    events.clear();
    equal("negative counter progresses to zero", apply(negative, -2, 10), 16);
    equal("negative loop evaluates once", events, List.of("negative"));
    events.clear();
    equal("accumulator overflow preserved", apply(basic, 2, Integer.MAX_VALUE - 3), (Integer.MAX_VALUE - 3) + 14);
    equal("overflow still uses one value", events, List.of("value"));
    events.clear();
    equal("counter overflow preserved", apply(counterOverflow, Integer.MAX_VALUE, 0), 7);
    equal("counter overflow computes once", events, List.of("overflow"));
    equal("counter overflow exit branch", apply(counterOverflow, Integer.MIN_VALUE, 9), 9);
    equal("exit branch does not compute again", events, List.of("overflow"));
    attempts = 0;
    recovered = 0;
    equal("retry after failed evaluation", apply(retry, 3, 0), 21);
    equal("only successful evaluation populates cache", attempts, 2);
    equal("exception was observable to the caller", recovered, 1);
    events.clear();
    for (int run = 0; run < 2; run++) {
      try { apply(failure, 3, 0); throw new AssertionError("exception was swallowed"); }
      catch (IllegalArgumentException exception) { equal("exception identity", exception, expectedFailure); }
    }
    equal("each failed call evaluates independently", failures, 2);
    equal("failure preserves preceding evaluation order", events, List.of("before-failure", "failure", "before-failure", "failure"));
    events.clear();
    Object capturedPartial = apply(captured, 11, 2);
    equal("captured partial remains deferred", events, List.of());
    equal("captured argument", apply(capturedPartial, 1), 23);
    equal("reused captured argument", apply(capturedPartial, 2), 24);
    equal("captured cache created by final call", events, List.of("captured", "captured"));
    events.clear();
    equal("nested loop result", apply(nested, 3, 0), 15);
    equal("inner cache recreated for every inner call", events, List.of("outer", "inner", "inner", "inner"));
    System.out.println("Loop invariants: " + checks + " cache behavior checks passed");
  }
}
`;
const tcoLoopSource = `public final class TcoLoop extends RuntimeException {
  public final String loopId; public final Object[] args;
  public TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
  @Override public synchronized Throwable fillInStackTrace() { return this; }
}`;
const directory = mkdtempSync(join(tmpdir(), "javapurs-loop-invariants-test-"));
try {
  writeFileSync(join(directory, "LoopInvariantChecks.java"), source);
  writeFileSync(join(directory, "TcoLoop.java"), tcoLoopSource);
  writeFileSync(join(directory, "__IntFn.java"), runtimeSource);
  writeFileSync(join(directory, "Invariant_Fixtures.java"), unaryModuleSource);
  execFileSync(javac, ["-nowarn", "LoopInvariantChecks.java", "TcoLoop.java", "Invariant_Fixtures.java"], { cwd: directory, stdio: "inherit", timeout: 60000 });
  execFileSync(java, ["-cp", directory, "LoopInvariantChecks"], { stdio: "inherit", timeout: 60000 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
