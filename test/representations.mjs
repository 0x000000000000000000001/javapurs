import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as PursMap from "../output/Data.Map/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { lowerModule } from "../output/Javapurs.Pipeline/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { printRecordShape } from "../output/Javapurs.RecordPrinter/index.js";
import { recordClassName } from "../output/Javapurs.RecordShapes/index.js";
import { intFunctionSource } from "../output/Javapurs.Runtime/index.js";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";
import { moduleClass, moduleText } from "./support/module-classes.mjs";

// The same BackendModule/FFI crosses all eight combinations. Assertions concern
// observable JVM values, layouts and public ABIs, not the shared type helpers.
const { javac, java, javacArgs } = resolveJavaTools();
const moduleName = "Representation.Contracts";
const className = moduleClass(moduleName.replaceAll(".", "_"));
const int = C.Int.value;
const any = C.Any.value;
const variable = new C.TypeVar("a");
const fn = new C.Func([int], int);
const poly = new C.ForAll(["a"], new C.Func([variable], variable));
const qualified = name => new C.Qualified(new Just(moduleName), name);
const reference = name => new S.Var(qualified(name));
const typed = (type, value) => new S.Typed(type, value);
const local = (name, level) => new S.Local(new Just(name), level);
const integer = n => new S.Lit(new C.LitInt(n));
const lambda = (name, level, body) => new S.Abs([new Tuple(new Just(name), level)], body);
const call = (head, ...args) => new S.App(head, args);
const add = (a, b) => new S.PrimOp(new S.Op2(new S.OpIntNum(S.OpAdd.value), a, b));
const prop = (record, name) => new S.Accessor(record, new S.GetProp(name));
const fields = entries => entries.map(([name, value]) => new C.Prop(name, value));
const literalRecord = entries => new S.Lit(new C.LitRecord(fields(entries)));
const row = (entries, tail = Nothing.value) => new C.Record(new C.Row(entries.map(([k, v]) => new Tuple(k, v)), tail));
const nestedType = row([["n", int]], new Just(new C.TypeVar("r")));
const recordType = row([["n", int], ["callback", fn], ["nested", nestedType]]);
const mixedFields = [int, variable, C.Boolean.value, C.Number.value, C.Char.value, new C.Array(int)];
const sumBody = lambda("a", 0, lambda("b", 1, lambda("c", 2,
  add(add(local("a", 0), local("b", 1)), local("c", 2)))));
const fixtures = {
  name: moduleName, foreign: PursMap.empty,
  dataDecls: [{ name: "Mixed", vars: ["a"], constructors: [{ name: "Mixed", fields: mixedFields }] }],
  bindings: [
    ["construct", new S.CtorDef(C.ProductType.value, "Mixed", "Mixed", mixedFields.map((_, i) => `value${i}`))],
    ["constructedInt", typed(new C.ADT(`${moduleName}.Mixed`, ["Representation", "Contracts", "Mixed"], [int]),
      new S.CtorSaturated(qualified("Mixed"), C.ProductType.value, "Mixed", "Mixed", [
        integer(7), integer(11), new S.Lit(new C.LitBoolean(true)), new S.Lit(new C.LitNumber(1.5)),
        new S.Lit(new C.LitChar("雪")), new S.Lit(new C.LitArray([integer(3)])),
      ].map((value, i) => new Tuple(`value${i}`, value))))],
    ["readIntField", typed(new C.Func([any], int), lambda("value", 0,
      new S.Accessor(local("value", 0), new S.GetCtorField(qualified("Mixed"), C.ProductType.value, "Mixed", "Mixed", "value0", 0))))],
    ["inc", typed(fn, lambda("x", 0, add(local("x", 0), integer(1))))],
    ["flatSum", typed(new C.Func([int, int, int], int), sumBody)],
    ["nestedSum", typed(new C.Func([int], new C.Func([int], fn)), sumBody)],
    ["partialSum", typed(fn, call(reference("nestedSum"), integer(10), integer(20)))],
    ["callSum", typed(fn, lambda("x", 0, call(reference("flatSum"), integer(10), integer(20), local("x", 0))))],
    ["polymorphic", typed(poly, lambda("x", 0, local("x", 0)))],
    ["instantiated", typed(fn, new S.TypeApp(reference("polymorphic"), int))],
    ["callInstantiated", typed(fn, lambda("x", 0, call(typed(fn,
      new S.TypeApp(reference("polymorphic"), int)), local("x", 0))))],
    ["constrained", typed(new C.ConstrainedType([new Tuple(["Example", "Unused"], [int])], fn),
      lambda("dictionary", 0, lambda("x", 1, local("x", 1))))],
    ["record", typed(recordType, literalRecord([
      ["nested", typed(nestedType, literalRecord([["n", integer(2)], ["extra", integer(3)]]))],
      ["callback", reference("inc")], ["n", integer(40)],
    ]))],
    ["readAndCall", typed(new C.Func([recordType], int), lambda("r", 0,
      call(prop(local("r", 0), "callback"), prop(local("r", 0), "n"))))],
    ["update", typed(new C.Func([recordType, int], recordType), lambda("r", 0, lambda("n", 1,
      new S.Update(local("r", 0), fields([["n", local("n", 1)]])))))],
  ].map(([name, value]) => ({ recursive: false, bindings: [new Tuple(name, value)] })),
};

const checks = moduleText(`
import java.util.*;
import java.util.function.*;
public final class RepresentationChecks {
  static int checks;
  static void equal(String name, Object actual, Object expected) {
    checks++;
    if (!Objects.equals(actual, expected)) throw new AssertionError(name + ": " + actual + " != " + expected);
  }
  static Object apply(Object value, Object... args) {
    for (Object arg : args) value = ((Function<Object, Object>) value).apply(arg);
    return value;
  }
  static Map<String, Object> map(Object value) { return (Map<String, Object>) value; }
  static void fails(Class<? extends Throwable> type, Runnable action) {
    try { action.run(); } catch (RuntimeException error) {
      equal("conversion exception", error.getClass(), type); return;
    }
    throw new AssertionError("missing conversion failure: " + type);
  }
  public static void main(String[] args) throws Exception {
    boolean intFunctions = Boolean.parseBoolean(args[0]);
    boolean typedRecords = Boolean.parseBoolean(args[1]);
    Class<?> mixedClass = Representation_Contracts.Mixed.class;
    equal("declared Int field", mixedClass.getField("value0").getType(), int.class);
    for (int i = 1; i < 6; i++) equal("generic field " + i, mixedClass.getField("value" + i).getType(), Object.class);
    Object[] array = {3, 4};
    Object opaque = new Object();
    var primitive = new Representation_Contracts.Mixed(17, opaque, true, 1.5, "雪", array);
    var boxed = new Representation_Contracts.Mixed((Object) 19, opaque, true, 1.5, "雪", array);
    var curried = (Representation_Contracts.Mixed) apply(Representation_Contracts.construct, 23, "polymorphic", true, 1.5, "雪", array);
    var generated = (Representation_Contracts.Mixed) Representation_Contracts.constructedInt;
    equal("primitive constructor", primitive.value0, 17);
    equal("boxed FFI constructor", boxed.value0, 19);
    equal("generic constructor chain", curried.value0, 23);
    equal("String in the same polymorphic field", curried.value1, "polymorphic");
    equal("Int instantiation keeps shared storage", generated.value1, 11);
    equal("opaque field identity", boxed.value1 == opaque, true);
    equal("array field identity", boxed.value5 == array, true);
    equal("Boolean wrapper", generated.value2.getClass(), Boolean.class);
    equal("Number wrapper", generated.value3.getClass(), Double.class);
    equal("Char is String", generated.value4, "雪");
    equal("arrays use Object[]", generated.value5 instanceof Object[], true);
    equal("field read returns boxed result", apply(Representation_Contracts.readIntField, boxed), 19);
    fails(NullPointerException.class, () -> new Representation_Contracts.Mixed((Object) null, opaque, true, 1.5, "雪", array));
    fails(ClassCastException.class, () -> new Representation_Contracts.Mixed((Object) 2L, opaque, true, 1.5, "雪", array));

    equal("public function bridge", Representation_Contracts.inc instanceof Function, true);
    equal("selected primitive closure", Representation_Contracts.inc instanceof IntUnaryOperator, intFunctions);
    equal("flat arrow application", apply(Representation_Contracts.flatSum, 10, 20, 12), 42);
    equal("nested arrow application", apply(Representation_Contracts.nestedSum, 10, 20, 12), 42);
    equal("residual partial arrow", apply(Representation_Contracts.partialSum, 12), 42);
    equal("direct or generic call", apply(Representation_Contracts.callSum, 12), 42);
    equal("polymorphic definition ABI", Representation_Contracts.polymorphic instanceof IntUnaryOperator, false);
    equal("instantiation preserves function identity", Representation_Contracts.instantiated == Representation_Contracts.polymorphic, true);
    equal("instantiated use", apply(Representation_Contracts.callInstantiated, 42), 42);
    equal("original polymorphic use", apply(Representation_Contracts.polymorphic, "still generic"), "still generic");
    equal("dictionary precedes value binder", apply(Representation_Contracts.constrained, opaque, 42), 42);

    Object record = Representation_Contracts.record;
    equal("selected record layout", record instanceof LinkedHashMap, !typedRecords);
    equal("callback stored as a value", map(record).get("callback") == Representation_Contracts.inc, true);
    equal("nested open record remains Map", map(record).get("nested") instanceof LinkedHashMap, true);
    equal("record callback crossing both ABIs", apply(Representation_Contracts.readAndCall, record), 41);
    equal("source field order", new ArrayList<>(map(record).keySet()), List.of("nested", "callback", "n"));
    Object changed = apply(Representation_Contracts.update, record, 41);
    equal("update followed by callback", apply(Representation_Contracts.readAndCall, changed), 42);
    equal("original preserved", map(record).get("n"), 40);
    equal("nested identity preserved", map(record).get("nested") == map(changed).get("nested"), true);
    var foreign = new LinkedHashMap<String, Object>(map(record));
    foreign.put("callback", (Function<Object, Object>) n -> (int) n + 2);
    foreign.put("unknown", opaque);
    equal("ordinary FFI callback in ordinary Map", apply(Representation_Contracts.readAndCall, foreign), 42);
    Object foreignChanged = apply(Representation_Contracts.update, foreign, 50);
    equal("FFI update preserves unknown field", map(foreignChanged).get("unknown") == opaque, true);
    equal("FFI callback identity preserved", map(foreignChanged).get("callback") == foreign.get("callback"), true);
    equal("FFI result remains interoperable", apply(Representation_Contracts.readAndCall, foreignChanged), 52);
    System.out.println("Representation contracts: " + checks + " JVM checks passed");
  }
}
`, ["Representation_Contracts"]);

const outputs = [];
for (const intFunctions of [false, true]) for (const typedRecords of [false, true]) for (const directCalls of [false, true]) {
  const mode = `int=${intFunctions},records=${typedRecords},direct=${directCalls}`;
  const file = lowerModule({
    codegen: { intFunctions, typedRecords, directCalls, loopInvariants: true, ownership: false },
    chunkEnabled: false,
  })(fixtures);
  const sources = new Map([
    ["__IntFn.java", intFunctionSource],
    [`${className}.java`, `public final class ${className} {\n${file.decls.map(printExpr).join("\n")}\n}\n`],
    ["RepresentationChecks.java", checks],
  ]);
  for (const shape of file.recordShapes) sources.set(`${recordClassName(shape)}.java`, printRecordShape(shape));
  await withTemporaryDirectory("javapurs-representations-", directory => {
    for (const [name, source] of sources) writeFileSync(join(directory, name), source);
    runCommandSync(javac, [...javacArgs, "-nowarn", ...sources.keys()], { cwd: directory, stdio: "pipe" });
    const output = runCommandSync(java, ["-cp", directory, "RepresentationChecks", String(intFunctions), String(typedRecords)],
      { cwd: directory, encoding: "utf8", stdio: "pipe", timeout: 30000 }).trim();
    outputs.push(output);
    console.log(`${mode}: ${output}`);
  });
}
assert.equal(new Set(outputs).size, 1, "all eight modes must pass the same JVM checks");
