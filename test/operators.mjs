import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { translateOperator2 } from "../output/Javapurs.Operators/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";

// Run after building the backend: node test/operators.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = code => new A.JavaRaw(code);
const int2 = (op, left, right) => printExpr(translateOperator2("IntegerOperators")(new S.OpIntNum(op))(raw(left))(raw(right)));
const number2 = (op, left, right) => printExpr(translateOperator2("NumberOperators")(new S.OpNumberOrd(op))(raw(left))(raw(right)));
const division = int2(S.OpDivide.value, "x", "y");
const modulo = int2(S.OpMod.value, "x", "y");
const equal = number2(S.OpEq.value, "a", "b");
const notEqual = number2(S.OpNotEq.value, "a", "b");

assert.match(division, /Math\.floor/, "division must not truncate towards zero");
assert.match(division, /== 0 \? 0 :/, "a zero divisor must return zero");
assert.match(modulo, /Math\.floorMod/, "modulo must stay non-negative");
assert.doesNotMatch(equal, /Objects\.equals/, "Number equality must compare values, not boxes");
assert.match(equal, /\(double\)/, "Number equality must widen to primitive doubles");
assert.doesNotMatch(notEqual, /Objects\.equals/, "Number inequality must compare values, not boxes");

// Reference semantics from Data.EuclideanRing's JavaScript implementation.
const referenceDiv = (x, y) => (y === 0 ? 0 : y > 0 ? Math.floor(x / y) : -Math.floor(x / -y));
const referenceMod = (x, y) => {
  if (y === 0) return 0;
  const yy = Math.abs(y);
  return ((x % yy) + yy) % yy;
};
// Java Int is 32-bit; the reference Numbers are narrowed the same way.
const narrow = value => value | 0;

const ints = [0, 1, -1, 2, -2, 3, -3, 7, -7, 2147483647, -2147483648];
const intCases = [];
for (const x of ints) for (const y of ints) intCases.push([x, y]);

// Java evaluates these literals directly; the test keeps the source shapes.
const numbers = ["0.0", "-0.0", "1.0", "-1.0", "Double.NaN", "Double.POSITIVE_INFINITY", "Double.NEGATIVE_INFINITY", "0.5", "-0.5"];
const numberValues = [0.0, -0.0, 1.0, -1.0, NaN, Infinity, -Infinity, 0.5, -0.5];
const numberCases = [];
for (const [i, a] of numbers.entries()) for (const [j, b] of numbers.entries()) numberCases.push([i, j, a, b]);

const directory = mkdtempSync(join(tmpdir(), "javapurs-operators-"));
try {
  writeFileSync(join(directory, "IntegerOperators.java"), `public final class IntegerOperators {
    static int division(int x, int y) { return ((int) (${division})); }
    static int modulo(int x, int y) { return ((int) (${modulo})); }
    static boolean equal(double a, double b) { return ${equal}; }
    static boolean notEqual(double a, double b) { return ${notEqual}; }
    public static void main(String[] args) {
        int[][] cases = {${intCases.map(([x, y]) => `{${x}, ${y}}`).join(", ")}};
        for (int[] pair : cases) {
            System.out.println(pair[0] + " " + pair[1] + " " + division(pair[0], pair[1]) + " " + modulo(pair[0], pair[1]));
        }
        double[] numbers = {${numbers.join(", ")}};
        for (int i = 0; i < numbers.length; i++) {
            for (int j = 0; j < numbers.length; j++) {
                System.out.println(i + " " + j + " " + equal(numbers[i], numbers[j]) + " " + notEqual(numbers[i], numbers[j]));
            }
        }
    }
}`);
  execFileSync(javac, ["-d", directory, join(directory, "IntegerOperators.java")], { stdio: "pipe" });
  const lines = execFileSync(java, ["-cp", directory, "IntegerOperators"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(lines.length, intCases.length + numberCases.length, "every case must produce one line");
  let checked = 0;
  for (const line of lines.slice(0, intCases.length)) {
    const [x, y, quotient, remainder] = line.split(" ").map(Number);
    assert.equal(quotient, narrow(referenceDiv(x, y)), `div(${x}, ${y})`);
    assert.equal(remainder, narrow(referenceMod(x, y)), `mod(${x}, ${y})`);
    checked++;
  }
  for (const line of lines.slice(intCases.length)) {
    const [i, j, isEqual, isNotEqual] = line.split(" ");
    const a = numberValues[Number(i)];
    const b = numberValues[Number(j)];
    assert.equal(isEqual, String(a === b), `eq(${a}, ${b})`);
    assert.equal(isNotEqual, String(a !== b), `neq(${a}, ${b})`);
    checked++;
  }
  console.log(`Integer and Number operators: ${checked} cases passed`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
