import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { printExpr, printFile } from "../output/Javapurs.Printer/index.js";
import { printRecordShape } from "../output/Javapurs.RecordPrinter/index.js";
import { recordClassName } from "../output/Javapurs.RecordShapes/index.js";
import { intFunctionSource, tcoLoopSource } from "../output/Javapurs.Runtime/index.js";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Direct printer contracts; run after ./bin/build. Expected text is constructed
// from UTF-16 code units in Java, independently of the printer's escaping rules.
const { javac, java, javacArgs } = resolveJavaTools();
const raw = value => new A.JavaRaw(String(value));
const local = name => new A.JavaLocal(name);
const call = (name, ...args) => new A.JavaCall(new A.JavaStaticMethodRef(Nothing.value, name), args);
const note = (label, value) => call("note", new A.JavaString(label), value);
const branch = (condition, yes, no) => new A.JavaTernary(condition, yes, no);
const block = (label, value) => new A.JavaBlock([new A.JavaLocalAssign("ignored", note(label, raw(0)))], value);
const samples = ["", "plain", 'quote " and \\ slash', "line\nreturn\rtab\t", "\0\b\f\u001f", "é Ω 中 😀", "\ud800", "\udfff", "literal \\u000a"];
const expectedString = value => `new String(new char[]{${Array.from({ length: value.length }, (_, i) => `(char)${value.charCodeAt(i)}`).join(",")}})`;
const fields = samples.map((label, index) => new Tuple(label, new A.JavaString(`value${index}`)));
const shape = samples.map(label => new Tuple(label, A.RecordObject.value));
const global = (module, name) => new A.JavaGlobalVar(new Just(`__M$${module}`), name);
const snapshot = local("__final_n");
const loop = (id, fallback = false) => {
  const next = new A.JavaContinue(id, [new A.JavaBinaryOp("-", new A.JavaCast("int", snapshot), raw(1))]);
  return new A.JavaWhileTrue(id, ["n"], ["n"], branch(
    new A.JavaBinaryOp("==", new A.JavaCast("int", snapshot), raw(0)), raw(42),
    new A.JavaBlock([new A.JavaLocalAssign("tick", note("tick", raw(0)))], fallback
      ? new A.JavaCall(new A.JavaInstanceMethodRef(next, "java.util.function.Supplier", "get"), []) : next),
  ));
};
const statementBody = branch(local("condition"), block("yes", raw(7)), block("no", raw(9)));
const declarations = [
  new A.JavaStaticMethod("worker", [new Tuple("condition", A.ParamObject.value)], statementBody),
  new A.JavaAssign("closure", new A.JavaAbs(["condition"], statementBody)),
  new A.JavaAssign("thunk", new A.JavaAbs([], block("thunk", raw(11)))),
  new A.JavaAssign("legacyThunk", new A.JavaFunction(note("legacy", raw(12)))),
  new A.JavaAssign("primitive", new A.JavaIntAbs("n", block("int", new A.JavaBinaryOp("+", local("n"), raw(1))))),
  new A.JavaAssign("loopFunction", new A.JavaAbs(["n"], loop("direct"))),
  new A.JavaAssign("loopThunk", new A.JavaAbs(["n"], new A.JavaAbs([], loop("deferred")))),
  new A.JavaAssign("map", new A.JavaRecord(fields)),
  new A.JavaAssign("typed", new A.JavaTypedRecord(shape, fields)),
  new A.JavaAssign("pureE", global("Effect", "pureE")),
  new A.JavaAssign("bindE", global("Effect", "bindE")),
  new A.JavaAssign("assertImpl", global("Test_Assert", "assertImpl")),
  new A.JavaAssign("concatString", global("Data_Semigroup", "concatString")),
];
const support = `
  static int checks;
  static final java.util.List<String> events = new java.util.ArrayList<>();
  static Object note(String label, Object value) { events.add(label); return value; }
  static Object apply(Object fn, Object... args) {
    for (Object arg : args) fn = ((java.util.function.Function<Object,Object>)fn).apply(arg);
    return fn;
  }
  static Object force(Object value) { return ((java.util.function.Supplier<Object>)value).get(); }
  static void equal(String label, Object actual, Object expected) {
    checks++;
    if (!java.util.Objects.equals(actual, expected)) throw new AssertionError(label + ": " + actual + " != " + expected);
  }
  static void events(String... expected) { equal("events", events, java.util.List.of(expected)); events.clear(); }
`;
const valueChecks = samples.map((value, index) => `
    equal("literal ${index}", ${printExpr(new A.JavaString(value))}, ${expectedString(value)});
    equal("Map read ${index}", ${printExpr(new A.JavaMapGet(local("map"), value))}, "value${index}");
    equal("typed read ${index}", ${printExpr(new A.JavaTypedRecordGet(shape, local("typed"), value))}, "value${index}");
    equal("Map update ${index}", ((java.util.Map<?,?>)(${printExpr(new A.JavaMapUpdate(local("map"), [new Tuple(value, raw(42))]))})).get(${expectedString(value)}), 42);
    equal("typed update ${index}", ((java.util.Map<?,?>)(${printExpr(new A.JavaTypedRecordUpdate(shape, local("typed"), [new Tuple(value, raw(42))]))})).get(${expectedString(value)}), 42);
  `).join("");
const valuesMain = `
  public static void main(String[] args) {
    events();
    equal("worker yes", worker(true), 7); events("yes");
    equal("worker no", worker(false), 9); events("no");
    equal("closure yes", apply(closure, true), 7); events("yes");
    equal("closure no", apply(closure, false), 9); events("no");
    equal("thunk first", force(thunk), 11); events("thunk");
    equal("thunk repeated", force(thunk), 11); events("thunk");
    equal("legacy deferred wrapper", force(legacyThunk), 12); events("legacy");
    equal("primitive block", apply(primitive, 41), 42); events("int");
    equal("direct loop", apply(loopFunction, 3), 42); events("tick", "tick", "tick");
    Object deferred = apply(loopThunk, 2); events();
    equal("deferred loop", force(deferred), 42); events("tick", "tick");
    equal("deferred loop repeated", force(deferred), 42); events("tick", "tick");
    Object action = apply(bindE, apply(pureE, 7),
      (java.util.function.Function<Object,Object>) n -> (java.util.function.Supplier<Object>) () -> note("bound", (int)n + 1));
    events(); equal("builtin bind/pure", force(action), 8); events("bound");
    equal("builtin concat", apply(concatString, "a", "b"), "ab");
    force(apply(assertImpl, "unused", true));
    try { force(apply(assertImpl, "expected", false)); throw new AssertionError("missing assertion"); }
    catch (RuntimeException failure) { equal("builtin assertion message", failure.getMessage(), "expected"); }
    ${valueChecks}
    equal("typed source order", new java.util.ArrayList<>(((java.util.Map<?,?>)typed).keySet()),
      java.util.List.of(${samples.map(expectedString).join(",")}));
    System.out.println("Printer values/bodies: " + checks + " checks passed");
  }
`;
const source = printFile("PrinterValues")({ recordShapes: [shape], decls: [...declarations, raw(support + valuesMain)] });
// A real function body can host statement branches without an immediate thunk.
assert.doesNotMatch(printExpr(declarations[0]), /Supplier/, "static method branches stay in their method");
assert.match(printExpr(declarations[2]), /Supplier/, "nullary abstraction remains deferred");
assert.match(printExpr(declarations[6]), /get\(\).*?return \(new java\.util\.function\.Supplier/s,
  "a deferred loop keeps the Supplier's expression boundary");

const messages = samples.map((message, index) => new A.JavaStaticMethod(`fail${index}`, [], new A.JavaThrow(message)));
const oddLoopId = 'outer"\\\n😀';
const messageChecks = samples.map((message, index) => `
    try { fail${index}(); throw new AssertionError("missing exception"); }
    catch (RuntimeException failure) { equal("message ${index}", failure.getMessage(), ${expectedString(message)}); }
  `).join("");
const messageSource = printFile("PrinterMessages")({ recordShapes: [], decls: [
  ...messages,
  new A.JavaAssign("loopFunction", new A.JavaAbs(["n"], loop(oddLoopId, true))),
  raw(support + `public static void main(String[] args) {
    ${messageChecks}
    equal("escaped target through TcoLoop", apply(loopFunction, 3), 42); events("tick", "tick", "tick");
    System.out.println("Printer messages/targets: " + checks + " checks passed");
  }`),
] });

for (const [name, contents, extras] of [
  ["PrinterValues", source, [[`${recordClassName(shape)}.java`, printRecordShape(shape)]]],
  ["PrinterMessages", messageSource, []],
]) {
  await withTemporaryDirectory("javapurs-printer-", directory => {
    const files = new Map([[`${name}.java`, contents], ["__IntFn.java", intFunctionSource], ["TcoLoop.java", tcoLoopSource], ...extras]);
    for (const [file, text] of files) writeFileSync(join(directory, file), text);
    runCommandSync(javac, [...javacArgs, "-nowarn", ...files.keys()], { cwd: directory, stdio: "pipe" });
    const output = runCommandSync(java, ["-Xss256k", "-cp", directory, name], { cwd: directory, encoding: "utf8", stdio: "pipe" });
    console.log(output.trim());
  });
}
