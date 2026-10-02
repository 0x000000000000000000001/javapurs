import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { Just } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import * as PursMap from "../output/Data.Map/index.js";
import { prepare } from "../output/Javapurs.Ownership/index.js";
import { lowerModule } from "../output/Javapurs.Pipeline/index.js";
import { printFile } from "../output/Javapurs.Printer/index.js";
import { intFunctionSource, tcoLoopSource } from "../output/Javapurs.Runtime/index.js";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { runCommandSync } from "../tools/test-process.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";
import { moduleClass } from "./support/module-classes.mjs";

// --simple-scalars isolates the Character/String runtime regression. The full
// fixture also checks escaping and non-finite Number Java source generation.
const simple = process.argv.includes("--simple-scalars");
const { javac, java } = resolveJavaTools();
const name = "Ownership.Admission";
const javaName = moduleClass("Ownership_Admission");
const tree = new C.ADT(`${name}.Tree`, ["Ownership", "Admission", "Tree"], []);
const q = binding => new C.Qualified(new Just(name), binding);
const lit = n => new S.Lit(new C.LitInt(n));
const typed = (ty, expression) => new S.Typed(ty, expression);
const local = (binding, level = 0) => new S.Local(new Just(binding), level);
const call = (binding, ...args) => new S.App(new S.Var(q(binding)), args);
const abs = (args, body) => new S.Abs(args.map(([binding, level]) => new Tuple(new Just(binding), level)), body);
const ctor = (binding, values = []) => new S.CtorSaturated(q(binding), C.SumType.value, "Tree", binding,
  values.map((value, i) => new Tuple(`value${i}`, value)));
const empty = () => ctor("E");
const node = (left, value, right) => ctor("T", [left, value, right]);
const field = (base, index) => new S.Accessor(base,
  new S.GetCtorField(q("T"), C.SumType.value, "Tree", "T", `value${index}`, index));
const t = local("t");
const def = body => typed(new C.Func([tree], tree), abs([["t", 0]], body));
const group = (binding, body) => ({ recursive: false, bindings: [new Tuple(binding, body)] });
const seed = () => node(node(empty(), lit(1), empty()), lit(2), node(empty(), lit(3), empty()));
const swap = def(node(field(t, 2), field(t, 1), field(t, 0)));
const duplicate = def(node(field(t, 0), field(t, 1), field(t, 0)));
const moduleOf = (definitions, entry = call("swap", seed()), dataDecls) => ({
  name, foreign: PursMap.empty,
  dataDecls: dataDecls ?? [{ name: "Tree", vars: [], constructors: [
    { name: "E", fields: [] }, { name: "T", fields: [tree, C.Int.value, tree] },
  ] }],
  bindings: [...definitions.map(([binding, body]) => group(binding, body)), group("result", entry)],
});
let admissions = 0;
function expectWorkers(label, module, count) {
  const prepared = prepare(module);
  assert.equal(PursMap.size(prepared.functions), count, label);
  if (count === 0) {
    assert.deepEqual(prepared.declarations, [], `${label}: no orphan worker`);
    assert.deepEqual(prepared.mutableClasses, [], `${label}: no gratuitous mutable class`);
  }
  admissions++;
  return prepared;
}
expectWorkers("disjoint siblings can swap", moduleOf([["swap", swap]]), 1);
expectWorkers("same subtree twice aliases", moduleOf([["swap", duplicate]]), 0);
expectWorkers("ancestor and descendant alias", moduleOf([["swap", def(node(t, lit(4), field(t, 0)))]]), 0);
expectWorkers("borrowed call operand", moduleOf([["swap", swap]], abs([["t", 0]], call("swap", t))), 0);
expectWorkers("opaque global is not fresh", moduleOf([["swap", swap]], call("swap", new S.Var(q("external")))), 0);
expectWorkers("escaping function value is not a saturated call", moduleOf([["swap", swap]], new S.Var(q("swap"))), 0);
expectWorkers("returned consumed input is still live", moduleOf([
  ["swap", swap], ["use", def(new S.Let(new Just("changed"), 1, call("swap", t), t))],
], call("use", seed())), 0);
expectWorkers("scalar read keeps the consumed input live", moduleOf([
  ["swap", swap], ["use", def(new S.Let(new Just("changed"), 1, call("swap", t),
    node(local("changed", 1), field(t, 1), empty())))],
], call("use", seed())), 0);
const cascade = expectWorkers("rejected callee rejects its callers to a fixed point", moduleOf([
  ["bad", duplicate], ["middle", def(call("bad", t))], ["outer", def(call("middle", t))],
], call("outer", seed())), 0);
assert.ok(cascade.diagnostics.some(line => line.includes("3 candidates, 0 accepted")));
const unsupported = moduleOf([["swap", swap]]);
unsupported.dataDecls[0].constructors.push({ name: "Other", fields: [tree] });
expectWorkers("two node constructors have no reusable layout", unsupported, 0);
const reserved = moduleOf([["swap", swap]]);
reserved.foreign = PursMap.singleton("__owned_swap")(null);
const renamed = expectWorkers("foreign worker name is reserved", reserved, 1);
assert.ok(renamed.declarations.some(decl => decl.value0 === "__owned_swap_1"));

// Scalar literals use the same public representation in persistent and consuming
// paths. Type-correct programs can observe Char's String ABI and IEEE doubles.
const chars = simple ? ["雪"] : ["雪", "'", "\n", "\\"];
const numbers = simple ? [1.5] : [1.5, NaN, Infinity, -Infinity, -0];
const numberBits = value => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(value);
  return `0x${bytes.toString("hex")}L`;
};
function scalarModule() {
  const declarations = [
    { name: "E", fields: [] }, { name: "T", fields: [C.Char.value, C.Number.value, tree] },
  ];
  const definitions = [];
  const results = [];
  for (let i = 0; i < Math.max(chars.length, numbers.length); i++) {
    const char = chars[i % chars.length];
    const number = numbers[i % numbers.length];
    definitions.push([`make${i}`, def(ctor("T", [new S.Lit(new C.LitChar(char)), new S.Lit(new C.LitNumber(number)), t]))]);
    results.push(group(`scalar${i}`, call(`make${i}`, empty())));
  }
  const module = moduleOf(definitions, empty(), [{ name: "Tree", vars: [], constructors: declarations }]);
  module.bindings.push(...results);
  return module;
}
console.log(`Ownership admission: ${admissions} acceptance/rejection cases passed`);
for (const ownership of [false, true]) {
  const options = { codegen: { typedRecords: false, loopInvariants: true, directCalls: true, intFunctions: true, ownership }, chunkEnabled: true };
  const scalarName = `${javaName}_Scalars`;
  // Same source module, compiled into a separate fixture class so the two data
  // layouts do not coexist. Replace only its exact generated module name.
  const scalarSource = printFile(javaName)(lowerModule(options)(scalarModule())).replaceAll(javaName, scalarName);
  const checks = `
import java.util.*;
public final class OwnershipAdmissionChecks {
  static int checks;
  static void equal(String label, Object a, Object b) {
    checks++; if (!Objects.equals(a, b)) throw new AssertionError(label + ": " + a + " != " + b);
  }
  public static void main(String[] args) throws Exception {
    var result = (${javaName}.T) ${javaName}.result;
    equal("left snapshot", ((${javaName}.T) result.value0).value1, 3);
    equal("root scalar snapshot", result.value1, 2);
    equal("right snapshot", ((${javaName}.T) result.value2).value1, 1);
    ${ownership ? `
    var left = new ${javaName}.T(${javaName}.__singleton$E.value, 7, ${javaName}.__singleton$E.value);
    var right = new ${javaName}.T(${javaName}.__singleton$E.value, 9, ${javaName}.__singleton$E.value);
    var input = new ${javaName}.T(left, 8, right);
    var worker = ${javaName}.class.getDeclaredMethod("__owned_swap", Object.class, Object.class);
    worker.setAccessible(true);
    var swapped = (${javaName}.T) worker.invoke(null, input, null);
    equal("reuse dead root", swapped == input, true);
    equal("retain old right", swapped.value0 == right, true);
    equal("retain old left", swapped.value2 == left, true);` : ""}
    ${Array.from({ length: Math.max(chars.length, numbers.length) }, (_, i) => `
    var scalar${i} = (${scalarName}.T) ${scalarName}.scalar${i};
    equal("Char is a String ${i}", scalar${i}.value0 instanceof String, true);
    equal("Char value ${i}", scalar${i}.value0, String.valueOf((char) ${chars[i % chars.length].charCodeAt(0)}));
    equal("Number is a Double ${i}", scalar${i}.value1 instanceof Double, true);
    equal("Number bits ${i}", Double.doubleToLongBits((double) scalar${i}.value1),
      ${Number.isNaN(numbers[i % numbers.length]) ? "Double.doubleToLongBits(Double.NaN)" : numberBits(numbers[i % numbers.length])});
    equal("leaf identity ${i}", scalar${i}.value2 == ${scalarName}.__singleton$E.value, true);`).join("")}
    System.out.println("Ownership " + args[0] + ": " + checks + " JVM checks passed");
  }
}`;
  await withTemporaryDirectory("javapurs-ownership-admission-", directory => {
    const sources = new Map([
      [`${javaName}.java`, printFile(javaName)(lowerModule(options)(moduleOf([["swap", swap]])))],
      [`${scalarName}.java`, scalarSource], ["OwnershipAdmissionChecks.java", checks],
      ["__IntFn.java", intFunctionSource], ["TcoLoop.java", tcoLoopSource],
    ]);
    for (const [file, source] of sources) writeFileSync(join(directory, file), source);
    runCommandSync(javac, ["--release", "17", "-nowarn", ...sources.keys()], { cwd: directory, stdio: "pipe" });
    console.log(runCommandSync(java, ["-cp", directory, "OwnershipAdmissionChecks", String(ownership)],
      { cwd: directory, encoding: "utf8", stdio: "pipe", timeout: 30000 }).trim());
  });
}
