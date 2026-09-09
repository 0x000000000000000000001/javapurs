import assert from "node:assert/strict";
import { runtimeSource } from "../output/Javapurs.IntFunctions/index.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import * as T from "../output/PureScript.Backend.Optimizer.Codegen.Tco/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { translateWithRecords } from "../output/Javapurs.CodeGen/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { printRecordShape } from "../output/Javapurs.RecordPrinter/index.js";
import { recordShape, recordShapeOf, recordClassName } from "../output/Javapurs.RecordShapes/index.js";
import { rename } from "../output/Javapurs.Rename/index.js";

// Run after the project backend build; --records=maps exercises the same values
// and open/closed record operations using the retained Map representation.
const typedRecords = !process.argv.includes("--records=maps");
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const tuples = fields => fields.map(([key, value]) => new Tuple(key, value));
const type = (fields, tail = Nothing.value) => new C.Record(new C.Row(tuples(fields), tail));
const typed = (ty, value) => new S.Typed(ty, value);
const local = (name = "r", level = 0) => new S.Local(new Just(name), level);
const integer = value => new S.Lit(new C.LitInt(value));
const string = value => new S.Lit(new C.LitString(value));
const literal = fields => new S.Lit(new C.LitRecord(fields.map(([key, value]) => new C.Prop(key, value))));
const update = (value, fields) => new S.Update(value, fields.map(([key, expression]) => new C.Prop(key, expression)));
const access = (value, label) => new S.Accessor(value, new S.GetProp(label));
const lambda = body => new S.Abs([new Tuple(new Just("r"), 0)], body);
const reference = (module, name) => new S.Var(new C.Qualified(new Just(module), name));
const shape = ty => {
  const result = recordShape(ty);
  assert.ok(result instanceof Just, "expected a closed representable record shape");
  return result.value0;
};

const innerType = type([["n", C.Int.value]]);
const recordType = type([["text", C.String.value], ["z", C.Int.value], ["nested", innerType]]);
const reorderedType = type([["nested", innerType], ["z", C.Int.value], ["text", C.String.value]]);
const recordLayout = shape(recordType);
assert.deepEqual(recordLayout, shape(reorderedType), "field declaration order must not change the shared layout");
assert.equal(recordClassName(recordLayout), recordClassName(shape(reorderedType)));
assert.ok(recordShape(type([["z", C.Int.value]], new Just(C.Any.value))) instanceof Nothing);
assert.ok(recordShape(type([["z", C.Int.value]], new Just(new C.TypeVar("row")))) instanceof Nothing);
assert.ok(recordShape(C.Any.value) instanceof Nothing);
assert.ok(recordShape(type([["duplicate", C.Int.value], ["duplicate", C.String.value]])) instanceof Nothing);
const wideFields = Array.from({ length: 80 }, (_, i) => [`field${i}`, C.Int.value]);
assert.ok(recordShape(type(wideFields)) instanceof Nothing, "wide shapes must retain Map representation");
assert.ok(recordShapeOf(new T.TcoExpr(null, new S.TypeApp(local(), recordType))) instanceof Nothing,
  "the TypeApp argument is not evidence about the expression result");
assert.deepEqual(recordShapeOf(new T.TcoExpr(null, typed(recordType, local()))).value0, recordLayout);
assert.notEqual(recordClassName(shape(type([["z", C.Int.value]]))),
  recordClassName(shape(type([["z", C.String.value]]))), "primitive and reference layouts must differ");
const unusualLabels = ["", "class", "a'b", "a\"b", "a\\b", "line\n", "é", "雪", "💡", "$"];
const unusualType = type(unusualLabels.map(label => [label, C.Int.value]));
const unusualLayout = shape(unusualType);
const encodedNames = unusualLabels.map(label => recordClassName(shape(type([[label, C.Int.value]]))));
assert.equal(new Set(encodedNames).size, unusualLabels.length, "label escaping must be injective");
assert.ok(encodedNames.every(name => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)));

const sources = new Map();
function moduleSource(name, bindings, enabled = typedRecords) {
  const result = translateWithRecords(enabled)({
    name, dataDecls: [],
    bindings: bindings.map(([binding, expression]) => ({ recursive: false, bindings: [new Tuple(binding, expression)] })),
  });
  for (const layout of result.recordShapes) sources.set(`${recordClassName(layout)}.java`, printRecordShape(layout));
  const source = `public class ${name.replaceAll(".", "_")} {\n${result.decls.map(printExpr).join("\n")}\n}\n`;
  sources.set(`${name.replaceAll(".", "_")}.java`, source);
  return { source, result };
}

const initial = typed(recordType, literal([
  ["text", string("original")], ["z", integer(7)],
  ["nested", typed(innerType, literal([["n", integer(11)]]))],
]));
const reversed = typed(reorderedType, literal([
  ["nested", typed(innerType, literal([["n", integer(11)]]))],
  ["z", integer(7)], ["text", string("original")],
]));
const objectFieldType = type([["text", C.String.value], ["z", C.Any.value], ["nested", innerType]]);
const objectFieldRecord = typed(objectFieldType, literal([
  ["text", string("object layout")], ["z", integer(37)],
  ["nested", typed(innerType, literal([["n", integer(41)]]))],
]));
const producer = moduleSource("Records.Producer", [
  ["initial", initial], ["reversed", reversed],
  ["objectField", objectFieldRecord],
  ["empty", typed(type([]), literal([]))],
  ["unusual", typed(unusualType, literal(unusualLabels.map((label, i) => [label, integer(i)])))],
  ["wide", typed(type(wideFields), literal(wideFields.map(([key], i) => [key, integer(i)])))],
]);
const closedArgument = typed(recordType, local());
const openType = type([["z", C.Int.value]], new Just(new C.TypeVar("row")));
const changedType = type([["text", C.String.value], ["z", C.String.value], ["nested", innerType]]);
const consumer = moduleSource("Records.Consumer", [
  ["imported", typed(C.Int.value, access(typed(recordType, reference("Records.Producer", "initial")), "z"))],
  ["read", lambda(typed(C.Int.value, access(closedArgument, "z")))],
  ["nested", lambda(typed(C.Int.value, access(typed(innerType, access(closedArgument, "nested")), "n")))],
  ["modify", lambda(typed(recordType, update(closedArgument, [["z", integer(19)]])))],
  ["openRead", lambda(typed(C.Int.value, access(typed(openType, local()), "z")))],
  ["openModify", lambda(typed(openType, update(typed(openType, local()), [["z", integer(23)]])))],
  ["change", lambda(typed(changedType, update(closedArgument, [["z", string("changed")]])))],
]);

function nodesOf(value, constructor, result = []) {
  if (!value || typeof value !== "object") return result;
  if (value instanceof constructor) result.push(value);
  for (const child of Object.values(value)) nodesOf(child, constructor, result);
  return result;
}

// Optimized functions may preserve their full function type while their body
// has bare Local/Accessor/Update nodes. The parameter type remains evidence.
const parameterFixtures = [
  ["bareRead", typed(new C.Func([recordType], C.Int.value), lambda(access(local(), "z")))],
  ["bareUpdate", typed(new C.Func([recordType], recordType), lambda(update(local(), [["z", integer(43)]])))],
  ["bareNested", typed(new C.Func([recordType], C.Int.value), lambda(access(access(local(), "nested"), "n")))],
  ["bareChangeRead", typed(new C.Func([recordType], C.String.value),
    lambda(access(update(local(), [["z", string("changed bare")]]), "z")))],
  // BackendSyntax represents updates as an Array of Prop, so repeated labels
  // must follow the existing sequential Map.put semantics even if a frontend
  // normally rejects this source form.
  ["duplicateChangeRead", typed(new C.Func([recordType], C.String.value),
    lambda(access(update(local(), [["z", integer(13)], ["z", string("last string")]]), "z")))],
  ["duplicateIntRead", typed(new C.Func([recordType], C.Int.value),
    lambda(access(update(local(), [["z", string("first string")], ["z", integer(53)]]), "z")))],
  ["shadowedOpen", typed(new C.Func([recordType, openType], C.Int.value),
    lambda(new S.Abs([new Tuple(new Just("r"), 1)], access(local("r", 1), "z"))))],
  ["capturedOuter", typed(new C.Func([recordType, C.Int.value], C.Int.value),
    lambda(new S.Abs([new Tuple(new Just("r"), 1)], access(local("r", 0), "z"))))],
  ["typeAppUse", typed(new C.Func([C.Any.value], C.Int.value), lambda(
    new S.Let(new Just("chosen"), 1, typed(recordType, new S.TypeApp(local(), recordType)), access(local(), "z"))))],
];
const parameters = moduleSource("Records.Parameters", parameterFixtures);
if (typedRecords) {
  const binding = name => parameters.result.decls.find(decl => decl.value0 === name);
  assert.equal(nodesOf(binding("bareRead"), A.JavaTypedRecordGet).length, 1,
    "the declared function parameter must type a bare record read");
  assert.equal(nodesOf(binding("bareUpdate"), A.JavaTypedRecordUpdate).length, 1,
    "the declared function parameter must type a bare record update");
  assert.equal(nodesOf(binding("bareNested"), A.JavaTypedRecordGet).length, 2,
    "nested fields must carry the parameter's structural types");
  for (const name of ["bareChangeRead", "duplicateChangeRead"]) {
    const reads = nodesOf(binding(name), A.JavaTypedRecordGet);
    assert.equal(reads.length, 1, `${name}: the updated record needs one typed read`);
    assert.deepEqual(reads[0].value0, shape(changedType), `${name}: the changed field must use its resulting Object layout`);
  }
  const duplicateIntReads = nodesOf(binding("duplicateIntRead"), A.JavaTypedRecordGet);
  assert.equal(duplicateIntReads.length, 1);
  assert.deepEqual(duplicateIntReads[0].value0, recordLayout,
    "the last repeated update restores the field's Int layout");
  assert.equal(nodesOf(binding("shadowedOpen"), A.JavaTypedRecordGet).length, 0,
    "an open parameter must not inherit a shadowed closed parameter's type");
  assert.equal(nodesOf(binding("capturedOuter"), A.JavaTypedRecordGet).length, 1,
    "a captured outer parameter retains its type across name shadowing");
  assert.equal(nodesOf(binding("typeAppUse"), A.JavaTypedRecordGet).length, 0,
    "a TypeApp use must not specialize the original parameter binder");
}

let optimizedRuntimeChecks = "";
const projectFlag = process.argv.indexOf("--records-project");
if (projectFlag >= 0) {
  assert.ok(process.argv[projectFlag + 1], "--records-project requires a project directory");
  const project = resolve(process.argv[projectFlag + 1]);
  const source = readFileSync(join(project, "src/Test/Records.purs"), "utf8");
  assert.ok(source.includes("updateRec :: Int -> DeepRecord -> DeepRecord"),
    "the real PureScript fixture must declare the closed record parameter");
  const { readPurmetaSync } = await import("../output/PureScript.Backend.Optimizer.Cache/index.js");
  const previousDirectory = process.cwd();
  let implementations;
  try {
    process.chdir(project);
    implementations = readPurmetaSync("Test.Records")();
  } finally {
    process.chdir(previousDirectory);
  }
  assert.ok(implementations instanceof Just, "Test.Records.purmeta must already exist after a project build");
  function implementation(map, name) {
    if (map.constructor.name !== "Node") return null;
    if (map.value2.value1 === name) return map.value3.value1;
    return implementation(map.value4, name) || implementation(map.value5, name);
  }
  const updateRec = implementation(implementations.value0, "updateRec");
  const initialRecord = implementation(implementations.value0, "initial");
  assert.equal(updateRec?.constructor.name, "ExternExpr");
  assert.equal(initialRecord?.constructor.name, "ExternDict");
  assert.ok(updateRec.value1 instanceof S.Typed && updateRec.value1.value0 instanceof C.Func);
  // The optimizer caches literal records as dictionaries of annotated fields.
  // Reconstitute that literal using updateRec's declared closed result type.
  const initialExpression = typed(updateRec.value1.value0.value1,
    new S.Lit(new C.LitRecord(initialRecord.value1.map(field => new C.Prop(field.value0, field.value1.value1)))));
  const analyzed = T.analyze([])(updateRec.value1);
  const bareReads = nodesOf(analyzed, S.Accessor).filter(node => node.value0.value1 instanceof S.Local);
  assert.ok(bareReads.length > 0, "the real optimized fixture must exercise unannotated parameter reads");
  const generated = translateWithRecords(typedRecords)({
    name: "Test.Records", dataDecls: [],
    bindings: [
      { recursive: true, bindings: [new Tuple("updateRec", updateRec.value1)] },
      { recursive: false, bindings: [new Tuple("initial", initialExpression)] },
    ],
  });
  if (typedRecords) {
    assert.equal(nodesOf(generated, A.JavaTypedRecordUpdate).length, 3,
      "real optimized DeepRecord must produce three typed immutable updates");
    assert.ok(nodesOf(generated, A.JavaTypedRecordGet).length >= 6,
      "real optimized DeepRecord must use typed parameter and nested reads");
    assert.equal(nodesOf(generated, A.JavaMapUpdate).length, 0,
      "no deep update may silently remain on the Map path");
  }
  for (const layout of generated.recordShapes) sources.set(`${recordClassName(layout)}.java`, printRecordShape(layout));
  sources.set("Test_Records.java", `public class Test_Records {\n${generated.decls.map(printExpr).join("\n")}\n}`);
  sources.set("TcoLoop.java", `public final class TcoLoop extends RuntimeException {
    public final String loopId; public final Object[] args;
    public TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
    @Override public synchronized Throwable fillInStackTrace() { return this; }
  }`);
  optimizedRuntimeChecks = `
    for (int count : new int[]{0, 1, 2, 5, 127, 10000}) {
      Object result = apply(apply(Test_Records.updateRec, count), Test_Records.initial);
      Map<String, Object> middle = map(map(result).get("b"));
      Map<String, Object> deep = map(middle.get("d"));
      int moduloSum = 0;
      for (int n = 1; n <= count; n++) moduloSum += n % 5;
      equal("optimized outer field " + count, map(result).get("a"), count);
      equal("optimized middle field " + count, middle.get("c"), 2 * count);
      equal("optimized deep field " + count, deep.get("e"), 3 * count);
      equal("optimized modulo field " + count, deep.get("f"), moduloSum);
    }
    equal("optimized initial record remains immutable", map(map(map(Test_Records.initial).get("b")).get("d")).get("f"), 0);
  `;
  console.log(`Optimized Test.Records: ${bareReads.length} bare reads, ${typedRecords ? "typed" : "Map"} deep-update translation checked`);
}
if (typedRecords) {
  assert.ok(producer.result.recordShapes.length >= 3);
  assert.ok(consumer.source.includes(`${recordClassName(recordLayout)}.read`), "closed access needs its typed reader");
  assert.ok(consumer.source.includes(`${recordClassName(recordLayout)}.copy`), "closed update needs its typed copy");
  assert.ok(producer.source.includes(`new ${recordClassName(recordLayout)}(`), "typed literal must instantiate its shape");
} else {
  assert.equal(producer.result.recordShapes.length, 0);
  assert.doesNotMatch(producer.source + consumer.source, /__Record\$/);
}

// All three expression nodes must rename their values without touching labels or layout names.
const renamedLocal = new A.JavaLocal("r");
const renameEnvironment = [new Tuple("r", "renamed")];
const renameCases = [
  new A.JavaTypedRecord(recordLayout, [new Tuple("r", renamedLocal)]),
  new A.JavaTypedRecordGet(recordLayout, renamedLocal, "r"),
  new A.JavaTypedRecordUpdate(recordLayout, renamedLocal, [new Tuple("r", renamedLocal)]),
];
for (const expression of renameCases) {
  const renamed = rename(renameEnvironment)(8)(expression);
  assert.equal(renamed.value1, 8);
  assert.deepEqual(renamed.value0.value0, recordLayout);
  const text = printExpr(renamed.value0);
  assert.ok(text.includes("renamed"));
  assert.ok(text.includes('"r"'), "renaming must preserve the record key");
}

function rawRecord(layout, fields) {
  return new (typedRecords ? A.JavaTypedRecord : A.JavaRecord)(...(typedRecords ? [layout, tuples(fields)] : [tuples(fields)]));
}
function rawUpdate(layout, value, fields) {
  return new (typedRecords ? A.JavaTypedRecordUpdate : A.JavaMapUpdate)(...(typedRecords ? [layout, value, tuples(fields)] : [value, tuples(fields)]));
}
const orderedLayout = shape(type([["a", C.Int.value], ["b", C.String.value]]));
const nullableLayout = shape(type([["nested", innerType], ["obj", C.Any.value]]));
if (typedRecords) for (const layout of [orderedLayout, nullableLayout]) {
  sources.set(`${recordClassName(layout)}.java`, printRecordShape(layout));
}
const raw = text => new A.JavaRaw(text);
const orderedExpression = printExpr(rawRecord(orderedLayout, [
  ["b", raw('note("b", "B")')], ["a", raw('note("a", 1)')],
]));
const orderedUpdate = printExpr(rawUpdate(orderedLayout, raw('note("base", old)'), [
  ["b", raw('note("new-b", "BB")')], ["a", raw('note("new-a", 2)')],
]));
const incompatibleUpdate = printExpr(rawUpdate(orderedLayout, raw("old"), [["a", raw('"string"')]]));
const extraUpdate = printExpr(rawUpdate(orderedLayout, raw("old"), [["extra", raw("99")]]));
const mutationUpdate = printExpr(rawUpdate(orderedLayout, raw("mapBase"), [["a", raw("mutateExtra(mapBase)")]]));
const nullExpression = printExpr(rawRecord(nullableLayout, [["obj", raw("null")], ["nested", raw("null")]]));
sources.set("TypedRecordChecks.java", `
import java.util.*;
import java.util.function.Function;
public final class TypedRecordChecks {
  static final List<String> events = new ArrayList<>();
  static int checks;
  static Object note(String key, Object value) { events.add(key); return value; }
  static void require(String name, boolean condition) { checks++; if (!condition) throw new AssertionError(name); }
  static void equal(String name, Object actual, Object expected) { require(name + ": " + actual, Objects.equals(actual, expected)); }
  @SuppressWarnings("unchecked") static Map<String, Object> map(Object value) { return (Map<String, Object>) value; }
  @SuppressWarnings("unchecked") static Object apply(Object function, Object value) { return ((Function<Object, Object>) function).apply(value); }
  static List<String> keys(Object value) { return new ArrayList<>(map(value).keySet()); }
  static Object mutateExtra(Object value) { map(value).put("extra", "after"); return 42; }
  static void immutable(String name, Runnable action) {
    try { action.run(); throw new AssertionError(name + " permitted mutation"); }
    catch (UnsupportedOperationException expected) { checks++; }
  }
  // A normal Java FFI sees Map and may return an ordinary LinkedHashMap.
  static Object ffi(Object value) {
    Map<String, Object> input = map(value);
    require("FFI sees all fields", input.size() == 3 && input.containsKey("nested"));
    LinkedHashMap<String, Object> result = new LinkedHashMap<>(input);
    result.put("z", 31);
    return result;
  }
  public static void main(String[] args) {
    Object initial = Records_Producer.initial;
    equal("cross-module read", Records_Consumer.imported, 7);
    equal("closed nested access", apply(Records_Consumer.nested, initial), 11);
    equal("closed access to a different typed layout", apply(Records_Consumer.read, Records_Producer.objectField), 37);
    equal("nested access to a different typed layout", apply(Records_Consumer.nested, Records_Producer.objectField), 41);
    equal("polymorphic access", apply(Records_Consumer.openRead, initial), 7);
    equal("function type supplies bare access", apply(Records_Parameters.bareRead, initial), 7);
    equal("function type supplies bare nested access", apply(Records_Parameters.bareNested, initial), 11);
    equal("function type supplies bare update", map(apply(Records_Parameters.bareUpdate, initial)).get("z"), 43);
    equal("bare update changes field type before reading", apply(Records_Parameters.bareChangeRead, initial), "changed bare");
    equal("last duplicate update changes field to String", apply(Records_Parameters.duplicateChangeRead, initial), "last string");
    equal("last duplicate update changes field to Int", apply(Records_Parameters.duplicateIntRead, initial), 53);
    equal("type-changing updates preserve their input", apply(Records_Consumer.read, initial), 7);
    equal("shadowed open parameter", apply(apply(Records_Parameters.shadowedOpen, initial), Map.of("z", 47, "extra", true)), 47);
    equal("captured closed parameter", apply(apply(Records_Parameters.capturedOuter, initial), 0), 7);
    equal("TypeApp is erased without specializing binder", apply(Records_Parameters.typeAppUse, initial), 7);
    equal("initial key order", keys(initial), List.of("text", "z", "nested"));
    equal("different literal key order", keys(Records_Producer.reversed), List.of("nested", "z", "text"));
    require("canonical class shared across field orders", initial.getClass() == Records_Producer.reversed.getClass());
    Object modified = apply(Records_Consumer.modify, initial);
    equal("closed update", apply(Records_Consumer.read, modified), 19);
    equal("original preserved", apply(Records_Consumer.read, initial), 7);
    require("updated record is fresh", initial != modified);
    require("unchanged nested record shared", map(initial).get("nested") == map(modified).get("nested"));
    equal("updated order preserved", keys(modified), keys(initial));
    Object openModified = apply(Records_Consumer.openModify, initial);
    equal("open update of typed value", apply(Records_Consumer.read, openModified), 23);
    equal("open update keeps other fields", map(openModified).get("text"), "original");
    equal("type-changing update", map(apply(Records_Consumer.change, initial)).get("z"), "changed");
    Object ffiResult = ffi(initial);
    equal("closed access to FFI map", apply(Records_Consumer.read, ffiResult), 31);
    equal("closed update of FFI map", apply(Records_Consumer.read, apply(Records_Consumer.modify, ffiResult)), 19);
    Map<String, Object> extra = new LinkedHashMap<>(map(initial));
    extra.put("unknown", new Object());
    for (Object operation : List.of(Records_Consumer.modify, Records_Consumer.openModify)) {
      Map<String, Object> result = map(apply(operation, extra));
      require("unknown field preserved", result.get("unknown") == extra.get("unknown"));
      equal("unknown field order preserved", keys(result), keys(extra));
    }
    require("original map unmodified", !map(initial).containsKey("unknown"));
    require("empty record", map(Records_Producer.empty).isEmpty());
    require("wide record fallback", Records_Producer.wide instanceof LinkedHashMap);
    equal("wide record all fields", map(Records_Producer.wide).size(), ${wideFields.length});
    equal("wide record last field", map(Records_Producer.wide).get("field79"), 79);
    String[] labels = {${unusualLabels.map(label => printExpr(new A.JavaString(label))).join(", ")}};
    equal("unusual key order", keys(Records_Producer.unusual), Arrays.asList(labels));
    for (int i = 0; i < labels.length; i++) equal("unusual key " + i, map(Records_Producer.unusual).get(labels[i]), i);
    Object ordered = ${orderedExpression};
    equal("literal evaluation order", events, List.of("b", "a"));
    equal("literal keys", keys(ordered), List.of("b", "a"));
    Object old = ordered;
    events.clear();
    Object next = ${orderedUpdate};
    equal("base and update evaluation order", events, List.of("base", "new-b", "new-a"));
    equal("updated first field", map(next).get("a"), 2);
    equal("updated second field", map(next).get("b"), "BB");
    equal("old value preserved", map(old).get("a"), 1);
    equal("updated keys", keys(next), List.of("b", "a"));
    Object incompatible = ${incompatibleUpdate};
    equal("runtime type change retained", map(incompatible).get("a"), "string");
    Object extended = ${extraUpdate};
    equal("added field retained", map(extended).get("extra"), 99);
    equal("added field order", keys(extended), List.of("b", "a", "extra"));
    Map<String, Object> mapBase = new LinkedHashMap<>(map(old));
    mapBase.put("extra", "before");
    Object mutationResult = ${mutationUpdate};
    equal("FFI map copied before update expression", map(mutationResult).get("extra"), "before");
    equal("instrumented update really mutated the input", mapBase.get("extra"), "after");
    equal("instrumented update value", map(mutationResult).get("a"), 42);
    Object nullable = ${nullExpression};
    require("null object present", map(nullable).containsKey("obj") && map(nullable).get("obj") == null);
    require("null nested reference present", map(nullable).containsKey("nested") && map(nullable).get("nested") == null);
    require("missing differs from null", !map(nullable).containsKey("absent") && map(nullable).get("absent") == null);
    require("non-string lookup", !map(nullable).containsKey(4) && map(nullable).get(4) == null);
    equal("Map equality", ordered, new LinkedHashMap<>(map(ordered)));
    equal("symmetric Map equality", new LinkedHashMap<>(map(ordered)), ordered);
    equal("Map hashCode", ordered.hashCode(), new LinkedHashMap<>(map(ordered)).hashCode());
    if (${typedRecords}) {
      require("typed representation", !(initial instanceof LinkedHashMap));
      immutable("put", () -> map(initial).put("z", 0));
      immutable("entry set", () -> map(initial).entrySet().clear());
      immutable("entry", () -> map(initial).entrySet().iterator().next().setValue(0));
      immutable("key set", () -> map(initial).keySet().remove("z"));
      immutable("values", () -> map(initial).values().remove("original"));
    }
    ${optimizedRuntimeChecks}
    System.out.println("Typed records (${typedRecords ? "typed" : "maps"}): " + checks + " runtime checks passed");
  }
}
`);

const directory = mkdtempSync(join(tmpdir(), "javapurs-typed-records-test-"));
sources.set("__IntFn.java", runtimeSource);
try {
  for (const [name, source] of sources) writeFileSync(join(directory, name), source);
  execFileSync(javac, ["-nowarn", ...sources.keys()], { cwd: directory, stdio: "inherit", timeout: 60000 });
  execFileSync(java, ["-cp", directory, "TypedRecordChecks"], { stdio: "inherit", timeout: 60000 });
  console.log("Record shape recognition, typed translation and renaming passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
