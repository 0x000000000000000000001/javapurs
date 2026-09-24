import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { Just } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import * as PursMap from "../output/Data.Map/index.js";
import { prepare } from "../output/Javapurs.Ownership/index.js";
import { translateWithIntFunctions } from "../output/Javapurs.CodeGen/index.js";
import { printFile } from "../output/Javapurs.Printer/index.js";
import { moduleClass, moduleText } from "./support/module-classes.mjs";

// Run after building the backend: node test/ownership.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const moduleName = "Ownership_Fixtures";
const treeType = new C.ADT(`${moduleName}.Tree`, [moduleName, "Tree"], []);
const treeFunctionType = new C.Func([C.Int.value, treeType], treeType);

const qualified = (module, name) => new C.Qualified(new Just(module), name);
const lit = value => new S.Lit(new C.LitInt(value));
const local = (name, level = 0) => new S.Local(new Just(name), level);
const typed = (type, value) => new S.Typed(type, value);
const bApply = (fn, args) => new S.App(fn, args);
const bCall = (name, args) => bApply(new S.Var(qualified(moduleName, name)), args);
const abs = (args, body) => new S.Abs(args.map(([name, level]) => new Tuple(new Just(name), level)), body);
const ctorT = fields => new S.CtorSaturated(qualified(moduleName, "T"), C.ProductType.value, "Tree", "T",
  fields.map((value, index) => new Tuple(`value${index}`, value)));
const ctorE = () => new S.CtorSaturated(qualified(moduleName, "E"), C.ProductType.value, "Tree", "E", []);
const accessor = (base, index) => new S.Accessor(base,
  new S.GetCtorField(qualified(moduleName, "T"), C.ProductType.value, "Tree", "T", `value${index}`, index));
const isTag = (name, value) => new S.PrimOp(new S.Op1(new S.OpIsTag(qualified(moduleName, name)), value));
const branch = (cases, fallback) => new S.Branch(cases.map(([condition, body]) => new S.Pair(condition, body)), fallback);
const less = (left, right) => new S.PrimOp(new S.Op2(new S.OpIntOrd(S.OpLt.value), left, right));
const isZero = value => new S.PrimOp(new S.Op2(new S.OpIntOrd(S.OpEq.value), value, lit(0)));
const decrement = value => new S.PrimOp(new S.Op2(new S.OpIntNum(S.OpSubtract.value), value, lit(1)));

// ins x s = case s of
//   E -> T E x E
//   T l y r -> case x < y of
//     true -> T (ins x l) y r
//     false -> T l y r
const insBody = typed(treeFunctionType, abs([["x", 0], ["s", 1]],
  branch(
    [[isTag("E", local("s", 1)), ctorT([ctorE(), local("x", 0), ctorE()])]],
    branch(
      [[less(local("x", 0), accessor(local("s", 1), 1)),
        ctorT([bCall("ins", [local("x", 0), accessor(local("s", 1), 0)]), accessor(local("s", 1), 1), accessor(local("s", 1), 2)])]],
      ctorT([accessor(local("s", 1), 0), accessor(local("s", 1), 1), accessor(local("s", 1), 2)])))));
const insertBody = typed(treeFunctionType, abs([["x", 0], ["s", 1]], bCall("ins", [local("x", 0), local("s", 1)])));
// build n t = if n == 0 then t else build (n - 1) (insert n t)
const buildBody = typed(treeFunctionType, abs([["n", 0], ["t", 1]],
  branch(
    [[isZero(local("n", 0)), local("t", 1)]],
    bCall("build", [decrement(local("n", 0)), bCall("insert", [local("n", 0), local("t", 1)])]))));

const treeDeclaration = {
  name: "Tree",
  vars: [],
  constructors: [
    { name: "E", fields: [] },
    { name: "T", fields: [treeType, C.Int.value, treeType] },
  ],
};
const treeModule = (extras = [], built = true) => ({
  name: moduleName,
  dataDecls: [treeDeclaration],
  foreign: PursMap.empty,
  bindings: [
    ...(built ? [{ recursive: false, bindings: [new Tuple("built", typed(treeType, bCall("build", [lit(8), ctorE()])))] }] : []),
    { recursive: true, bindings: [new Tuple("build", buildBody)] },
    { recursive: true, bindings: [new Tuple("insert", insertBody)] },
    { recursive: true, bindings: [new Tuple("ins", insBody)] },
    ...extras,
  ],
});
const options = { typedRecords: false, loopInvariants: true, directCalls: true, intFunctions: true, ownership: true };
const generate = mod => printFile(moduleClass(moduleName))(translateWithIntFunctions(options)(mod));
const occurrences = (text, needle) => text.split(needle).length - 1;
const definitions = (text, name) => text.split(`private static Object ${name}(`).length - 1;

const prepared = prepare(treeModule());
assert.ok(prepared.diagnostics.some(line => line.includes("build, ins, insert")),
  "the diagnostics must name the accepted workers");
assert.equal(PursMap.size(prepared.functions), 3, "build, insert and ins must become consuming workers");
assert.deepEqual(prepared.mutableClasses, [`${moduleClass(moduleName)}.T`], "the node class must allow field updates");

const source = generate(treeModule());
for (const worker of ["__owned_build", "__owned_insert", "__owned_ins"]) {
  assert.ok(definitions(source, worker) >= 1, `${worker} must be emitted`);
}
assert.match(source, /public Object value0;/, "the node class fields must lose the final modifier");
assert.doesNotMatch(source, /public final Object value0;/, "the node class must stay mutable");
assert.ok(occurrences(source, "__owned_build(") > definitions(source, "__owned_build"),
  "a fresh tree argument must reach the consuming worker");

// A call whose tree argument is a parameter keeps the persistent function.
const reuseBody = abs([["t", 0]], typed(treeType, bCall("build", [lit(3), local("t", 0)])));
const reuseModule = treeModule([{ recursive: false, bindings: [new Tuple("reuse", reuseBody)] }], false);
const reuseSource = generate(reuseModule);
assert.equal(occurrences(reuseSource, "__owned_build("), definitions(reuseSource, "__owned_build"),
  "a borrowed tree argument must not reach the consuming worker");

// A polymorphic type: append consumes its first list.
const listName = "Ownership_Lists";
const listType = new C.ADT(`${listName}.List`, [listName, "List"], [new C.TypeVar("a")]);
const listFunctionType = new C.Func([listType, listType], listType);
const listQualified = name => new C.Qualified(new Just(listName), name);
const listCall = (name, args) => bApply(new S.Var(listQualified(name)), args);
const listCtor = (name, fields) => new S.CtorSaturated(listQualified(name), C.ProductType.value, "List", name,
  fields.map((value, index) => new Tuple(`value${index}`, value)));
const listAccessor = (base, index) => new S.Accessor(base,
  new S.GetCtorField(listQualified("Cons"), C.ProductType.value, "List", "Cons", `value${index}`, index));
const listIsTag = (name, value) => new S.PrimOp(new S.Op1(new S.OpIsTag(listQualified(name)), value));
const cons = (head, tail) => listCtor("Cons", [head, tail]);
const nil = () => listCtor("Nil", []);
const appendBody = typed(listFunctionType, abs([["xs", 0], ["ys", 1]],
  branch(
    [[listIsTag("Nil", local("xs", 0)), local("ys", 1)]],
    branch(
      [[listIsTag("Cons", local("xs", 0)),
        cons(listAccessor(local("xs", 0), 0), listCall("append", [listAccessor(local("xs", 0), 1), local("ys", 1)]))]],
      typed(listType, new S.Fail("Failed pattern match"))))));
const listModule = {
  name: listName,
  dataDecls: [{
    name: "List",
    vars: ["a"],
    constructors: [
      { name: "Nil", fields: [] },
      { name: "Cons", fields: [new C.TypeVar("a"), listType] },
    ],
  }],
  foreign: PursMap.empty,
  bindings: [
    { recursive: false, bindings: [new Tuple("appended", typed(listType, listCall("append", [
      cons(lit(1), cons(lit(2), nil())), cons(lit(3), nil())])))] },
    { recursive: true, bindings: [new Tuple("append", appendBody)] },
  ],
};
// A local recursive group: duplicate consumes its list and captures a scalar.
const localName = "Ownership_Local";
const localType = new C.ADT(`${localName}.List`, [localName, "List"], [new C.TypeVar("a")]);
const localFunctionType = new C.Func([C.Int.value, localType], localType);
const localQ = name => new C.Qualified(new Just(localName), name);
const localCall = (name, args) => bApply(new S.Var(localQ(name)), args);
const localCtor = (name, fields) => new S.CtorSaturated(localQ(name), C.ProductType.value, "List", name,
  fields.map((value, index) => new Tuple(`value${index}`, value)));
const localAccessor = (base, index) => new S.Accessor(base,
  new S.GetCtorField(localQ("Cons"), C.ProductType.value, "List", "Cons", `value${index}`, index));
const localTag = (name, value) => new S.PrimOp(new S.Op1(new S.OpIsTag(localQ(name)), value));
const ref = (name, level) => new S.Local(new Just(name), level);
const localCons = (head, tail) => localCtor("Cons", [head, tail]);
const localNil = () => localCtor("Nil", []);
// go rest = case rest of
//   Nil -> Nil
//   Cons x more -> Cons x (Cons count (go more))
const goDefinition = typed(new C.Func([localType], localType), abs([["rest", 3]],
  branch(
    [[localTag("Nil", ref("rest", 3)), localNil()]],
    branch(
      [[localTag("Cons", ref("rest", 3)),
        localCons(localAccessor(ref("rest", 3), 0),
          localCons(ref("count", 0), bApply(ref("go", 2), [localAccessor(ref("rest", 3), 1)])))]],
      typed(localType, new S.Fail("Failed pattern match"))))));
const duplicateBody = typed(localFunctionType, abs([["count", 0], ["xs", 1]],
  new S.LetRec(2, [new Tuple("go", goDefinition)], bApply(ref("go", 2), [ref("xs", 1)]))));
const localModule = {
  name: localName,
  dataDecls: [{
    name: "List",
    vars: ["a"],
    constructors: [
      { name: "Nil", fields: [] },
      { name: "Cons", fields: [new C.TypeVar("a"), localType] },
    ],
  }],
  foreign: PursMap.empty,
  bindings: [
    { recursive: false, bindings: [new Tuple("duplicated", typed(localType, localCall("duplicate", [
      lit(7), localCons(lit(1), localCons(lit(2), localNil()))])))] },
    { recursive: false, bindings: [new Tuple("duplicate", duplicateBody)] },
  ],
};
const localPrepared = prepare(localModule);
assert.ok(localPrepared.diagnostics.some(line => line.includes("duplicate, go")),
  "a function with a local recursive group must be accepted");
assert.deepEqual(localPrepared.mutableClasses, [`${moduleClass(localName)}.Cons`],
  "the local list node class must allow field updates");
const localSource = printFile(moduleClass(localName))(translateWithIntFunctions(options)(localModule));
assert.ok(definitions(localSource, "__owned_duplicate") >= 1, "the enclosing function must become a worker");
assert.ok(definitions(localSource, "__owned_go") >= 1, "the local recursive group must become a worker");
assert.match(localSource, /__owned_go\(owned0, /,
  "the worker call must pass the captured scalar");

const listPrepared = prepare(listModule);
assert.deepEqual(listPrepared.mutableClasses, [`${moduleClass(listName)}.Cons`],
  "a polymorphic node class must allow field updates");
assert.ok(listPrepared.diagnostics.some(line => line.includes("append")),
  "the polymorphic worker must be accepted");
const listSource = printFile(moduleClass(listName))(translateWithIntFunctions(options)(listModule));
assert.ok(definitions(listSource, "__owned_append") >= 1, "the polymorphic worker must be emitted");
assert.doesNotMatch(listSource, /public final Object value0;/, "the polymorphic node must stay mutable");

// The worker builds the same tree as the persistent functions.
const directory = mkdtempSync(join(tmpdir(), "javapurs-ownership-"));
try {
  writeFileSync(join(directory, `${moduleClass(moduleName)}.java`), source);
  writeFileSync(join(directory, `${moduleClass(listName)}.java`), listSource);
  writeFileSync(join(directory, `${moduleClass(localName)}.java`), localSource);
  writeFileSync(join(directory, "TcoLoop.java"), `public class TcoLoop extends RuntimeException {
    public String loopId;
    public Object[] args;
    public TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
    @Override public synchronized Throwable fillInStackTrace() { return this; }
}`);
  writeFileSync(join(directory, "OwnershipRun.java"), moduleText(`public class OwnershipRun {
    static void collect(Object tree, java.util.List<Integer> keys) {
        if (tree == ${moduleName}.__singleton$E.value) return;
        ${moduleName}.T node = (${moduleName}.T) tree;
        collect(node.value0, keys);
        keys.add(node.value1);
        collect(node.value2, keys);
    }
    static void collectList(Object list, java.util.List<Object> items) {
        while (list != ${listName}.__singleton$Nil.value) {
            ${listName}.Cons node = (${listName}.Cons) list;
            items.add(node.value0);
            list = node.value1;
        }
    }
    static void collectLocal(Object list, java.util.List<Object> items) {
        while (list != ${localName}.__singleton$Nil.value) {
            ${localName}.Cons node = (${localName}.Cons) list;
            items.add(node.value0);
            list = node.value1;
        }
    }
    @SuppressWarnings("unchecked")
    static Object persistent() {
        java.util.function.Function<Object, Object> build = (java.util.function.Function<Object, Object>) ${moduleName}.build;
        java.util.function.Function<Object, Object> next = (java.util.function.Function<Object, Object>) build.apply(8);
        return next.apply(${moduleName}.__singleton$E.value);
    }
    public static void main(String[] args) {
        java.util.List<Integer> owned = new java.util.ArrayList<>();
        java.util.List<Integer> shared = new java.util.ArrayList<>();
        java.util.List<Object> appended = new java.util.ArrayList<>();
        java.util.List<Object> duplicated = new java.util.ArrayList<>();
        collect(${moduleName}.built, owned);
        collect(persistent(), shared);
        collectList(${listName}.appended, appended);
        collectLocal(${localName}.duplicated, duplicated);
        System.out.println(owned.equals(shared) + " " + owned + " " + appended + " " + duplicated);
    }
}`, [moduleName, listName, localName]));
  execFileSync(javac, ["-d", directory, join(directory, `${moduleClass(moduleName)}.java`), join(directory, `${moduleClass(listName)}.java`), join(directory, `${moduleClass(localName)}.java`), join(directory, "TcoLoop.java"), join(directory, "OwnershipRun.java")], { stdio: "pipe" });
  const output = execFileSync(java, ["-cp", directory, "OwnershipRun"], { encoding: "utf8" }).trim();
  assert.equal(output, "true [1, 2, 3, 4, 5, 6, 7, 8] [1, 2, 3] [1, 7, 2, 7]",
    "the consuming builds must match the persistent tree, list and local group");
  console.log("Ownership: workers, rewrite guards, runtime tree, polymorphic list and local group passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
