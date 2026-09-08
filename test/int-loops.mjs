import assert from "node:assert/strict";
import { resolve } from "node:path";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as T from "../output/PureScript.Backend.Optimizer.Codegen.Tco/index.js";
import { Just } from "../output/Data.Maybe/index.js";
import { intLoopParams } from "../output/Javapurs.IntLoops/index.js";

// Run after building the backend: node test/int-loops.mjs
// Optionally validate the current optimized benchmark IR as well:
// node test/int-loops.mjs --polymorphism-project ../../altbak.pub-javapurs
const expr = syntax => new T.TcoExpr(null, syntax);
const local = (name, level) => expr(new S.Local(new Just(name), level));
const typed = (type, value) => expr(new S.Typed(type, value));
const integer = value => expr(new S.Lit(new C.LitInt(value)));
const binary = (operator, left, right) => expr(new S.PrimOp(new S.Op2(operator, left, right)));
const application = (fn, args) => expr(new S.App(fn, args));
const typeVariable = new C.TypeVar("a");
const x = local("x", 0);
const y = local("y", 1);
const f = local("f", 2);
const params = ["x_0", "y_1", "f_2"];
let checked = 0;

function check(label, body, expected, names = params) {
  assert.deepEqual(intLoopParams(names)(body), expected, label);
  checked++;
}

check("explicit Int local", typed(C.Int.value, x), ["x_0"]);
check("Int local beneath retained polymorphic wrappers",
  typed(C.Int.value, typed(typeVariable, x)), ["x_0"]);
check("direct arithmetic operands",
  binary(new S.OpIntNum(S.OpAdd.value), x, y), ["x_0", "y_1"]);
check("direct comparison operands",
  binary(new S.OpIntOrd(S.OpEq.value), x, y), ["x_0", "y_1"]);
check("generic accumulator remains boxed",
  typed(typeVariable, application(f, [typed(typeVariable, x)])), []);
check("Int result does not type a call argument or callee",
  typed(C.Int.value, application(f, [x])), []);
check("arithmetic consuming a call does not type its argument or callee",
  binary(new S.OpIntNum(S.OpAdd.value), application(f, [x]), integer(1)), []);

const polymorphicValue = typed(new C.ForAll(["a"], typeVariable), x);
const instantiatedValue = expr(new S.TypeApp(polymorphicValue, C.Int.value));
check("instantiated rank-two value does not prove its binder is Int",
  typed(C.Int.value, instantiatedValue), []);
check("Int primitive cannot classify through TypeApp",
  binary(new S.OpIntNum(S.OpAdd.value), instantiatedValue, integer(1)), []);

check("Number annotation remains boxed", typed(C.Number.value, x), []);
check("Number operands remain boxed", binary(new S.OpNumberNum(S.OpAdd.value), x, y), []);
check("Boolean annotation remains boxed", typed(C.Boolean.value, x), []);
check("Boolean operands remain boxed", binary(S.OpBooleanAnd.value, x, y), []);
check("proven local outside loop parameters is ignored", typed(C.Int.value, local("other", 3)), []);
check("same source name at another lexical level is ignored", typed(C.Int.value, local("x", 4)), []);
check("literal call argument is no proof for the callee",
  application(f, [typed(C.Int.value, integer(0))]), []);

for (const operator of [S.OpIntNegate.value, S.OpIntBitNot.value]) {
  check(operator.constructor.name, expr(new S.PrimOp(new S.Op1(operator, x))), ["x_0"]);
}
for (const operator of [S.OpIntBitAnd.value, S.OpIntBitOr.value, S.OpIntBitXor.value,
  S.OpIntBitShiftLeft.value, S.OpIntBitShiftRight.value, S.OpIntBitZeroFillShiftRight.value]) {
  check(operator.constructor.name, binary(operator, x, y), ["x_0", "y_1"]);
}
check("classification preserves parameter order and removes repeated evidence",
  binary(new S.OpIntNum(S.OpAdd.value), typed(C.Int.value, x), y), ["y_1", "x_0"], ["y_1", "x_0"]);

console.log(`Int loop classification: ${checked} synthetic cases passed`);

const projectFlag = process.argv.indexOf("--polymorphism-project");
if (projectFlag >= 0) {
  assert.ok(process.argv[projectFlag + 1], "--polymorphism-project requires a project directory");
  const project = resolve(process.argv[projectFlag + 1]);
  const { readPurmetaSync } = await import("../output/PureScript.Backend.Optimizer.Cache/index.js");
  const { extractUncurriedAbs, translate } = await import("../output/Javapurs.CodeGen/index.js");
  const { printExpr } = await import("../output/Javapurs.Printer/index.js");
  const { JavaWhileTrue } = await import("../output/Javapurs.JavaAst/index.js");
  const { Tuple } = await import("../output/Data.Tuple/index.js");
  const previousDirectory = process.cwd();
  let implementations;
  let treeImplementations;
  try {
    process.chdir(project);
    implementations = readPurmetaSync("Test.Polymorphism")();
    treeImplementations = readPurmetaSync("Test.RBTree")();
  } finally {
    process.chdir(previousDirectory);
  }
  assert.ok(implementations instanceof Just, "Test.Polymorphism.purmeta must already exist");
  assert.ok(treeImplementations instanceof Just, "Test.RBTree.purmeta must already exist");

  function binding(map, name) {
    if (map.constructor.name !== "Node") return null;
    if (map.value2.value1 === name) return map.value3.value1;
    return binding(map.value4, name) || binding(map.value5, name);
  }
  function localLoops(value, found = []) {
    if (!value || typeof value !== "object") return found;
    if (value instanceof T.TcoExpr) {
      const syntax = value.value1;
      if (syntax instanceof S.LetRec) {
        for (const pair of syntax.value1) {
          const abstraction = extractUncurriedAbs(pair.value1);
          if (abstraction instanceof Just) {
            found.push({ name: pair.value0, ...abstraction.value0 });
          }
        }
      }
      return localLoops(syntax, found);
    }
    for (const child of Object.values(value)) localLoops(child, found);
    return found;
  }
  for (const [name, expectedIndexes] of [["act", [0, 1]], ["polyLoop", [0]]]) {
    const implementation = binding(implementations.value0, name);
    assert.equal(implementation?.constructor.name, "ExternExpr", `${name} must have an optimized expression`);
    const loops = localLoops(T.analyze([])(implementation.value1)).filter(loop => loop.name === "go");
    assert.equal(loops.length, 1, `${name} must contain its one local go loop`);
    const loop = loops[0];
    assert.equal(loop.args.length, 2, `${name}/go must have counter and accumulator parameters`);
    const expected = expectedIndexes.map(index => loop.args[index]);
    assert.deepEqual(intLoopParams(loop.args)(loop.body), expected, `${name}/go representation evidence`);
    console.log(`Optimized ${name}/go: Int parameters ${expected.join(", ")}`);
  }

  // These real recursive functions have different call shapes: ins rebuilds
  // the tree after recursion, whereas buildTree carries a counter to its tail
  // call. Exercise translation and printing, rather than only classification.
  function generatedLoops(value, found = []) {
    if (!value || typeof value !== "object") return found;
    if (value instanceof JavaWhileTrue) found.push(value);
    for (const child of Object.values(value)) generatedLoops(child, found);
    return found;
  }
  for (const [name, expectedIndexes] of [["ins", []], ["buildTree", [0]]]) {
    const implementation = binding(treeImplementations.value0, name);
    assert.equal(implementation?.constructor.name, "ExternExpr", `RBTree.${name} must have an optimized expression`);
    const javaFile = translate({
      name: "Test.RBTree",
      dataDecls: [],
      bindings: [{ recursive: true, bindings: [new Tuple(name, implementation.value1)] }],
    });
    const loops = generatedLoops(javaFile);
    assert.equal(loops.length, 1, `RBTree.${name} must have one generated recursion loop`);
    const loop = loops[0];
    const names = loop.value0;
    assert.equal(names.length, 2, `RBTree.${name} must preserve both function parameters`);
    const expected = expectedIndexes.map(index => names[index]);
    assert.deepEqual(loop.value1, expected, `RBTree.${name} parameter representations after code generation`);
    const generated = javaFile.decls.map(printExpr).join("\n");
    for (let index = 0; index < names.length; index++) {
      const representation = expectedIndexes.includes(index) ? "int" : "Object";
      assert.ok(generated.includes(`${representation} __tco_${names[index]} = `),
        `RBTree.${name} must initialize ${names[index]} as ${representation}`);
      assert.ok(generated.includes(`final ${representation} __final_${names[index]} = `),
        `RBTree.${name} must capture ${names[index]} as ${representation}`);
    }
    console.log(`Generated RBTree.${name}: Int parameters ${expected.join(", ") || "none"}`);
  }
}
