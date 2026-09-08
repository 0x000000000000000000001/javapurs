import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as C from "../output/PureScript.Backend.Optimizer.CoreFn/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";
import { translate } from "../output/Javapurs.CodeGen/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { rename, renameExpr } from "../output/Javapurs.Rename/index.js";

// Run after rebuilding the backend: node test/nullary-constructors.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const qualified = (module, name) => new C.Qualified(module === null ? Nothing.value : new Just(module), name);
const reference = (module, name) => new S.Var(qualified(module, name));
const literal = value => new S.Lit(new C.LitInt(value));
const definition = (name, fields = [], type = "Token", kind = C.SumType.value) =>
  new S.CtorDef(kind, type, name, fields);
const saturated = (module, name, args = [], type = "Token", kind = C.SumType.value) =>
  new S.CtorSaturated(qualified(module, name), kind, type, name,
    args.map((value, index) => new Tuple(`value${index}`, value)));
const dataDeclaration = (name, constructors, vars = []) => ({ name, vars, constructors });
const constructor = (name, fields = []) => ({ name, fields });

function moduleSource(name, dataDecls, bindings, initializers = "") {
  // Minimal BackendModule fields consumed by translate, with actual constructor layouts.
  const generated = translate({
    name,
    dataDecls,
    bindings: bindings.map(([binding, expression]) => ({ recursive: false, bindings: [new Tuple(binding, expression)] })),
  });
  return `public class ${name.replaceAll(".", "_")} {\n${initializers}\n${generated.decls.map(printExpr).join("\n")}\n}\n`;
}

const maybeType = parameter => new C.ADT("Test.Tags.MaybeA", ["Test", "Tags", "MaybeA"], [parameter]);
const instantiateNone = expression => new S.Typed(maybeType(C.Int.value),
  new S.TypeApp(new S.Typed(new C.ForAll(["a"], maybeType(new C.TypeVar("a"))), expression), C.Int.value));

const sources = new Map();
sources.set("Test_Tags.java", moduleSource("Test.Tags", [
  dataDeclaration("Token", [constructor("R"), constructor("B"), constructor("Quote'")]),
  dataDeclaration("MaybeA", [constructor("None"), constructor("Box", [new C.TypeVar("a"), C.Int.value])], ["a"]),
  // No corresponding CtorDef binding: the holder must still come from dataDecls.
  dataDeclaration("HiddenToken", [constructor("Hidden")]),
], [
  ["beforeR", saturated(null, "R")],
  ["R", definition("R")],
  ["B", definition("B")],
  ["Quote'", definition("Quote'")],
  ["None", definition("None", [], "MaybeA")],
  ["Box", definition("Box", ["value0", "value1"], "MaybeA")],
  ["localR", saturated(null, "R")],
  ["wrappedDefinition", instantiateNone(definition("None", [], "MaybeA"))],
]));
sources.set("Test_Consumer.java", moduleSource("Test.Consumer", [], [
  ["importR", saturated("Test.Tags", "R")],
  ["importB", saturated("Test.Tags", "B")],
  ["importQuote", saturated("Test.Tags", "Quote'")],
  ["wrappedSaturation", instantiateNone(saturated("Test.Tags", "None", [], "MaybeA"))],
  ["hidden", saturated("Test.Tags", "Hidden", [], "HiddenToken", C.ProductType.value)],
  ["boxOne", saturated("Test.Tags", "Box", [saturated("Test.Tags", "R"), literal(128)], "MaybeA")],
  ["boxTwo", saturated("Test.Tags", "Box", [saturated("Test.Tags", "R"), literal(128)], "MaybeA")],
]));
sources.set("Test_Cold.java", moduleSource("Test.Cold", [
  dataDeclaration("ColdToken", [constructor("Cold")]),
], [["Cold", definition("Cold", [], "ColdToken", C.ProductType.value)]],
"static { InitProbe.outerInitializations++; }"));
sources.set("Test_CycleA.java", moduleSource("Test.CycleA", [
  dataDeclaration("CycleToken", [constructor("A")]),
], [
  ["fromB", reference("Test.CycleB", "fromA")],
  ["A", definition("A", [], "CycleToken", C.ProductType.value)],
]));
sources.set("Test_CycleB.java", moduleSource("Test.CycleB", [], [
  ["fromA", saturated("Test.CycleA", "A", [], "CycleToken", C.ProductType.value)],
]));

const tags = sources.get("Test_Tags.java");
for (const name of ["R", "B", "Quote_prime_", "None", "Hidden"]) {
  assert.ok(tags.includes(`class __singleton$${name}`), `${name} needs a holder from its data declaration`);
  assert.equal(tags.split(`new ${name}()`).length - 1, 1, `${name} must be constructed only by its holder`);
}
assert.doesNotMatch(tags, /class __singleton\$Box\b/, "constructors with fields must not receive a singleton holder");
assert.doesNotMatch(tags, /public static final Object Hidden\s*=/, "the data-only constructor intentionally has no value binding");
assert.ok(tags.includes("Test_Tags.__singleton$R.value"), "local constructors must use their declaring module");
assert.ok(sources.get("Test_Consumer.java").includes("Test_Tags.__singleton$Quote_prime_.value"),
  "qualified constructor names must preserve the class-name escaping");
assert.ok(sources.get("Test_Consumer.java").includes("new Test_Tags.Box("), "saturated constructors with fields must still allocate");

const singleton = new A.JavaCtorSingleton("Test_Tags", "Quote_prime_");
const renamed = rename([new Tuple("Test_Tags", "WrongModule"), new Tuple("Quote_prime_", "WrongConstructor")])(17)(singleton);
assert.ok(renamed.value0 instanceof A.JavaCtorSingleton);
assert.equal(renamed.value0.value0, "Test_Tags");
assert.equal(renamed.value0.value1, "Quote_prime_");
assert.equal(renamed.value1, 17);
assert.equal(printExpr(renamed.value0), "Test_Tags.__singleton$Quote_prime_.value");
const inLambda = renameExpr(new A.JavaAbs(["Test_Tags", "Quote_prime_"], singleton));
assert.equal(printExpr(inLambda.value1), printExpr(singleton), "local renaming must preserve singleton qualification");

sources.set("InitProbe.java", "public final class InitProbe { public static int outerInitializations; }\n");
sources.set("NullaryChecks.java", `
public final class NullaryChecks {
    private static void same(String name, Object actual, Object expected) {
        if (actual == null || actual != expected) throw new AssertionError(name + ": different or null instances");
    }
    private static void require(String name, boolean condition) {
        if (!condition) throw new AssertionError(name);
    }
    @SuppressWarnings("unchecked")
    private static Object apply(Object function, Object value) {
        return ((java.util.function.Function<Object, Object>) function).apply(value);
    }
    public static void main(String[] args) {
        // Referring to a static nested holder must not initialize its enclosing module.
        Object cold = Test_Cold.__singleton$Cold.value;
        require("holder access triggered the outer module", InitProbe.outerInitializations == 0);
        require("cold constructor class", cold instanceof Test_Cold.Cold);
        same("later outer binding", Test_Cold.Cold, cold);
        require("outer module initialization count", InitProbe.outerInitializations == 1);

        same("access before the global constructor binding", Test_Tags.beforeR, Test_Tags.R);
        same("local saturated constructor", Test_Tags.localR, Test_Tags.R);
        same("imported saturated constructor", Test_Consumer.importR, Test_Tags.R);
        same("imported second constructor", Test_Consumer.importB, Test_Tags.B);
        require("distinct tags were merged", Test_Tags.R != Test_Tags.B);
        require("R class/field collision", Test_Tags.R instanceof Test_Tags.R);
        require("B class/field collision", Test_Tags.B instanceof Test_Tags.B);
        require("wrong tag matches", !(Test_Tags.R instanceof Test_Tags.B));
        same("quoted constructor name", Test_Consumer.importQuote, Test_Tags.Quoteprime);
        require("quoted constructor class", Test_Consumer.importQuote instanceof Test_Tags.Quote_prime_);
        same("Typed/TypeApp constructor definition", Test_Tags.wrappedDefinition, Test_Tags.None);
        same("Typed/TypeApp imported saturation", Test_Consumer.wrappedSaturation, Test_Tags.None);
        same("holder from dataDecls without CtorDef", Test_Consumer.hidden, Test_Tags.__singleton$Hidden.value);

        Test_Tags.Box boxOne = (Test_Tags.Box) Test_Consumer.boxOne;
        Test_Tags.Box boxTwo = (Test_Tags.Box) Test_Consumer.boxTwo;
        require("saturated constructors with fields were shared", boxOne != boxTwo);
        same("saturated first field", boxOne.value0, Test_Tags.R);
        require("saturated second field", Integer.valueOf(128).equals(boxOne.value1));
        Object captured = new Object();
        Object partialBox = apply(Test_Tags.Box, captured);
        Test_Tags.Box madeOne = (Test_Tags.Box) apply(partialBox, 127);
        Test_Tags.Box madeTwo = (Test_Tags.Box) apply(partialBox, 128);
        require("constructor factory must allocate each time", madeOne != madeTwo);
        same("factory first field", madeOne.value0, captured);
        same("reused partial constructor capture", madeTwo.value0, captured);
        require("factory field order", Integer.valueOf(127).equals(madeOne.value1)
            && Integer.valueOf(128).equals(madeTwo.value1));

        // A initializes B; B needs A's constructor before A's ordinary field is assigned.
        Object cyclic = Test_CycleA.fromB;
        same("constructor through a module initialization cycle", cyclic, Test_CycleA.A);
        same("other side of the initialization cycle", Test_CycleB.fromA, cyclic);
        require("cyclic constructor class", cyclic instanceof Test_CycleA.A);
        System.out.println("Nullary constructors: initialization, identity, imports, wrappers and fresh fields passed");
    }
}
`);

const directory = mkdtempSync(join(tmpdir(), "javapurs-nullary-test-"));
try {
  for (const [name, source] of sources) writeFileSync(join(directory, name), source);
  execFileSync(javac, ["-nowarn", ...sources.keys()], { cwd: directory, stdio: "inherit", timeout: 60000 });
  execFileSync(java, ["-cp", directory, "NullaryChecks"], { stdio: "inherit", timeout: 60000 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
