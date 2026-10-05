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

// A self-tail-call target is a syntactic fact. A let-bound argument need not be
// recognized until worker validation; it must not hide the need for a loop.
const { javac, java, javacArgs } = resolveJavaTools();
const name = "Ownership.Loops";
const className = moduleClass("Ownership_Loops");
const tree = new C.ADT(`${name}.Tree`, ["Ownership", "Loops", "Tree"], []);
const q = binding => new C.Qualified(new Just(name), binding);
const lit = n => new S.Lit(new C.LitInt(n));
const local = (binding, level) => new S.Local(new Just(binding), level);
const call = (binding, ...args) => new S.App(new S.Var(q(binding)), args);
const abs = (args, body) => new S.Abs(args.map(([binding, level]) => new Tuple(new Just(binding), level)), body);
const typed = (ty, body) => new S.Typed(ty, body);
const ctor = (binding, values = []) => new S.CtorSaturated(q(binding), C.SumType.value, "Tree", binding,
  values.map((value, i) => new Tuple(`value${i}`, value)));
const binary = (op, a, b) => new S.PrimOp(new S.Op2(op, a, b));
const n = local("n", 0);
const t = local("t", 1);
const zero = binary(new S.OpIntOrd(S.OpEq.value), n, lit(0));
const decrement = binary(new S.OpIntNum(S.OpSubtract.value), n, lit(1));
const group = (binding, body, recursive = false) => ({ recursive, bindings: [new Tuple(binding, body)] });
const names = ["treeAlias", "scalarAlias", "recursiveScope"];
const tails = [
  new S.Let(new Just("next"), 2, t, call("treeAlias", decrement, local("next", 2))),
  new S.Let(new Just("next"), 2, decrement, call("scalarAlias", local("next", 2), t)),
  new S.LetRec(2, [new Tuple("unused", typed(new C.Func([C.Int.value], C.Int.value),
    abs([["x", 3]], local("x", 3))))], call("recursiveScope", decrement, t)),
];
const module = {
  name, foreign: PursMap.empty,
  dataDecls: [{ name: "Tree", vars: [], constructors: [
    { name: "E", fields: [] }, { name: "T", fields: [C.Int.value, tree] },
  ] }],
  bindings: [
    ...names.map((binding, i) => group(binding, typed(new C.Func([C.Int.value, tree], tree),
      abs([["n", 0], ["t", 1]], new S.Branch([new S.Pair(zero, t)], tails[i]))), true)),
    // Defer entry calls to the harness, so every failure is attributed to its
    // own alias case instead of aborting Java class initialization.
    ...names.map(binding => group(`${binding}Run`, abs([["count", 0]],
      call(binding, local("count", 0), ctor("T", [lit(42), ctor("E")]))))),
  ],
};
assert.equal(PursMap.size(prepare(module).functions), 3, "all three workers are otherwise admissible");
for (const ownership of [false, true]) {
  const file = lowerModule({ codegen: {
    typedRecords: false, loopInvariants: true, directCalls: true, intFunctions: true, ownership,
  }, chunkEnabled: true })(module);
  const harness = `
public final class OwnershipLoopChecks {
  static int checks;
  static int failures;
  static void check(String label, Object function, int count) {
    try {
      Object result = ((java.util.function.Function<Object, Object>) function).apply(count);
      var node = (${className}.T) result;
      if (node.value0 != 42 || node.value1 != ${className}.__singleton$E.value)
        throw new AssertionError("changed result");
      checks++;
    } catch (Throwable error) { failures++; System.err.println(label + ": " + error); }
  }
  public static void main(String[] args) {
    ${names.map(binding => `for (int count : new int[]{0, 1, 100000}) check("${binding}/" + count, ${className}.${binding}Run, count);`).join("\n")}
    if (failures != 0) throw new AssertionError(failures + " ownership loop failures");
    System.out.println("Ownership loops " + args[0] + ": " + checks + " JVM checks passed");
  }
}`;
  await withTemporaryDirectory("javapurs-ownership-loops-", directory => {
    const sources = new Map([
      [`${className}.java`, printFile(className)(file)], ["OwnershipLoopChecks.java", harness],
      ["__IntFn.java", intFunctionSource], ["TcoLoop.java", tcoLoopSource],
    ]);
    for (const [filename, source] of sources) writeFileSync(join(directory, filename), source);
    runCommandSync(javac, [...javacArgs, "-nowarn", ...sources.keys()], { cwd: directory, stdio: "pipe" });
    console.log(runCommandSync(java, ["-Xss256k", "-cp", directory, "OwnershipLoopChecks", String(ownership)],
      { cwd: directory, encoding: "utf8", stdio: "pipe", timeout: 30000 }).trim());
  });
}
