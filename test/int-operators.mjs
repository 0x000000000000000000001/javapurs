import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../output/Javapurs.JavaAst/index.js";
import * as S from "../output/PureScript.Backend.Optimizer.Syntax/index.js";
import { translateOperator2 } from "../output/Javapurs.CodeGen/index.js";
import { printExpr } from "../output/Javapurs.Printer/index.js";

// Run after building the backend: node test/int-operators.mjs
const javac = process.env.JAVAC || "/opt/homebrew/opt/openjdk/bin/javac";
const java = process.env.JAVA || "/opt/homebrew/opt/openjdk/bin/java";
const raw = code => new A.JavaRaw(code);
const operation = (op, left, right) => printExpr(translateOperator2("IntegerOperators")(new S.OpIntNum(op))(raw(left))(raw(right)));
const division = operation(S.OpDivide.value, "x", "y");
const modulo = operation(S.OpMod.value, "x", "y");

assert.match(division, /Math\.floor/, "division must not truncate towards zero");
assert.match(division, /== 0 \? 0 :/, "a zero divisor must return zero");
assert.match(modulo, /Math\.floorMod/, "modulo must stay non-negative");

// Reference semantics from Data.EuclideanRing's JavaScript implementation.
const referenceDiv = (x, y) => (y === 0 ? 0 : y > 0 ? Math.floor(x / y) : -Math.floor(x / -y));
const referenceMod = (x, y) => {
  if (y === 0) return 0;
  const yy = Math.abs(y);
  return ((x % yy) + yy) % yy;
};
// Java Int is 32-bit; the reference Numbers are narrowed the same way.
const narrow = value => value | 0;

const values = [0, 1, -1, 2, -2, 3, -3, 7, -7, 2147483647, -2147483648];
const cases = [];
for (const x of values) for (const y of values) cases.push([x, y]);

const directory = mkdtempSync(join(tmpdir(), "javapurs-int-operators-"));
try {
  writeFileSync(join(directory, "IntegerOperators.java"), `public final class IntegerOperators {
    static int division(int x, int y) { return ((int) (${division})); }
    static int modulo(int x, int y) { return ((int) (${modulo})); }
    public static void main(String[] args) {
        int[][] cases = {${cases.map(([x, y]) => `{${x}, ${y}}`).join(", ")}};
        for (int[] pair : cases) {
            System.out.println(pair[0] + " " + pair[1] + " " + division(pair[0], pair[1]) + " " + modulo(pair[0], pair[1]));
        }
    }
}`);
  execFileSync(javac, ["-d", directory, join(directory, "IntegerOperators.java")], { stdio: "pipe" });
  const lines = execFileSync(java, ["-cp", directory, "IntegerOperators"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(lines.length, cases.length, "every case must produce one line");
  let checked = 0;
  for (const line of lines) {
    const [x, y, quotient, remainder] = line.split(" ").map(Number);
    assert.equal(quotient, narrow(referenceDiv(x, y)), `div(${x}, ${y})`);
    assert.equal(remainder, narrow(referenceMod(x, y)), `mod(${x}, ${y})`);
    checked++;
  }
  console.log(`Integer operators: ${checked} division and modulo cases passed`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
