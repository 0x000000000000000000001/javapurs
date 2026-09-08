import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";
import { Tuple } from "../output/Data.Tuple/index.js";

// Run after rebuilding the backend: node test/tco.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = code => new A.JavaRaw(code);
const local = name => new A.JavaLocal(name);
const snapshot = name => `__final_${name}`;
const integer = name => `((Integer) ${snapshot(name)})`;
const decrement = name => raw(`${integer(name)} - 1`);
const isZero = name => raw(`${integer(name)} == 0`);
const call = (name, args) => new A.JavaCall(raw(name), args);
const next = (name, args) => new A.JavaContinue(name, args);
const choose = (condition, yes, no) => new A.JavaTernary(condition, yes, no);

const swap = new A.JavaWhileTrue(["swapN", "swapLeft", "swapRight"], [],
  choose(isZero("swapN"), raw(`${integer("swapLeft")} * 10 + ${integer("swapRight")}`),
    next("swap", [decrement("swapN"), local(snapshot("swapRight")), local(snapshot("swapLeft"))])));

const ordered = new A.JavaWhileTrue(["orderN", "orderLeft", "orderRight"], [],
  choose(isZero("orderN"), raw(`${integer("orderLeft")} * 10 + ${integer("orderRight")}`),
    next("ordered", [
      call("note", [raw('"count"'), decrement("orderN")]),
      call("note", [raw('"left"'), local(snapshot("orderRight"))]),
      call("note", [raw('"right"'), local(snapshot("orderLeft"))]),
    ])));

const captures = new A.JavaWhileTrue(["captureN", "captureThunk"], [],
  choose(isZero("captureN"), local(snapshot("captureThunk")),
    next("captures", [decrement("captureN"), new A.JavaAbs([], raw(
      `((Integer) ((java.util.function.Supplier<Object>) ${snapshot("captureThunk")}).get()) + ${integer("captureN")}`,
    ))])));

const inner = new A.JavaAbs(["innerN"], new A.JavaWhileTrue(["innerN"], [],
  choose(isZero("innerN"), raw(`${integer("outerAcc")} + 1`),
    next("inner", [decrement("innerN")]))));
const nested = new A.JavaWhileTrue(["outerN", "outerAcc"], [],
  choose(isZero("outerN"), local(snapshot("outerAcc")), new A.JavaBlock([
    new A.JavaLocalAssign("innerFunction", inner),
  ], next("outer", [decrement("outerN"), new A.JavaApply(local("innerFunction"), raw("2"))]))));

const branches = new A.JavaWhileTrue(["branchN", "branchAcc"], [],
  choose(isZero("branchN"), local(snapshot("branchAcc")),
    new A.JavaLet("branchEven", raw(`${integer("branchN")} % 2 == 0`),
      choose(local("branchEven"),
        new A.JavaBlock([new A.JavaLocalAssign("evenIncrement", raw("2"))],
          next("branches", [decrement("branchN"), raw(`${integer("branchAcc")} + ((Integer) evenIncrement)`)])),
        new A.JavaLet("oddIncrement", raw("3"),
          next("branches", [decrement("branchN"), raw(`${integer("branchAcc")} + ((Integer) oddIncrement)`)]))))));

const letRec = new A.JavaWhileTrue(["recN", "recAcc"], [],
  choose(isZero("recN"), local(snapshot("recAcc")),
    new A.JavaLetRec([
      new Tuple("recIncrement", new A.JavaAbs(["recValue"], raw("((Integer) recValue) + 1"))),
    ], next("letRec", [decrement("recN"), new A.JavaApply(local("recIncrement"), local(snapshot("recAcc")))]))));

const nestedLetRec = new A.JavaWhileTrue(["nestedRecN", "nestedRecAcc"], [],
  choose(isZero("nestedRecN"), local(snapshot("nestedRecAcc")),
    new A.JavaLetRec([
      new Tuple("nestedRecF", new A.JavaAbs(["nestedRecX"], raw("((Integer) nestedRecX) + 1"))),
    ], new A.JavaLetRec([], new A.JavaLetRec([
      new Tuple("nestedRecG", new A.JavaAbs(["nestedRecY"], new A.JavaApply(
        local("nestedRecF"), new A.JavaApply(local("nestedRecF"), local("nestedRecY")),
      ))),
    ], next("nestedLetRec", [
      decrement("nestedRecN"), new A.JavaApply(local("nestedRecG"), local(snapshot("nestedRecAcc"))),
    ]))))));

const argumentFailure = new A.JavaWhileTrue(["failureN", "failureLeft", "failureRight"], [],
  next("argumentFailure", [
    call("note", [raw('"first"'), decrement("failureN")]),
    call("failArgument", []),
    call("note", [raw('"third"'), local(snapshot("failureRight"))]),
  ]));

// EffectBind can put a continuation inside an expression-level Supplier.get().
// It must still reach the enclosing loop's exception fallback.
const fallback = new A.JavaWhileTrue(["fallbackN", "fallbackAcc"], [],
  choose(isZero("fallbackN"), local(snapshot("fallbackAcc")),
    new A.JavaCall(new A.JavaPropertyAccess(
      next("fallback", [decrement("fallbackN"), raw(`${integer("fallbackAcc")} + 1`)]),
      "java.util.function.Supplier", "get",
    ), [])));

const primitive = name => `((int) (${snapshot(name)}))`;
const intSwapArgs = ["intSwapN", "intSwapLeft", "intSwapRight"];
const intSwap = new A.JavaWhileTrue(intSwapArgs, intSwapArgs,
  choose(raw(`${primitive("intSwapN")} == 0`),
    new A.JavaArray([local(snapshot("intSwapLeft")), local(snapshot("intSwapRight"))]),
    next("intSwap", [raw(`${primitive("intSwapN")} - 1`),
      local(snapshot("intSwapRight")), local(snapshot("intSwapLeft"))])));

const mixedCaptureArgs = ["mixedN", "mixedThunk"];
const mixedCapture = new A.JavaWhileTrue(mixedCaptureArgs, ["mixedN"],
  choose(raw(`${primitive("mixedN")} == 0`), local(snapshot("mixedThunk")),
    next("mixedCapture", [raw(`${primitive("mixedN")} - 1`), new A.JavaAbs([], raw(
      `((int) (((java.util.function.Supplier<Object>) ${snapshot("mixedThunk")}).get())) + ${primitive("mixedN")}`,
    ))])));

const intOverflowArgs = ["overflowN", "overflowAcc", "overflowDelta"];
const intOverflow = new A.JavaWhileTrue(intOverflowArgs, intOverflowArgs,
  choose(raw(`${primitive("overflowN")} == 0`), local(snapshot("overflowAcc")),
    next("intOverflow", [raw(`${primitive("overflowN")} - 1`),
      raw(`${primitive("overflowAcc")} + ${primitive("overflowDelta")}`), local(snapshot("overflowDelta"))])));

const intFallbackArgs = ["intFallbackN", "intFallbackAcc"];
const intFallback = new A.JavaWhileTrue(intFallbackArgs, intFallbackArgs,
  choose(raw(`${primitive("intFallbackN")} == 0`), local(snapshot("intFallbackAcc")),
    new A.JavaCall(new A.JavaPropertyAccess(
      next("intFallback", [raw(`${primitive("intFallbackN")} - 1`), raw(`${primitive("intFallbackAcc")} + 1`)]),
      "java.util.function.Supplier", "get",
    ), [])));

const expressions = {
  swap, ordered, captures, nested, branches, letRec, nestedLetRec, argumentFailure, fallback,
  intSwap, mixedCapture, intOverflow, intFallback,
};
const printed = Object.fromEntries(Object.entries(expressions).map(([name, expr]) => [name, printExpr(expr)]));
for (const name of ["swap", "ordered", "captures", "nested", "branches", "letRec", "nestedLetRec", "argumentFailure", "intSwap", "mixedCapture", "intOverflow"]) {
  assert.match(printed[name], /\bcontinue\s*;/, `${name} must use a direct Java continuation`);
  assert.doesNotMatch(printed[name], /throw new TcoLoop/, `${name} must not allocate a TCO exception`);
}
assert.match(printed.fallback, /throw new TcoLoop/, "the expression-level fallback must remain available");
assert.match(printed.intFallback, /throw new TcoLoop/, "the primitive loop must support the expression-level fallback");

for (const [name, intParams] of Object.entries({
  intSwap: intSwapArgs, mixedCapture: ["mixedN"], intOverflow: intOverflowArgs, intFallback: intFallbackArgs,
})) {
  for (const param of intParams) {
    assert.match(printed[name], new RegExp(`\\bint\\s+__tco_${param}\\s*=`), `${param} loop storage must be primitive`);
    assert.match(printed[name], new RegExp(`\\bfinal\\s+int\\s+__final_${param}\\s*=`), `${param} snapshot must be primitive`);
  }
}
assert.match(printed.mixedCapture, /\bObject\s+__tco_mixedThunk\s*=/, "the closure loop parameter must remain an Object");
assert.match(printed.mixedCapture, /\bfinal\s+Object\s+__final_mixedThunk\s*=/, "the closure snapshot must remain an Object");
assert.match(printed.swap, /\bObject\s+__tco_swapN\s*=/, "unannotated parameters must retain Object storage");

const typedFunctions = Object.fromEntries(Object.entries({
  intSwap: intSwapArgs, mixedCapture: mixedCaptureArgs, intOverflow: intOverflowArgs, intFallback: intFallbackArgs,
}).map(([name, args]) => [name, printExpr(new A.JavaAbs(args, expressions[name]))]));
for (const [name, expression] of Object.entries(typedFunctions)) {
  assert.match(expression, /java\.util\.function\.Function<Object,\s*Object>/, `${name} must retain its Object function boundary`);
}

// A loop body without a terminal continuation must retain its expression form.
const ordinaryExpression = choose(raw("true"),
  new A.JavaLet("preservedValue", raw("1"), local("preservedValue")), raw("0"));
assert.ok(printExpr(new A.JavaWhileTrue(["preservedArg"], [], ordinaryExpression))
  .includes(`return ${printExpr(ordinaryExpression)};`),
"ordinary expressions must not be expanded into terminal statements");

const source = `
public class TcoPrinterRegression {
    private static final StringBuilder trace = new StringBuilder();
    private static final Object intSwapFunction = ${typedFunctions.intSwap};
    private static final Object mixedCaptureFunction = ${typedFunctions.mixedCapture};
    private static final Object intOverflowFunction = ${typedFunctions.intOverflow};
    private static final Object intFallbackFunction = ${typedFunctions.intFallback};

    @SuppressWarnings("unchecked")
    private static Object apply(Object function, Object... arguments) {
        Object result = function;
        for (Object argument : arguments) {
            result = ((java.util.function.Function<Object, Object>) result).apply(argument);
        }
        return result;
    }

    private static void expectPair(String name, Object actual, int left, int right) {
        Object[] pair = (Object[]) actual;
        expect(name + " length", pair.length, 2);
        expect(name + " left representation", pair[0].getClass(), Integer.class);
        expect(name + " right representation", pair[1].getClass(), Integer.class);
        expect(name + " left", pair[0], left);
        expect(name + " right", pair[1], right);
    }

    private static Object note(String label, Object value) {
        trace.append(label).append(',');
        return value;
    }

    private static Object failArgument() {
        trace.append("second,");
        throw new IllegalArgumentException("argument failure");
    }

    private static Object swap() {
        Object swapN = 100001, swapLeft = 1, swapRight = 2;
        return ${printed.swap};
    }

    private static Object ordered() {
        Object orderN = 1, orderLeft = 1, orderRight = 2;
        return ${printed.ordered};
    }

    private static Object captures() {
        Object captureN = 128;
        Object captureThunk = (java.util.function.Supplier<Object>) () -> 0;
        return ${printed.captures};
    }

    private static Object nested() {
        Object outerN = 100000, outerAcc = 0;
        return ${printed.nested};
    }

    private static Object branches() {
        Object branchN = 100000, branchAcc = 0;
        return ${printed.branches};
    }

    private static Object letRec() {
        Object recN = 100000, recAcc = 0;
        return ${printed.letRec};
    }

    private static Object nestedLetRec() {
        Object nestedRecN = 100000, nestedRecAcc = 0;
        return ${printed.nestedLetRec};
    }

    private static Object argumentFailure() {
        Object failureN = 1, failureLeft = 1, failureRight = 2;
        return ${printed.argumentFailure};
    }

    private static Object fallback() {
        Object fallbackN = 100000, fallbackAcc = 0;
        return ${printed.fallback};
    }

    private static void expect(String name, Object actual, Object expected) {
        if (!java.util.Objects.equals(actual, expected)) {
            throw new AssertionError(name + ": " + actual + " != " + expected);
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        expect("parallel swap", swap(), 21);
        expect("argument order result", ordered(), 21);
        expect("argument order trace", trace.toString(), "count,left,right,");
        expect("escaping snapshot thunks", ((java.util.function.Supplier<Object>) captures()).get(), 8256);
        expect("nested loop capture", nested(), 100000);
        expect("branches and lets", branches(), 250000);
        expect("let rec scope", letRec(), 100000);
        expect("nested and empty let rec scopes", nestedLetRec(), 200000);
        trace.setLength(0);
        try {
            argumentFailure();
            throw new AssertionError("argument exception was swallowed");
        } catch (IllegalArgumentException failure) {
            expect("argument exception", failure.getMessage(), "argument failure");
        }
        expect("exception argument order", trace.toString(), "first,second,");
        expect("expression fallback", fallback(), 100000);

        expectPair("primitive parallel swap", apply(intSwapFunction, 100001, 1, 2), 2, 1);
        expectPair("primitive zero iterations", apply(intSwapFunction, 0, 127, 128), 127, 128);
        expectPair("primitive Integer cache boundary", apply(intSwapFunction, 1, 127, 128), 128, 127);

        java.util.function.Supplier<Object> initialThunk = () -> 0;
        Object unchangedThunk = apply(mixedCaptureFunction, 0, initialThunk);
        if (unchangedThunk != initialThunk) throw new AssertionError("zero iterations changed the Object parameter");
        Object mixedThunk = apply(mixedCaptureFunction, 128, initialThunk);
        expect("primitive escaping snapshots", ((java.util.function.Supplier<Object>) mixedThunk).get(), 8256);

        expect("primitive MAX overflow", apply(intOverflowFunction, 1, Integer.MAX_VALUE, 1), Integer.MIN_VALUE);
        expect("primitive MIN overflow", apply(intOverflowFunction, 1, Integer.MIN_VALUE, -1), Integer.MAX_VALUE);
        expect("primitive zero preserves MAX", apply(intOverflowFunction, 0, Integer.MAX_VALUE, 1), Integer.MAX_VALUE);
        expect("primitive 127 to 128", apply(intOverflowFunction, 1, 127, 1), 128);
        expect("primitive 128 to 129", apply(intOverflowFunction, 1, 128, 1), 129);
        expect("primitive overflow after 100k iterations", apply(intOverflowFunction, 100000, Integer.MAX_VALUE, 1), -2147383649);

        expect("primitive fallback", apply(intFallbackFunction, 100000, 0), 100000);
        expect("primitive fallback overflow", apply(intFallbackFunction, 1, Integer.MAX_VALUE), Integer.MIN_VALUE);
        expect("primitive fallback zero", apply(intFallbackFunction, 0, 128), 128);
        System.out.println("TCO printer: 13 behavioral cases passed");
    }
}

// Same fallback contract as src/Main.purs; ordinary exceptions remain untouched.
final class TcoLoop extends RuntimeException {
    final String loopId;
    final Object[] args;
    TcoLoop(String loopId, Object[] args) {
        this.loopId = loopId;
        this.args = args;
    }
    @Override public synchronized Throwable fillInStackTrace() { return this; }
}
`;

const directory = mkdtempSync(join(tmpdir(), "javapurs-tco-test-"));
try {
  const javaFile = join(directory, "TcoPrinterRegression.java");
  writeFileSync(javaFile, source);
  execFileSync(javac, ["-nowarn", javaFile], { stdio: "inherit", timeout: 60000 });
  execFileSync(java, ["-Xss2m", "-cp", directory, "TcoPrinterRegression"], { stdio: "inherit", timeout: 60000 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
