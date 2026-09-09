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
import { directCalls } from "../output/Javapurs.DirectCalls/index.js";
import { translateWithDirectCalls } from "../output/Javapurs.CodeGen/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { printRecordShape } from "../output/Javapurs.RecordPrinter/index.js";
import { recordClassName } from "../output/Javapurs.RecordShapes/index.js";
import { renameExpr } from "../output/Javapurs.Rename/index.js";

// Build the backend first. Optional real optimized input:
// node test/direct-calls.mjs --rbtree-project ../../altbak.pub-javapurs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const moduleName = "Direct_Fixtures";
const raw = value => new A.JavaRaw(String(value));
const local = name => new A.JavaLocal(name);
const integer = value => new A.JavaCast("int", value);
const binary = (op, a, b) => new A.JavaBinaryOp(op, integer(a), integer(b));
const add = (a, b) => binary("+", a, b);
const abs = (args, body) => new A.JavaAbs(args, body);
const global = (name, module = moduleName) => new A.JavaGlobalVar(module === null ? Nothing.value : new Just(module), name);
const apply = (fn, args) => args.reduce((result, arg) => new A.JavaApply(result, arg), fn);
const invoke = (name, args) => new A.JavaCall(raw(name), args);
const note = (label, value) => invoke("DirectRuntime.note", [new A.JavaString(label), value]);
const assign = (name, value) => new A.JavaAssign(name, value);
const fields = pairs => pairs.map(([key, value]) => new Tuple(key, value));
const layout = fields([["n", A.RecordInt.value]]);
const fixture = (name, body) => assign(name, abs(["ignored"], body));
const pairBody = add(binary("*", local("a"), raw(10)), local("b"));
const wide = count => abs(Array.from({ length: count }, (_, i) => `arg${i}`), local(`arg${count - 1}`));

function nodes(value, constructor, result = []) {
  if (!value || typeof value !== "object") return result;
  if (value instanceof constructor) result.push(value);
  for (const child of Object.values(value)) nodes(child, constructor, result);
  return result;
}
const declaration = (file, name) => file.decls.find(decl =>
  (decl instanceof A.JavaAssign || decl instanceof A.JavaLazyAssign) && decl.value0 === name);
const calls = expression => nodes(expression, A.JavaCall).filter(call =>
  call.value0 instanceof A.JavaGlobalVar && call.value0.value1.startsWith("__direct$"));
function worker(file, name) {
  const field = declaration(file, name);
  if (!(field instanceof A.JavaAssign)) return undefined;
  let body = field.value1;
  while (body instanceof A.JavaAbs) body = body.value1;
  const target = body instanceof A.JavaCall && body.value0 instanceof A.JavaGlobalVar ? body.value0.value1 : null;
  return file.decls.find(decl => decl instanceof A.JavaStaticMethod && decl.value0 === target);
}

const original = { recordShapes: [layout], decls: [
  // During this initializer, future is still null. Rewriting the call inside
  // the immediately forced Supplier would incorrectly bypass initialization.
  assign("early", invoke("DirectRuntime.observe", [abs([], apply(global("future"), [note("early-a", raw(1)), note("early-b", raw(2))]))])),
  assign("reentrantEarly", invoke("DirectRuntime.observe", [abs([], apply(invoke("__lazy_get_reentrant", []), [raw(0)]))])),
  assign("pair", abs(["a", "b"], pairBody)),
  assign("nested", abs(["a"], abs(["b"], add(local("a"), local("b"))))),
  assign("constant", abs(["a", "unused"], local("a"))),
  assign("returner", abs(["a", "b"], new A.JavaLet("saved", note("body", add(local("a"), local("b"))),
    abs(["c"], add(local("saved"), local("c")))))),
  assign("middle", abs(["a"], new A.JavaLet("saved", note("middle", local("a")),
    abs(["b"], add(local("saved"), local("b")))))),
  assign("scoped", abs(["x", "unused"], new A.JavaLet("saved", local("x"),
    abs(["x"], add(local("saved"), local("x")))))),
  assign("castPair", abs(["a", "b"], add(local("a"), local("b")))),
  assign("throwPair", abs(["a", "b"], invoke("DirectRuntime.fail", []))),
  assign("recordPlus", abs(["r", "delta"], new A.JavaTypedRecordUpdate(layout, local("r"), fields([
    ["n", add(new A.JavaTypedRecordGet(layout, local("r"), "n"), local("delta"))],
  ])))),
  assign("alias", global("pair")),
  new A.JavaRaw("public static final Object imported = DirectRuntime.foreignPair;"),
  assign("scope", abs(["pair", "x"], apply(local("pair"), [local("x"), raw(2)]))),
  new A.JavaLazyAssign("lazy", abs(["a", "b"], apply(global("pair"), [local("a"), local("b")]))),
  new A.JavaLazyAssign("reentrant", abs(["ignored"], apply(global("pair"), [note("reentrant-a", raw(1)), note("reentrant-b", raw(2))]))),
  assign("zero", abs([], raw(7))),
  assign("unary", abs(["a"], local("a"))),
  assign("arity32", wide(32)),
  assign("arity33", wide(33)),
  fixture("saturated", apply(global("pair"), [note("a", raw(4)), note("b", raw(2))])),
  fixture("over", apply(global("returner"), [note("a", raw(1)), note("b", raw(2)), note("c", raw(3))])),
  fixture("middleCall", apply(global("middle"), [note("a", raw(1)), note("b", raw(2))])),
  fixture("castFailure", apply(global("castPair"), [note("a", new A.JavaString("wrong")), note("b", raw(2))])),
  fixture("argumentFailure", apply(global("pair"), [invoke("DirectRuntime.fail", []), note("b", raw(2))])),
  fixture("bodyFailure", apply(global("throwPair"), [note("a", raw(1)), note("b", raw(2))])),
  fixture("foreignCall", apply(global("foreignPair", "DirectRuntime"), [raw(4), raw(2)])),
  fixture("unknownCall", apply(global("imported"), [raw(4), raw(2)])),
  fixture("aliasCall", apply(global("alias"), [raw(4), raw(2)])),
  fixture("unqualified", apply(global("pair", null), [raw(4), raw(2)])),
  fixture("recordCall", apply(global("recordPlus"), [new A.JavaTypedRecord(layout, fields([["n", raw(3)]])), raw(4)])),
  assign("future", abs(["a", "b"], add(local("a"), local("b")))),
  fixture("selectedCalls", new A.JavaArray([
    apply(global("nested"), [raw(3), raw(4)]),
    apply(global("constant"), [raw(7), raw("null")]),
    apply(global("scoped"), [raw(4), raw("null"), raw(5)]),
    apply(global("scope"), [global("foreignPair", "DirectRuntime"), raw(4)]),
    apply(global("arity32"), Array.from({ length: 32 }, (_, i) => raw(i))),
    apply(global("future"), [raw(1), raw(2)]),
    apply(global("arity33"), Array.from({ length: 33 }, (_, i) => raw(i))),
  ])),
] };

const optimized = directCalls(moduleName)(original);
for (const name of ["pair", "nested", "constant", "returner", "scoped", "castPair", "throwPair", "recordPlus", "scope", "arity32", "future"]) {
  assert.ok(worker(optimized, name), `${name}: extract the contiguous multi-argument lambda prefix`);
  assert.ok(declaration(optimized, name).value1 instanceof A.JavaAbs, `${name}: keep the public curried field`);
}
for (const name of ["middle", "alias", "lazy", "zero", "unary", "arity33"]) {
  assert.equal(worker(optimized, name), undefined, `${name}: not an eligible nonrecursive lambda`);
}
assert.equal(worker(optimized, "returner").value1.length, 2, "a computation before the returned lambda stops flattening");
assert.equal(calls(declaration(optimized, "saturated")).length, 1);
assert.equal(calls(declaration(optimized, "over")).length, 1);
assert.ok(declaration(optimized, "over").value1.value1 instanceof A.JavaApply,
  "surplus argument applies to the guarded worker result, after the prefix body");
assert.equal(calls(declaration(optimized, "lazy")).length, 1, "a lazy body may call an earlier nonrecursive worker");
for (const name of ["early", "middleCall", "foreignCall", "unknownCall", "aliasCall"]) {
  assert.equal(calls(declaration(optimized, name)).length, 0, `${name}: retain ordinary application`);
}
assert.equal(calls(worker(optimized, "scope")).length, 0, "a local callback with the same name as a global is not that global");
assert.equal(calls(declaration(optimized, "unqualified")).length, 1, "an unqualified global names the current module");
assert.equal(nodes(worker(optimized, "recordPlus"), A.JavaTypedRecordUpdate).length, 1);
assert.deepEqual(optimized.recordShapes, original.recordShapes);
assert.equal(nodes(original, A.JavaStaticMethod).length, 0, "the pass must not mutate its input");

const ambiguous = directCalls(moduleName)({ recordShapes: [], decls: [
  assign("duplicate", abs(["a", "b"], local("a"))),
  assign("duplicate", abs(["a", "b"], local("b"))),
  fixture("use", apply(global("duplicate"), [raw(1), raw(2)])),
  assign("shadowed", abs(["a"], abs(["a"], local("a")))),
] });
assert.equal(nodes(ambiguous, A.JavaStaticMethod).length, 0, "ambiguous globals and duplicate flattened parameters are rejected");

// Exercise the public CodeGen switch with actual typed BackendSyntax, including
// the closed record parameter information propagated before the Java pass.
const bLocal = (name, level) => new S.Local(new Just(name), level);
const bInt = value => new S.Lit(new C.LitInt(value));
const bVar = name => new S.Var(new C.Qualified(new Just("Direct.Typed"), name));
const bAbs = (names, body) => new S.Abs(names.map((name, level) => new Tuple(new Just(name), level)), body);
const recordType = new C.Record(new C.Row(fields([["n", C.Int.value]]), Nothing.value));
const recordUpdate = new S.Typed(new C.Func([recordType, C.Int.value], recordType),
  bAbs(["r", "n"], new S.Update(bLocal("r", 0), [new C.Prop("n", bLocal("n", 1))])));
const recordRun = bAbs(["n"], new S.App(bVar("update"), [
  new S.Typed(recordType, new S.Lit(new C.LitRecord([new C.Prop("n", bInt(0))]))), bLocal("n", 0),
]));
const backendModule = { name: "Direct.Typed", dataDecls: [], bindings: [
  { recursive: false, bindings: [new Tuple("update", recordUpdate)] },
  { recursive: false, bindings: [new Tuple("run", recordRun)] },
] };

let actualModule;
const projectFlag = process.argv.indexOf("--rbtree-project");
if (projectFlag >= 0) {
  assert.ok(process.argv[projectFlag + 1], "--rbtree-project requires an existing project directory");
  const project = resolve(process.argv[projectFlag + 1]);
  const { readPurmetaSync } = await import("../output/PureScript.Backend.Optimizer.Cache/index.js");
  const directory = process.cwd();
  let cache;
  try { process.chdir(project); cache = readPurmetaSync("Test.RBTree")(); }
  finally { process.chdir(directory); }
  assert.ok(cache instanceof Just, "build the project first to produce Test.RBTree.purmeta");
  const expressions = new Map();
  function collect(tree) {
    if (tree.constructor.name !== "Node") return;
    collect(tree.value4);
    if (tree.value3.value1.constructor.name === "ExternExpr") expressions.set(tree.value2.value1, tree.value3.value1.value1);
    collect(tree.value5);
  }
  collect(cache.value0);
  const names = ["depth", "balance", "ins", "insert", "buildTree"];
  const corefn = JSON.parse(readFileSync(join(project, "run/bak/java/output/Test.RBTree/corefn.json"), "utf8"));
  actualModule = { name: "Test.RBTree", dataDecls: corefn.dataDecls, bindings: names.map(name => {
    assert.ok(expressions.has(name), `real optimized ${name} implementation is missing`);
    return { recursive: ["depth", "ins", "buildTree"].includes(name), bindings: [new Tuple(name, expressions.get(name))] };
  }) };
}

const runtimeSource = `
import java.util.*;
import java.util.function.*;
public final class DirectRuntime {
  public static final List<String> events = new ArrayList<>();
  public static final IllegalArgumentException failure = new IllegalArgumentException("expected");
  public static final Object foreignPair = (Function<Object,Object>) a -> (Function<Object,Object>) b -> (int)a * 10 + (int)b;
  public static Object note(String label, Object value) { events.add(label); return value; }
  public static Object fail() { events.add("failure"); throw failure; }
  public static Object observe(Object thunk) {
    try { return ((Supplier<?>)thunk).get(); }
    catch (NullPointerException expected) { return "uninitialized"; }
  }
}
`;

const actualChecks = actualModule ? `
    int[][] sequences = {{3,2,1}, {3,1,2}, {1,3,2}, {1,2,3}, {5,-2,9,5,0,-7,8,4}};
    for (int[] values : sequences) {
      Object tree = Test_RBTree.__singleton$E.value;
      TreeSet<Integer> expected = new TreeSet<>();
      for (int value : values) { tree = apply(Test_RBTree.insert, value, tree); expected.add(value); }
      equal("real root is black", tree.getClass().getField("value0").get(tree).getClass().getSimpleName(), "B");
      List<Integer> ordered = new ArrayList<>();
      checkTree(tree, ordered, false);
      equal("real inorder traversal and duplicate insertion", ordered, new ArrayList<>(expected));
    }
    for (int n : new int[]{0,1,2,17,64}) {
      Object tree = apply(Test_RBTree.buildTree, n, Test_RBTree.__singleton$E.value);
      List<Integer> ordered = new ArrayList<>();
      checkTree(tree, ordered, false);
      equal("real buildTree size", ordered.size(), n);
      if (n > 0) equal("real buildTree upper bound", ordered.get(n - 1), n);
    }
` : "";

const checksSource = `
import java.util.*;
import java.util.function.*;
public final class DirectChecks {
  private static int checks;
  @SuppressWarnings("unchecked") static Object apply(Object fn, Object... args) {
    for (Object arg : args) fn = ((Function<Object,Object>)fn).apply(arg);
    return fn;
  }
  static void equal(String label, Object actual, Object expected) {
    checks++;
    if (!Objects.equals(actual, expected)) throw new AssertionError(label + ": " + actual + " != " + expected);
  }
  static void trace(String... labels) { equal("evaluation order", DirectRuntime.events, List.of(labels)); DirectRuntime.events.clear(); }
  static void failure(Object fn, boolean cast, String... labels) {
    try { apply(fn, 0); throw new AssertionError("exception was lost"); }
    catch (ClassCastException expected) { if (!cast) throw expected; checks++; }
    catch (IllegalArgumentException expected) { if (cast || expected != DirectRuntime.failure) throw expected; checks++; }
    trace(labels);
  }
  static int checkTree(Object tree, List<Integer> ordered, boolean redParent) throws Exception {
    if (tree.getClass().getSimpleName().equals("E")) return 1;
    boolean red = tree.getClass().getField("value0").get(tree).getClass().getSimpleName().equals("R");
    if (redParent && red) throw new AssertionError("consecutive red nodes");
    int left = checkTree(tree.getClass().getField("value1").get(tree), ordered, red);
    ordered.add((Integer)tree.getClass().getField("value2").get(tree));
    int right = checkTree(tree.getClass().getField("value3").get(tree), ordered, red);
    if (left != right) throw new AssertionError("unequal black heights");
    return left + (red ? 0 : 1);
  }
  public static void main(String[] args) throws Exception {
    equal("future field remains uninitialized during earlier initializer", Direct_Fixtures.early, "uninitialized");
    equal("later lazy getter respects an earlier uninitialized field", Direct_Fixtures.reentrantEarly, "uninitialized");
    trace("early-a", "reentrant-a");
    equal("reentrant getter works after initialization", apply(Direct_Fixtures.reentrant, 0), 12); trace("reentrant-a", "reentrant-b");
    Object partial = apply(Direct_Fixtures.pair, 4);
    equal("public partial application", apply(partial, 2), 42);
    equal("public partial reuse", apply(partial, 3), 43);
    equal("nested lambda prefix", apply(Direct_Fixtures.nested, 3, 4), 7);
    equal("unused null Object parameter", apply(Direct_Fixtures.constant, 7, null), 7);
    equal("saturated call", apply(Direct_Fixtures.saturated, 0), 42); trace("a", "b");
    equal("overapplication", apply(Direct_Fixtures.over, 0), 6); trace("a", "b", "body", "c");
    equal("calculation between lambdas", apply(Direct_Fixtures.middleCall, 0), 3); trace("a", "middle", "b");
    equal("captured and shadowed parameters after Rename", apply(Direct_Fixtures.scoped, 4, null, 5), 9);
    failure(Direct_Fixtures.castFailure, true, "a", "b");
    failure(Direct_Fixtures.argumentFailure, false, "failure");
    failure(Direct_Fixtures.bodyFailure, false, "a", "b", "failure");
    equal("foreign callable", apply(Direct_Fixtures.foreignCall, 0), 42);
    equal("unknown imported callable", apply(Direct_Fixtures.unknownCall, 0), 42);
    equal("alias remains callable", apply(Direct_Fixtures.aliasCall, 0), 42);
    equal("unqualified global", apply(Direct_Fixtures.unqualified, 0), 42);
    equal("local callback shadows global", apply(Direct_Fixtures.scope, DirectRuntime.foreignPair, 4), 42);
    equal("lazy function uses earlier worker", apply(Direct_Fixtures.lazy, 4, 2), 42);
    equal("zero arity Supplier preserved", ((Supplier<?>)Direct_Fixtures.zero).get(), 7);
    equal("unary function preserved", apply(Direct_Fixtures.unary, 8), 8);
    Object[] many = new Object[33]; Arrays.fill(many, 7); many[31] = 31; many[32] = 32;
    equal("maximum worker arity", apply(Direct_Fixtures.arity32, Arrays.copyOf(many, 32)), 31);
    equal("over-limit curried function", apply(Direct_Fixtures.arity33, many), 32);
    equal("generated direct calls and arity limit", Arrays.asList((Object[])apply(Direct_Fixtures.selectedCalls, 0)), List.of(7,7,9,42,31,3,32));
    equal("typed record through direct call", ((Map<?,?>)apply(Direct_Fixtures.recordCall, 0)).get("n"), 7);
    equal("real CodeGen typed record through direct call", ((Map<?,?>)apply(Direct_Typed.run, 19)).get("n"), 19);
    ${actualChecks}
    System.out.println("Direct calls: " + checks + " runtime checks passed");
  }
}
`;

const outputs = [];
for (const enabled of [false, true]) {
  const options = { typedRecords: true, loopInvariants: true, directCalls: enabled };
  const typedFile = translateWithDirectCalls(options)(backendModule);
  assert.equal(nodes(typedFile, A.JavaStaticMethod).length, enabled ? 1 : 0, "CodeGen must honor the direct-calls option");
  assert.equal(nodes(typedFile, A.JavaTypedRecordUpdate).length, 1, "direct lowering retains typed record operations");
  const files = new Map();
  function addFile(name, file) {
    files.set(`${name}.java`, `public final class ${name} {\n${file.decls.map(decl => printExpr(renameExpr(decl))).join("\n")}\n}`);
    for (const shape of file.recordShapes) files.set(`${recordClassName(shape)}.java`, printRecordShape(shape));
  }
  addFile(moduleName, enabled ? optimized : original);
  addFile("Direct_Typed", typedFile);
  if (actualModule) {
    const actual = translateWithDirectCalls(options)(actualModule);
    assert.equal(Boolean(worker(actual, "balance")), enabled, "the real optimized balance is eligible");
    assert.equal(calls(declaration(actual, "ins")).length, enabled ? 2 : 0, "the two real insertion branches call balance directly");
    assert.equal(Boolean(worker(actual, "ins")), false, "recursive lazy ins is not a worker candidate");
    addFile("Test_RBTree", actual);
    files.set("TcoLoop.java", `public final class TcoLoop extends RuntimeException {
      public final String loopId; public final Object[] args;
      public TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
      @Override public synchronized Throwable fillInStackTrace() { return this; }
    }`);
  }
  files.set("DirectRuntime.java", runtimeSource);
  files.set("DirectChecks.java", checksSource);
  const directory = mkdtempSync(join(tmpdir(), `javapurs-direct-${enabled ? "on" : "off"}-`));
  let success = false;
  try {
    for (const [name, source] of files) writeFileSync(join(directory, name), source);
    execFileSync(javac, ["-nowarn", ...files.keys()], { cwd: directory, encoding: "utf8", stdio: "pipe" });
    const output = execFileSync(java, ["-cp", directory, "DirectChecks"], { cwd: directory, encoding: "utf8", stdio: "pipe" }).trim();
    outputs.push(output);
    console.log(`${enabled ? "enabled" : "disabled"}: ${output}`);
    success = true;
  } catch (error) {
    console.error(`Generated Java retained for inspection: ${directory}`);
    if (error.stderr) console.error(String(error.stderr));
    throw error;
  } finally { if (success) rmSync(directory, { recursive: true, force: true }); }
}
assert.equal(outputs[0], outputs[1], "enabled and disabled variants must complete the same behavioral checks");
console.log(`Direct call eligibility and ${actualModule ? "real RBTree" : "typed CodeGen"} IR checks passed`);
