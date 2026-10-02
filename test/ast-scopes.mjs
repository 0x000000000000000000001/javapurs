import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { renameExpr, renameWith } from "../output/Javapurs.Rename/index.js";
import { isClosedValue } from "../output/Javapurs.Raw/index.js";
import { hasAnyContinue, hasDirectContinue, hasTargetContinue } from "../output/Javapurs.ControlFlow/index.js";
import { translateOperator2 } from "../output/Javapurs.Operators/index.js";
import { chunkFile } from "../output/Javapurs.Chunk/index.js";
import { printFile } from "../output/Javapurs.Printer/index.js";
import { runtimeSource } from "../output/Javapurs.IntFunctions/index.js";
import { tcoLoopSource } from "../output/Javapurs.Runtime/index.js";
import { runCommandSync } from "../tools/test-process.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// The mixed IR's boundaries: lexical declarations, selectors, raw text and
// control identities. Exercise Rename -> optional Chunk -> javac -> JVM.
const raw = value => new A.JavaRaw(String(value));
const local = name => new A.JavaLocal(name);
const int = value => new A.JavaCast("int", value);
const binary = (op, left, right) => new A.JavaBinaryOp(op, int(left), int(right));
const add = (left, right) => binary("+", left, right);
const choose = (condition, yes, no) => new A.JavaTernary(condition, yes, no);
const abs = (args, value) => new A.JavaAbs(args, value);
const block = (statements, value) => new A.JavaBlock(statements, value);
const call = (qualifier, name, args = []) => new A.JavaCall(
  new A.JavaStaticMethodRef(qualifier === null ? Nothing.value : new Just(qualifier), name), args);
const pairs = entries => entries.map(([name, value]) => new Tuple(name, value));
const divide = (left, right) => translateOperator2("ScopeFixtures")(new S.OpIntNum(S.OpDivide.value))(left)(right);
const modulo = (left, right) => translateOperator2("ScopeFixtures")(new S.OpIntNum(S.OpMod.value))(left)(right);
const walk = expression => [expression, ...A.children(expression).flatMap(walk)];

// Control has three different questions: direct tail, current method, any
// nested join targeting this identity. Conditions and indexes are operands too.
const jump = new A.JavaContinue("outer", [raw(0)]);
for (const operand of [choose(jump, raw(1), raw(2)), new A.JavaArrayIndex(local("array"), jump),
  new A.JavaCall(new A.JavaInstanceMethodRef(jump, "java.util.function.Supplier", "get"), [])]) {
  assert.equal(hasDirectContinue(operand), false);
  assert.equal(hasAnyContinue(operand), true);
  assert.equal(hasTargetContinue("outer")(operand), true);
}
for (const boundary of [abs([], jump), new A.JavaFunction(jump),
  new A.JavaWhileTrue("inner", [], [], jump), new A.JavaStaticMethod("method", [], jump)]) {
  assert.equal(hasAnyContinue(boundary), false);
  assert.equal(hasTargetContinue("outer")(boundary), true);
  assert.equal(hasTargetContinue("inner")(boundary), false);
}
assert.equal(hasDirectContinue(new A.JavaLet("value", raw(0), jump)), true);
assert.equal(hasDirectContinue(new A.JavaLet("value", jump, raw(0))), false);
assert.equal(isClosedValue("__M$Any.__lazy_get_value() + capture"), false,
  "a generated-looking method prefix does not prove raw text closed");
assert.equal(isClosedValue("null /* TODO: value */ + capture"), false,
  "text after a comment still has unknown captures");
assert.equal(isClosedValue("1-e"), false, "a subtraction can read the local e");
assert.equal(isClosedValue("new Object[1-e]"), false, "array dimensions can capture too");
for (const literal of ["0", "-2147483648", "1.0e-7", "-0.0", "Double.NaN", "new Object[300]"]) {
  assert.equal(isClosedValue(literal), true, `${literal}: generated closed form`);
}

// Field/method names, record labels and types are metadata, not local reads.
const metadata = new A.JavaArray([
  new A.JavaGlobalVar(new Just("Class"), "field"),
  new A.JavaCall(new A.JavaStaticMethodRef(new Just("Class"), "method"), [local("field")]),
  new A.JavaCall(new A.JavaInstanceMethodRef(local("field"), "Class", "method"), []),
  new A.JavaTypedRecordGet([new Tuple("field", A.RecordInt.value)], local("field"), "field"),
]);
const env = pairs([["field", "renamed"], ["method", "wrong"], ["Class", "wrong"]]);
const metadataRenamed = renameWith(env)(metadata);
assert.deepEqual(metadataRenamed.value0[0], metadata.value0[0]);
assert.deepEqual(metadataRenamed.value0[1].value0, metadata.value0[1].value0);
assert.equal(metadataRenamed.value0[2].value0.value0.value0, "renamed");
assert.equal(metadataRenamed.value0[2].value0.value2, "method");
assert.equal(metadataRenamed.value0[3].value2, "field");
assert.deepEqual(metadataRenamed.value0[3].value0, metadata.value0[3].value0);
assert.equal(renameWith(env)(new A.JavaAssign("field", local("field"))).value0, "field");

// A bottom-up rewrite must reach mutation operands and both sibling branches,
// without visiting the replacement again or rewriting their field metadata.
const mutation = new A.JavaIf(local("condition"),
  [new A.JavaFieldSet(local("object"), "Class", "field", A.ParamInt.value, local("value"))],
  [new A.JavaLocalSet("slot", local("value"))]);
let visits = 0;
const rewritten = A.rewriteBottomUp(expr => {
  if (expr instanceof A.JavaLocal && expr.value0 === "value") { visits++; return add(expr, raw(1)); }
  return expr;
})(mutation);
assert.equal(visits, 2);
assert.equal(rewritten.value1[0].value2, "field");
assert.equal(rewritten.value2[0].value0, "slot");

const initializer = abs(["x"], block([
  new A.JavaLocalAssign("x", add(local("x"), raw(1))),
  new A.JavaIntLocalAssign("x", add(local("x"), raw(1))),
], local("x")));
const letShadow = abs(["x"], new A.JavaLet("x", add(local("x"), raw(1)),
  new A.JavaArray([new A.JavaLet("x", add(local("x"), raw(1)), local("x")), local("x")])));
const branches = abs(["flag", "x", "out"], block([
  new A.JavaIf(local("flag"), [
    new A.JavaLocalAssign("x", add(local("x"), raw(1))),
    new A.JavaLocalSet("x", add(local("x"), raw(1))),
    new A.JavaArraySet(local("out"), raw(0), local("x")),
  ], [
    new A.JavaIntLocalAssign("x", add(local("x"), raw(3))),
    new A.JavaArraySet(local("out"), raw(0), local("x")),
  ]),
], new A.JavaArray([local("x"), new A.JavaArrayIndex(local("out"), raw(0))])));
const selectors = abs(["same", "length", "text"], new A.JavaArray([
  new A.JavaGlobalVar(Nothing.value, "same"),
  call(null, "same", [local("same")]),
  new A.JavaCall(new A.JavaInstanceMethodRef(local("text"), "String", "length"), []),
]));
const rawText = abs(["x"], raw('new Object[]{ x, "x", \'x\', ScopeFixtures.x, /* x */ x // x\n }'));
const recursive = new A.JavaLetRec(pairs([
  ["even", abs(["n"], choose(binary("==", local("n"), raw(0)), raw(true),
    new A.JavaApply(local("odd"), binary("-", local("n"), raw(1)))))],
  ["odd", abs(["n"], choose(binary("==", local("n"), raw(0)), raw(false),
    new A.JavaApply(local("even"), binary("-", local("n"), raw(1)))))],
]), new A.JavaArray([local("even"), local("odd")]));
const operandLoop = wrap => abs(["n"], new A.JavaWhileTrue("again", ["n"], ["n"],
  choose(binary("==", local("__final_n"), raw(0)), raw(42),
    wrap(new A.JavaContinue("again", [binary("-", local("__final_n"), raw(1))])))));
const conditionJump = operandLoop(jump => choose(jump, raw(1), raw(2)));
const indexJump = operandLoop(jump => new A.JavaArrayIndex(new A.JavaArray([raw(1)]), jump));
const shadowedTarget = operandLoop(jump => new A.JavaLet("again", raw(99), jump));
const nestedJump = operandLoop(jump => {
  const callback = abs([], new A.JavaLet("again", raw(99), jump));
  const innerBody = choose(binary("==", local("__final_innerN"), raw(0)),
    new A.JavaCall(new A.JavaInstanceMethodRef(callback, "java.util.function.Supplier", "get"), []),
    new A.JavaContinue("inner", [binary("-", local("__final_innerN"), raw(1))]));
  return new A.JavaLet("innerN", raw(1), new A.JavaWhileTrue("inner", ["innerN"], ["innerN"], innerBody));
});
// The initializer reads the outer value go, while its loop and continue use
// the new local function's control identity. Value and target environments differ.
const localLoop = abs(["go"], block([
  new A.JavaLocalAssign("go", abs(["n"], new A.JavaWhileTrue("go", ["n"], ["n"],
    choose(binary("==", local("__final_n"), raw(0)), local("go"),
      new A.JavaContinue("go", [binary("-", local("__final_n"), raw(1))]))))),
], new A.JavaApply(local("go"), raw(3))));
const localLoopRenamed = renameExpr(localLoop);
const localLoopDeclaration = localLoopRenamed.value1.value0[0];
const localLoopBody = localLoopDeclaration.value1.value1;
assert.equal(localLoopBody.value0, localLoopDeclaration.value0);
assert.equal(localLoopBody.value3.value1.value0, localLoopRenamed.value0[0]);
assert.equal(localLoopBody.value3.value2.value0, localLoopBody.value0);

// Large arithmetic trees can now advertise their local captures to Chunk.
// The outer block still evaluates each source operand once, left before right.
const numeric = abs(["x", "y"], new A.JavaArray(Array.from({ length: 90 }, (_, index) =>
  (index % 2 === 0 ? divide : modulo)(local("x"), local("y")))));
const mark = (label, value) => call("AstScopeRegression", "mark", [new A.JavaString(label), value]);
const numericOnce = abs(["y"], new A.JavaArray([
  divide(mark("left", raw(-7)), mark("right", local("y"))),
  modulo(mark("mod-left", raw(-7)), mark("mod-right", local("y"))),
]));
const numericThrow = abs([], divide(call("AstScopeRegression", "fail"), mark("unreachable", raw(3))));
assert.ok(walk(divide(local("x"), local("y"))).some(expr => expr instanceof A.JavaLocal && expr.value0 === "__div_l"));
assert.ok(!walk(divide(local("x"), local("y"))).some(expr => expr instanceof A.JavaRaw && expr.value0.includes("__div_")));

const fixtures = { initializer, letShadow, branches, selectors, rawText, recursive, conditionJump, indexJump, shadowedTarget, nestedJump, localLoop, numeric, numericOnce, numericThrow };
const original = { recordShapes: [], decls: [
  new A.JavaAssign("same", raw(17)), new A.JavaAssign("x", raw(23)),
  new A.JavaStaticMethod("same", pairs([["value", A.ParamObject.value]]), local("value")),
  ...Object.entries(fixtures).map(([name, value]) => new A.JavaAssign(name, value)),
] };
const renamed = { ...original, decls: original.decls.map(renameExpr) };
const chunked = chunkFile(renamed);
assert.ok(chunked.decls.some(decl => decl instanceof A.JavaStaticMethod && decl.value0.startsWith("__chunk$")));
const rawField = file => file.decls.find(decl => decl instanceof A.JavaAssign && decl.value0 === "rawText");
assert.deepEqual(rawField(chunked), rawField(renamed), "open raw text remains an extraction barrier");

const harness = `public class AstScopeRegression {
  static final StringBuilder trace = new StringBuilder();
  static int checks;
  public static Object mark(String label, Object value) { trace.append(label).append(','); return value; }
  public static Object fail() { trace.append("fail,"); throw new IllegalStateException("expected"); }
  static Object apply(Object function, Object... values) {
    Object result = function;
    for (Object value : values) result = ((java.util.function.Function<Object,Object>)result).apply(value);
    return result;
  }
  static void equal(Object actual, Object expected) {
    checks++;
    if (!java.util.Objects.deepEquals(actual, expected)) throw new AssertionError(actual + " != " + expected);
  }
  public static void main(String[] args) {
    equal(apply(ScopeFixtures.initializer, 10), 12);
    equal(apply(ScopeFixtures.letShadow, 10), new Object[]{12, 11});
    equal(apply(ScopeFixtures.branches, true, 10, new Object[]{0}), new Object[]{10, 12});
    equal(apply(ScopeFixtures.branches, false, 10, new Object[]{0}), new Object[]{10, 13});
    equal(apply(ScopeFixtures.selectors, 7, 99, "hello"), new Object[]{17, 7, 5});
    equal(apply(ScopeFixtures.rawText, 11), new Object[]{11, "x", 'x', 23, 11});
    Object[] parity = (Object[]) ScopeFixtures.recursive;
    equal(apply(parity[0], 30), true);
    equal(apply(parity[1], 30), false);
    equal(apply(ScopeFixtures.conditionJump, 5000), 42);
    equal(apply(ScopeFixtures.indexJump, 5000), 42);
    equal(apply(ScopeFixtures.shadowedTarget, 5000), 42);
    equal(apply(ScopeFixtures.nestedJump, 5000), 42);
    equal(apply(ScopeFixtures.localLoop, 7), 7);
    Object[] numeric = (Object[]) apply(ScopeFixtures.numeric, -7, -3);
    equal(numeric.length, 90);
    for (int i = 0; i < numeric.length; i++) equal(numeric[i], i % 2 == 0 ? 3 : 2);
    for (int divisor : new int[]{3, 0}) {
      trace.setLength(0);
      equal(apply(ScopeFixtures.numericOnce, divisor), divisor == 0 ? new Object[]{0, 0} : new Object[]{-3, 2});
      equal(trace.toString(), "left,right,mod-left,mod-right,");
    }
    trace.setLength(0);
    try { ((java.util.function.Supplier<?>)ScopeFixtures.numericThrow).get(); throw new AssertionError("missing failure"); }
    catch (IllegalStateException expected) { equal(expected.getMessage(), "expected"); }
    equal(trace.toString(), "fail,");
    System.out.println("AST scopes: " + checks + " runtime checks passed");
  }
}`;

const { javac, java } = resolveJavaTools();
for (const [mode, file] of [["renamed", renamed], ["chunked", chunked]]) {
  await withTemporaryDirectory("javapurs-ast-scopes-", directory => {
    const sources = { "ScopeFixtures.java": printFile("ScopeFixtures")(file), "AstScopeRegression.java": harness,
      "__IntFn.java": runtimeSource, "TcoLoop.java": tcoLoopSource };
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(directory, name), source);
    runCommandSync(javac, ["--release", "17", "-d", directory, ...Object.keys(sources).map(name => join(directory, name))],
      { stdio: "pipe", timeout: 60_000 });
    const output = runCommandSync(java, ["-cp", directory, "AstScopeRegression"], { encoding: "utf8", timeout: 30_000 });
    console.log(`${mode}: ${output.trim()}`);
  });
}
