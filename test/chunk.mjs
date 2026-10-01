import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import { Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { chunkFile } from "../output/Javapurs.Chunk/index.js";
import { printFile } from "../output/Javapurs.Printer/index.js";
import { renameExpr } from "../output/Javapurs.Rename/index.js";

// Build the backend first, then run: node test/chunk.mjs
// These fixtures force extraction and execute the resulting Java, including
// nested captures, typed call sites, evaluation order and recursive closures.
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = value => new A.JavaRaw(String(value));
const local = name => new A.JavaLocal(name);
const int = expr => new A.JavaCast("int", expr);
const add = (left, right) => new A.JavaBinaryOp("+", int(left), int(right));
const abs = (args, body) => new A.JavaAbs(args, body);
const array = (expr, length = 300) => new A.JavaArray(Array.from({ length }, () => expr));
const block = (statements, result) => new A.JavaBlock(statements, result);
const assign = (name, value) => new A.JavaAssign(name, value);
const call = (name, args = []) => new A.JavaCall(new A.JavaGlobalVar(Nothing.value, name), args);
const apply = (fn, value) => new A.JavaApply(fn, value);
const pairs = entries => entries.map(([name, value]) => new Tuple(name, value));
const sum = (value, count) => Array.from({ length: count }, () => value).reduce(add, raw(0));
const chunk = decls => chunkFile({ decls: decls.map(renameExpr), recordShapes: [] });
const helpers = file => file.decls.filter(decl => decl instanceof A.JavaStaticMethod && decl.value0.startsWith("__chunk$"));

const closedBlock = chunk([assign("closedBlock", block([
  new A.JavaLocalAssign("x", raw(10)),
  ...Array.from({ length: 100 }, (_, i) => new A.JavaLocalAssign(`y${i}`, add(local("x"), raw(i)))),
], local("y99")))]);
assert.ok(helpers(closedBlock).some(helper => helper.value1.length === 0),
  "a large block with only internally bound locals must be extracted");

// An inner helper reads three locals. Its call must still advertise all three
// captures when the enclosing array is extracted again (the former regression).
const nested = chunk([assign("nested", abs(["outer"],
  new A.JavaLet("saved", add(local("outer"), raw(1)), abs(["inner"],
    array(array(add(add(local("outer"), local("saved")), local("inner")), 30), 70)))))]);
assert.ok(helpers(nested).length > 70, "exercise a second level of extraction");

const branch = value => block([new A.JavaLocalAssign("value", raw(value))], array(local("value")));
const scoped = chunk([assign("scoped", abs(["value"], block([
  new A.JavaLocalAssign("selected", new A.JavaTernary(
    new A.JavaBinaryOp("==", int(local("value")), raw(0)), branch(7), branch(11))),
], new A.JavaArray([local("selected"), local("value")]))))]);

const typed = chunk([
  new A.JavaStaticMethod("worker", pairs([["n", A.ParamInt.value]]), sum(local("n"), 160)),
  assign("workerCall", abs(["n"], call("worker", [int(local("n"))]))),
  assign("typedLambda", new A.JavaTypedAbs(pairs([["n", A.ParamInt.value]]), array(local("n")))),
  assign("intLambda", new A.JavaIntAbs("n", sum(local("n"), 160))),
  assign("intLocal", block([new A.JavaIntLocalAssign("n", raw(42))], array(local("n")))),
]);
assert.ok(helpers(typed).some(helper => helper.value1.some(param => param.value1 instanceof A.ParamInt)),
  "primitive locals and worker parameters keep primitive helper signatures");

// Unknown raw Java can contain captures which are invisible in the structural AST.
const rawCapture = chunk([assign("rawCapture", abs(["hidden"],
  raw(Array.from({ length: 140 }, () => "((int) hidden)").join(" + "))))]);
assert.equal(helpers(rawCapture).length, 0, "raw local reads must not be lifted as closed values");

// The recursive binding is a field of LetRecScope while its closure is created.
// Passing that field into a helper at initialization would freeze its null value.
const recValue = abs(["n"], new A.JavaTernary(
  new A.JavaBinaryOp("==", int(local("n")), raw(0)),
  raw(9),
  new A.JavaArrayIndex(array(apply(local("self"), raw(0))), raw(299)),
));
const recursive = chunk([assign("recursive", new A.JavaLetRec(pairs([["self", recValue]]),
  array(local("self"))))]);

// Extracting a block which mutates an outer local must not turn the write into
// an assignment to a helper's copy of the parameter. The printer flattens this
// tail branch into the same method as the outer declaration.
const mutate = block([
  ...Array.from({ length: 100 }, () => new A.JavaLocalSet("value", add(local("value"), raw(1)))),
], local("value"));
const mutation = chunk([assign("mutation", abs(["flag"], block([
  new A.JavaLocalAssign("value", raw(1)),
], new A.JavaTernary(local("flag"), mutate, local("value"))))) ]);

// A closed array group must run only once, preserving effect order and identity.
const effects = chunk([assign("effects", abs([], new A.JavaArray(
  Array.from({ length: 300 }, (_, i) => call("ChunkRuntime.note", [raw(i)])),
)))]);
const shortCircuit = chunk([assign("shortCircuit", abs(["flag"], new A.JavaTernary(
  local("flag"), array(call("ChunkRuntime.fail"), 100), raw(17),
)))]);

// Small blocks can still form a deeply nested anonymous-class expression.
// A flat node budget alone leaves javac copying scopes at every nested Supplier.
let nestedBlocks = raw(0);
for (let i = 0; i < 80; i++) {
  nestedBlocks = call("ChunkRuntime.identity", [block([
    new A.JavaLocalAssign("previous", nestedBlocks),
  ], add(local("previous"), local("n")))]);
}
const scopes = chunk([assign("scopes", abs(["n"], nestedBlocks))]);

const loopBody = (id, result) => new A.JavaTernary(
  new A.JavaBinaryOp(">", int(local("__final_n")), raw(0)),
  block([new A.JavaLocalAssign("values", array(local("__final_n")))],
    new A.JavaContinue(id, [add(new A.JavaArrayIndex(local("values"), raw(299)), raw(-1))])),
  result,
);
const loops = chunk([
  assign("loop", abs(["n"], new A.JavaWhileTrue("loop", ["n"], ["n"], loopBody("loop", local("__final_n"))))),
  assign("memoized", abs(["n"], new A.JavaMemoizedLoop("memo", ["n"], ["n"],
    pairs([["cached", sum(local("n"), 80)]]), loopBody("memo", new A.JavaLoopInvariant("cached"))))),
]);

const fixtures = { ClosedBlock: closedBlock, Nested: nested, Scoped: scoped, Typed: typed,
  RawCapture: rawCapture, Recursive: recursive, Mutation: mutation, Effects: effects, ShortCircuit: shortCircuit,
  Scopes: scopes, Loops: loops };
const directory = mkdtempSync(join(tmpdir(), "javapurs-chunk-"));
try {
  for (const [name, file] of Object.entries(fixtures)) {
    writeFileSync(join(directory, `${name}.java`), printFile(name)(file));
  }
  writeFileSync(join(directory, "ChunkRuntime.java"), `
import java.util.*;
import java.util.function.*;
public final class ChunkRuntime {
  static final List<Integer> events = new ArrayList<>();
  static final IllegalStateException failure = new IllegalStateException("expected");
  public static Object note(Object value) { events.add((Integer)value); return new Object[]{value}; }
  public static Object identity(Object value) { return value; }
  public static Object fail() { throw failure; }
  static Object apply(Object fn, Object value) { return ((Function<Object,Object>)fn).apply(value); }
  static void equal(Object actual, Object expected) {
    if (!Objects.equals(actual, expected)) throw new AssertionError(actual + " != " + expected);
  }
  static void elements(Object result, int count, Object expected) {
    Object[] values = (Object[])result;
    equal(values.length, count);
    for (Object value : values) equal(value, expected);
  }
  public static void main(String[] args) {
    equal(ClosedBlock.closedBlock, 109);
    Object[] nested = (Object[])apply(apply(Nested.nested, 2), 5);
    equal(nested.length, 70);
    for (Object row : nested) elements(row, 30, 10);
    for (int input : new int[]{0, 1}) {
      Object[] result = (Object[])apply(Scoped.scoped, input);
      elements(result[0], 300, input == 0 ? 7 : 11);
      equal(result[1], input);
    }
    equal(apply(Typed.workerCall, 3), 480);
    equal(apply(Typed.intLambda, 3), 480);
    elements(apply(Typed.typedLambda, 23), 300, 23);
    elements(Typed.intLocal, 300, 42);
    equal(apply(RawCapture.rawCapture, 3), 420);
    for (Object fn : (Object[])Recursive.recursive) equal(apply(fn, 1), 9);
    equal(apply(Mutation.mutation, true), 101);
    equal(apply(Mutation.mutation, false), 1);
    Object[] effects = (Object[])((Supplier<?>)Effects.effects).get();
    equal(effects.length, 300);
    equal(events.size(), 300);
    Set<Object> identities = Collections.newSetFromMap(new IdentityHashMap<>());
    for (int i = 0; i < 300; i++) {
      equal(events.get(i), i);
      equal(((Object[])effects[i])[0], i);
      identities.add(effects[i]);
    }
    equal(identities.size(), 300);
    equal(apply(ShortCircuit.shortCircuit, false), 17);
    try { apply(ShortCircuit.shortCircuit, true); throw new AssertionError("missing failure"); }
    catch (IllegalStateException ex) { if (ex != failure) throw ex; }
    equal(apply(Scopes.scopes, 3), 240);
    equal(apply(Loops.loop, 5), 0);
    equal(apply(Loops.memoized, 5), 400);
    System.out.println("Chunk: 11 fixtures passed");
  }
}
interface __IntFn extends Function<Object,Object> {
  int applyAsInt(int value);
  default Object apply(Object value) { return applyAsInt((int)value); }
}
class TcoLoop extends RuntimeException {
  final String loopId;
  final Object[] args;
  TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
}
`);
  execFileSync(javac, ["--release", "17", "-d", directory, ...Object.keys(fixtures).map(name => join(directory, `${name}.java`)),
    join(directory, "ChunkRuntime.java")], { stdio: "pipe", timeout: 120_000 });
  const output = execFileSync(java, ["-cp", directory, "ChunkRuntime"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(output.trim(), "Chunk: 11 fixtures passed");
  process.stdout.write(output);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
