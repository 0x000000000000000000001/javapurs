import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { reuseConstructors } from "../output/Javapurs.Reuse/index.js";
import { printFile } from "../output/Javapurs.Printer/index.js";

// Run after building the backend: node test/constructor-reuse.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const moduleName = "Reuse_Fixtures";
const tuple = (a, b) => new Tuple(a, b);
const objectField = name => tuple(name, A.ParamObject.value);
const intField = name => tuple(name, A.ParamInt.value);
const ctor = (name, fields) => new A.JavaClassDecl(name, fields);
const local = name => new A.JavaLocal(name);
const project = (value, className, index) => new A.JavaPropertyAccess(local(value), className, `value${index}`);
const constant = name => new A.JavaCtorSingleton(moduleName, name);
const singleton = (name, index) => new A.JavaTernary(
  new A.JavaInstanceOf(local(name), `${moduleName}.T`),
  new A.JavaNew(`${moduleName}.T`, [constant("B"), project(name, `${moduleName}.T`, 1), project(name, `${moduleName}.T`, 2), project(name, `${moduleName}.T`, 3)]),
  new A.JavaRaw("null"));
const rebuild = name => new A.JavaAssign(name, new A.JavaAbs([name],
  new A.JavaNew(`${moduleName}.T`, [project(name, `${moduleName}.T`, 0), project(name, `${moduleName}.T`, 1), project(name, `${moduleName}.T`, 2), project(name, `${moduleName}.T`, 3)])));
const decl = (name, body) => new A.JavaAssign(name, new A.JavaAbs(["v"], body));

// A four-field constructor with one primitive field, plus a nullary color.
const data = [
  ctor("T", [objectField("value0"), objectField("value1"), intField("value2"), objectField("value3")]),
  ctor("B", []),
  ctor("R", []),
  ctor("E", []),
  new A.JavaAssign("B", constant("B")),
];
const file = decls => ({ decls, recordShapes: [] });
const find = (rewritten, name) => rewritten.decls.find(declaration =>
  declaration instanceof A.JavaAssign && declaration.value0 === name);

let checked = 0;

// The nullary constructor replacement becomes a guarded field test.
{
  const rewritten = reuseConstructors(moduleName)(file([...data, new A.JavaAssign("makeBlack", new A.JavaAbs(["v"], singleton("v")))]));
  const printed = printFile(moduleName)(rewritten);
  assert.match(printed, /\? v : new Reuse_Fixtures\.T\(Reuse_Fixtures\.__singleton\$B\.value/,
    "an already-black node must return the source");
  assert.match(printed, /value0 == Reuse_Fixtures\.__singleton\$B\.value/, "the reuse test must compare the replaced field");
  checked += 1;
}

// A full projection rebuild is the scrutinee itself.
{
  const rewritten = reuseConstructors(moduleName)(file([...data, rebuild("fresh")]));
  const body = find(rewritten, "fresh").value1.value1;
  assert.ok(body instanceof A.JavaLocal && body.value0 === "fresh", "a full rebuild must return its source");
  checked += 1;
}

// A constant on a primitive field cannot use reference equality.
{
  const primitive = new A.JavaNew(`${moduleName}.T`, [
    project("v", `${moduleName}.T`, 0),
    project("v", `${moduleName}.T`, 1),
    new A.JavaCast("int", new A.JavaRaw("5")),
    project("v", `${moduleName}.T`, 3),
  ]);
  const rewritten = reuseConstructors(moduleName)(file([...data, decl("primitive", primitive)]));
  assert.ok(find(rewritten, "primitive").value1.value1 instanceof A.JavaNew, "a primitive constant replacement must not be rewritten");
  checked += 1;
}

// A shared global that is not a declared nullary constructor is opaque.
{
  const foreign = new A.JavaNew(`${moduleName}.T`, [
    new A.JavaGlobalVar(new Just("Other"), "B"),
    project("v", `${moduleName}.T`, 1),
    project("v", `${moduleName}.T`, 2),
    project("v", `${moduleName}.T`, 3),
  ]);
  const rewritten = reuseConstructors(moduleName)(file([...data, decl("foreign", foreign)]));
  assert.ok(find(rewritten, "foreign").value1.value1 instanceof A.JavaNew, "an unknown global must not be reused");
  checked += 1;
}

// Projections from different scrutinees or at the wrong position are rejected.
{
  const mixed = new A.JavaNew(`${moduleName}.T`, [
    project("a", `${moduleName}.T`, 0),
    project("b", `${moduleName}.T`, 1),
    project("a", `${moduleName}.T`, 2),
    project("a", `${moduleName}.T`, 3),
  ]);
  const shuffled = new A.JavaNew(`${moduleName}.T`, [
    project("v", `${moduleName}.T`, 1),
    project("v", `${moduleName}.T`, 0),
    project("v", `${moduleName}.T`, 2),
    project("v", `${moduleName}.T`, 3),
  ]);
  const rewritten = reuseConstructors(moduleName)(file([...data, decl("mixed", mixed), decl("shuffled", shuffled)]));
  assert.ok(find(rewritten, "mixed").value1.value1 instanceof A.JavaNew, "mixed scrutinees must not be reused");
  assert.ok(find(rewritten, "shuffled").value1.value1 instanceof A.JavaNew, "a permuted rebuild is not an identity");
  checked += 1;
}

// A declared nullary constructor reference shares the same rule.
{
  const rewritten = reuseConstructors(moduleName)(file([...data, decl("globalBlack", new A.JavaTernary(
    new A.JavaInstanceOf(local("v"), `${moduleName}.T`),
    new A.JavaNew(`${moduleName}.T`, [new A.JavaGlobalVar(new Just(moduleName), "B"), project("v", `${moduleName}.T`, 1), project("v", `${moduleName}.T`, 2), project("v", `${moduleName}.T`, 3)]),
    new A.JavaRaw("null")))]));
  const printed = printFile(moduleName)(rewritten);
  assert.match(printed, /value0 == Reuse_Fixtures\.B/, "a declared nullary binding must be recognized");
  checked += 1;
}

// The rewritten program keeps its behavior and shares the source only when the
// replacement constant already matches every other field.
{
  const rewritten = reuseConstructors(moduleName)(file([...data, new A.JavaAssign("makeBlack", new A.JavaAbs(["v"], singleton("v"))), rebuild("copy")]));
  const directory = mkdtempSync(join(tmpdir(), "javapurs-reuse-test-"));
  try {
    writeFileSync(join(directory, `${moduleName}.java`), printFile(moduleName)(rewritten));
    writeFileSync(join(directory, "ReuseRun.java"), `public class ReuseRun {
    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        java.util.function.Function<Object, Object> makeBlack = (java.util.function.Function<Object, Object>) Reuse_Fixtures.makeBlack;
        java.util.function.Function<Object, Object> copy = (java.util.function.Function<Object, Object>) Reuse_Fixtures.copy;
        Object leaf = Reuse_Fixtures.__singleton$E.value;
        Object black = new Reuse_Fixtures.T(Reuse_Fixtures.__singleton$B.value, leaf, 7, leaf);
        Object red = new Reuse_Fixtures.T(Reuse_Fixtures.__singleton$R.value, leaf, 7, leaf);
        Object shared = makeBlack.apply(black);
        Object colored = makeBlack.apply(red);
        System.out.println(shared == black);
        System.out.println(colored != red);
        System.out.println(((Reuse_Fixtures.T) colored).value0 == Reuse_Fixtures.__singleton$B.value);
        System.out.println(((Reuse_Fixtures.T) colored).value2);
        System.out.println(copy.apply(red) == red);
        System.out.println(((Reuse_Fixtures.T) copy.apply(black)).value0 == Reuse_Fixtures.__singleton$B.value);
    }
}`);
    execFileSync(javac, ["-d", directory, join(directory, `${moduleName}.java`), join(directory, "ReuseRun.java")], { stdio: "pipe" });
    const output = execFileSync(java, ["-cp", directory, "ReuseRun"], { encoding: "utf8" }).trim().split("\n");
    assert.deepEqual(output, ["true", "true", "true", "7", "true", "true"], "the rewritten program must keep its behavior");
    checked += 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

console.log(`Constructor reuse: ${checked} fixture groups passed`);
