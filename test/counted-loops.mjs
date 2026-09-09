import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import { Just, Nothing } from "../output/Data.Maybe/index.js";
import { countedLoop } from "../output/Javapurs.CountedLoops/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";

// Run after rebuilding the backend: node test/counted-loops.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = value => new A.JavaRaw(String(value));
const local = name => new A.JavaLocal(name);
const snapshot = name => local(`__final_${name}`);
const cast = value => new A.JavaCast("int", value);
const binary = (operator, left, right) => new A.JavaBinaryOp(operator, left, right);
const choose = (condition, yes, no) => new A.JavaTernary(condition, yes, no);
const next = values => new A.JavaContinue("testLoop", values);
const decrement = name => binary("-", cast(snapshot(name)), raw(1));
const params = ["n", "acc"];
const linearUpdates = [decrement("n"), binary("+", cast(snapshot("acc")), raw(1))];
const loopBody = (updates = linearUpdates, result = snapshot("acc"), guard = binary("==", cast(snapshot("n")), raw(0))) =>
  choose(guard, result, next(updates));
const linear = loopBody();
let selections = 0;

function selected(label, expression, names = params, ints = names) {
  assert.ok(countedLoop(names)(ints)(expression) instanceof Just, label);
  selections++;
}

function rejected(label, expression, names = params, ints = names) {
  assert.ok(countedLoop(names)(ints)(expression) instanceof Nothing, label);
  selections++;
}

selected("primitive counter and accumulator", linear);
selected("counter may be a bare primitive snapshot", loopBody(linearUpdates, snapshot("acc"), binary("==", snapshot("n"), raw(0))));
selected("zero may be on the left", loopBody(linearUpdates, snapshot("acc"), binary("==", raw(0), cast(snapshot("n")))));
selected("counter need not be the first parameter", loopBody([linearUpdates[1], linearUpdates[0]]), ["acc", "n"]);
selected("terminal expression may use final counter and accumulator", loopBody(linearUpdates, binary("+", cast(snapshot("n")), cast(snapshot("acc")))));
selected("minimum Int literal remains an Int", loopBody([decrement("n"), raw(-2147483648)]));
selected("maximum Int literal remains an Int", loopBody([decrement("n"), raw(2147483647)]));
for (const operator of ["+", "-", "*", "&", "|", "^", "<<", ">>", ">>>"]) {
  selected(`pure ${operator} update`, loopBody([decrement("n"), binary(operator, cast(snapshot("acc")), raw(1))]));
}

rejected("unproven counter", linear, params, ["acc"]);
rejected("unproven accumulator", linear, params, ["n"]);
rejected("unproven unused parameter", linear, [...params, "unused"], params);
rejected("no loop parameters", linear, []);
rejected("missing continuation argument", loopBody([decrement("n")]));
rejected("extra continuation argument", loopBody([...linearUpdates, raw(0)]));
rejected("counter decremented by two", loopBody([binary("-", cast(snapshot("n")), raw(2)), snapshot("acc")]));
rejected("counter incremented", loopBody([binary("+", cast(snapshot("n")), raw(1)), snapshot("acc")]));
rejected("counter decrement depends on another parameter", loopBody([binary("-", cast(snapshot("n")), cast(snapshot("acc"))), snapshot("acc")]));
rejected("counter compared with another terminal value", loopBody(linearUpdates, snapshot("acc"), binary("==", cast(snapshot("n")), raw(-2))));
rejected("non-equality guard", loopBody(linearUpdates, snapshot("acc"), binary("<=", cast(snapshot("n")), raw(0))));
rejected("inequality guard", loopBody(linearUpdates, snapshot("acc"), binary("!=", cast(snapshot("n")), raw(0))));
rejected("computed guard operand", loopBody(linearUpdates, snapshot("acc"), binary("==", binary("+", cast(snapshot("n")), raw(0)), raw(0))));
rejected("arbitrary raw guard", loopBody(linearUpdates, snapshot("acc"), raw("__final_n == 0")));
rejected("nested terminal branch", choose(binary("==", snapshot("n"), raw(0)), raw(0), linear));
rejected("expression-level continuation", choose(binary("==", snapshot("n"), raw(0)), snapshot("acc"),
  new A.JavaCall(raw("identity"), [next(linearUpdates)])));
rejected("effectful result", loopBody(linearUpdates, new A.JavaCall(raw("tick"), [snapshot("acc")])));
rejected("effectful update beneath int cast", loopBody([decrement("n"), cast(new A.JavaCall(raw("tick"), [snapshot("acc")]))]));
rejected("function application beneath int cast", loopBody([decrement("n"), cast(new A.JavaApply(local("f"), snapshot("acc")))]));
rejected("closure allocation", loopBody([decrement("n"), new A.JavaAbs([], snapshot("acc"))]));
rejected("outer local is not a proven loop snapshot", loopBody([decrement("n"), local("outside")]));
rejected("loop storage is not a snapshot", loopBody([decrement("n"), local("__tco_acc")]));
rejected("unknown snapshot", loopBody([decrement("n"), snapshot("outside")]));
rejected("boxed cast is not primitive evidence", loopBody([decrement("n"), new A.JavaCast("Integer", snapshot("acc"))]));
for (const operator of ["/", "%", "==", "&&"]) {
  rejected(`unsupported ${operator} operation`, loopBody([decrement("n"), binary(operator, cast(snapshot("acc")), raw(1))]));
}
for (const value of ["1.0", "true", "null", "tick(1)", "1 + 2", "2147483648", "-2147483649"]) {
  rejected(`raw ${value} is not an Int literal`, loopBody([decrement("n"), raw(value)]));
}

const sum = loopBody([decrement("n"), binary("+", cast(snapshot("acc")), cast(snapshot("n")))]);
const swapParams = ["n", "left", "right"];
const swap = loopBody([decrement("n"), snapshot("right"), snapshot("left")],
  binary("+", binary("*", cast(snapshot("left")), raw(10)), cast(snapshot("right"))));
const overflowParams = ["n", "acc", "delta"];
const overflow = loopBody([decrement("n"), binary("+", cast(snapshot("acc")), cast(snapshot("delta"))), snapshot("delta")]);
const bits = loopBody([decrement("n"), binary("|",
  binary(">>>", binary("^", binary("<<", cast(snapshot("acc")), raw(1)), cast(snapshot("n"))), raw(1)),
  binary("&", cast(snapshot("acc")), raw(7)))]);
const reversed = loopBody(linearUpdates, snapshot("acc"), binary("==", raw(0), cast(snapshot("n"))));
const effects = loopBody([decrement("n"), cast(new A.JavaCall(raw("tick"), [snapshot("acc")]))]);
const negativeTerminating = loopBody(linearUpdates, snapshot("acc"), binary("==", cast(snapshot("n")), raw(-2)));
const functionFor = (body, names = params) => printExpr(new A.JavaAbs(names, new A.JavaWhileTrue(names, names, body)));
const functions = {
  linear: functionFor(linear), sum: functionFor(sum), swap: functionFor(swap, swapParams),
  overflow: functionFor(overflow, overflowParams), bits: functionFor(bits), reversed: functionFor(reversed),
  terminalCounter: functionFor(loopBody(linearUpdates, snapshot("n"))),
  counterSecond: functionFor(loopBody([linearUpdates[1], linearUpdates[0]]), ["acc", "n"]),
  effects: functionFor(effects), negativeTerminating: functionFor(negativeTerminating),
};
for (const name of ["linear", "sum", "swap", "overflow", "bits", "reversed", "counterSecond", "terminalCounter"]) {
  assert.match(functions[name], /\bfor\s*\(/, `${name} must use a counted loop`);
  assert.match(functions[name], /\bwhile\s*\(\s*true\s*\)/, `${name} must retain the negative-input fallback`);
}
for (const name of ["effects", "negativeTerminating"]) {
  assert.doesNotMatch(functions[name], /\bfor\s*\(/, `${name} must retain its original loop`);
}

// Bound the negative-input test itself: observe three real fallback updates,
// including MIN_VALUE wrapping to MAX_VALUE, without executing billions of turns.
const negativeProbe = functions.linear.replace(/while\s*\(\s*true\s*\)\s*\{/,
  "while (true) { if (++probeSteps == 4) throw new Probe(__tco_n, __tco_acc);");
assert.notEqual(negativeProbe, functions.linear, "negative probe must instrument the original while loop");

// Exercise the last index increment at the maximum limit. This copy changes only
// the initial index, skipping the preceding two billion iterations of the probe.
const maximumBoundProbe = functions.linear.replace(/(for\s*\(\s*int\s+[\w$]+\s*=\s*)0(?=\s*,)/,
  "$1(Integer.MAX_VALUE - 1)");
assert.notEqual(maximumBoundProbe, functions.linear, "maximum-bound probe must replace the initial counted index");

const source = `
public final class CountedLoopRegression {
    private static int probeSteps;
    private static int ticks;
    ${Object.entries(functions).map(([name, expression]) => `private static final Object ${name} = ${expression};`).join("\n    ")}
    private static final Object negativeProbe = ${negativeProbe};
    private static final Object maximumBoundProbe = ${maximumBoundProbe};

    private static int tick(int value) { ticks++; return value + 1; }

    @SuppressWarnings("unchecked")
    private static Object apply(Object function, Object... arguments) {
        Object value = function;
        for (Object argument : arguments) value = ((java.util.function.Function<Object, Object>) value).apply(argument);
        return value;
    }

    private static void expect(String label, Object value, int expected) {
        if (!(value instanceof Integer) || ((Integer) value) != expected)
            throw new AssertionError(label + ": expected " + expected + ", got " + value);
    }

    private static void negative(int start, int expectedCounter) {
        probeSteps = 0;
        try {
            apply(negativeProbe, start, 17);
            throw new AssertionError("negative input bypassed its fallback");
        } catch (Probe probe) {
            expect("negative fallback counter", probe.counter, expectedCounter);
            expect("negative fallback accumulator", probe.accumulator, 20);
            expect("negative fallback iterations", probeSteps, 4);
        }
    }

    public static void main(String[] ignored) {
        expect("zero iterations", apply(linear, 0, 123), 123);
        expect("one iteration", apply(linear, 1, 123), 124);
        expect("many iterations", apply(linear, 100000, 23), 100023);
        expect("zero preserves MAX", apply(linear, 0, Integer.MAX_VALUE), Integer.MAX_VALUE);
        expect("zero preserves MIN", apply(linear, 0, Integer.MIN_VALUE), Integer.MIN_VALUE);
        expect("one iteration overflows", apply(linear, 1, Integer.MAX_VALUE), Integer.MIN_VALUE);
        expect("counter-dependent update", apply(sum, 100, 19), 5069);
        expect("terminal snapshot", apply(sum, 0, -5), -5);
        expect("final counter snapshot", apply(terminalCounter, 3, 19), 0);
        expect("zero final counter snapshot", apply(terminalCounter, 0, 19), 0);
        expect("exclusive MAX limit terminates without index overflow", apply(maximumBoundProbe, Integer.MAX_VALUE, 17), 18);
        expect("simultaneous swap", apply(swap, 1, 1, 2), 21);
        expect("even swaps", apply(swap, 100000, 1, 2), 12);
        expect("MAX accumulator overflow", apply(overflow, 1, Integer.MAX_VALUE, 1), Integer.MIN_VALUE);
        expect("MIN accumulator overflow", apply(overflow, 1, Integer.MIN_VALUE, -1), Integer.MAX_VALUE);
        expect("overflow after many turns", apply(overflow, 100000, Integer.MAX_VALUE, 1), -2147383649);
        expect("reversed equality", apply(reversed, 7, 128), 135);
        expect("counter is second parameter", apply(counterSecond, 128, 7), 135);
        for (int initial : new int[]{0, 1, -1, 127, 128, Integer.MIN_VALUE, Integer.MAX_VALUE}) {
            int reference = initial;
            for (int n = 37; n != 0; n--) reference = (((reference << 1) ^ n) >>> 1) | (reference & 7);
            expect("bit operations " + initial, apply(bits, 37, initial), reference);
        }
        Object partialThree = apply(linear, 3);
        Object partialSeven = apply(linear, 7);
        expect("first partial application", apply(partialThree, 10), 13);
        expect("second partial application", apply(partialSeven, 10), 17);
        expect("reused first partial", apply(partialThree, 128), 131);
        expect("reused second partial", apply(partialSeven, -128), -121);
        ticks = 0;
        expect("effectful fallback", apply(effects, 3, 127), 130);
        expect("effects occur once per turn", ticks, 3);
        expect("effectful zero", apply(effects, 0, 127), 127);
        expect("zero iteration has no effect", ticks, 3);
        expect("rejected negative-terminating shape", apply(negativeTerminating, -1, 42), 43);
        expect("rejected positive-terminating shape", apply(negativeTerminating, 2, 42), 46);
        negative(-1, -4);
        negative(Integer.MIN_VALUE, Integer.MAX_VALUE - 2);
        System.out.println("Counted loops: arithmetic, simultaneous updates, overflow, partial reuse, effects and negative fallback passed");
    }

    private static final class Probe extends RuntimeException {
        final int counter, accumulator;
        Probe(int counter, int accumulator) { this.counter = counter; this.accumulator = accumulator; }
    }
}

final class TcoLoop extends RuntimeException {
    final String loopId;
    final Object[] args;
    TcoLoop(String loopId, Object[] args) { this.loopId = loopId; this.args = args; }
    @Override public synchronized Throwable fillInStackTrace() { return this; }
}
`;

console.log(`Counted loop classification: ${selections} selection and rejection cases passed`);
const directory = mkdtempSync(join(tmpdir(), "javapurs-counted-loop-test-"));
try {
  const file = join(directory, "CountedLoopRegression.java");
  writeFileSync(file, source);
  execFileSync(javac, ["-nowarn", file], { stdio: "inherit", timeout: 60000 });
  execFileSync(java, ["-cp", directory, "CountedLoopRegression"], { stdio: "inherit", timeout: 30000 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
