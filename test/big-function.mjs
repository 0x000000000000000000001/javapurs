import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { compilerRoot, prepareWorkspace, runFixture } from "../tools/fixture-runner.mjs";
import { resolveJavaTools } from "../tools/java-tools.mjs";
import { Interrupted, TestProcesses } from "../tools/test-process.mjs";
import { parseOptions, selectFixtures } from "../tools/test-selection.mjs";
import { withTemporaryDirectory } from "../tools/test-workspace.mjs";

// Build the original fixture in an isolated workspace, then exercise f itself.
// No dependency on the last program compiled in tests/runner or on the cwd.
async function checkBranches(runner, { javac, java, javacArgs, env }, processes) {
  const source = readFileSync(join(runner, "src/Main.purs"), "utf8");
  assert.match(source, /f _ = 2137/, "expected the BigFunction fixture");
  const cases = new Map();
  for (const line of source.split("\n")) {
    const clause = line.match(/^f \[([^\]]+)\] \| (.+) = (.+)$/);
    if (!clause) continue;
    const binders = clause[1].split(/,\s*/);
    if (cases.has(binders.length)) continue;
    const lookups = [...clause[2].matchAll(/Just (x+) <- lookup (\d+) (m+)/g)];
    assert.equal(lookups.length, binders.length);
    assert.equal(clause[3], lookups.map(match => match[1]).join(" + "), "expected sum of successful guard values");
    const indices = binders.map(binder => Number(lookups.find(match => match[3] === binder)[2]));
    cases.set(binders.length, indices);
  }
  assert.equal(cases.size, 51, "cover every distinct array-pattern length");
  // Later clauses index beyond 222 million. Bound the fixture's allocation;
  // those lengths still exercise failure after a populated prefix of captures.
  const elementBudget = 1_000_000;
  const successfulPatterns = [...cases.values()].filter(indices => indices.reduce((sum, i) => sum + i + 1, 0) <= elementBudget).length;

  const directory = join(runner, "checks");
  mkdirSync(directory);
  const path = join(directory, "BigFunctionChecks.java");
  writeFileSync(path, `
import java.util.*;
import java.util.function.*;
public final class BigFunctionChecks {
  static int checks;
  static void check(Object[] input, int expected) {
    Object actual = ((Function<Object,Object>)__M$Main.f).apply(input);
    if (!Objects.equals(actual, expected)) throw new AssertionError(input.length + ": " + actual + " != " + expected);
    checks++;
  }
  public static void main(String[] args) {
    check(new Object[0], 0);
    int[][] cases = {${[...cases.values()].map(indices => `{${indices.join(",")}}`).join(",")}};
    for (int[] indices : cases) {
      Object[] input = new Object[indices.length];
      Arrays.fill(input, new Object[0]);
      long used = 0;
      int populated = 0;
      for (int i = 0; i < indices.length && used + indices[i] + 1 <= ${elementBudget}; i++) {
        Object[] row = new Object[indices[i] + 1];
        Arrays.fill(row, 0);
        row[indices[i]] = i + 1;
        input[i] = row;
        used += row.length;
        populated++;
      }
      check(input, populated == indices.length ? indices.length * (indices.length + 1) / 2 : 2137);
      // Fail a later guard after the preceding captures have been populated.
      input[populated - 1] = new Object[0];
      check(input, 2137);
      // Fail at the first guard and traverse the failure continuations.
      input[0] = new Object[0];
      check(input, 2137);
    }
    Object[] unmatched = new Object[52];
    Arrays.fill(unmatched, new Object[0]);
    check(unmatched, 2137);
    System.out.println("BigFunction: " + checks + " branch checks passed (${successfulPatterns} successful nonempty patterns)");
  }
}
`);
  const classes = join(runner, "classes");
  await processes.run("BigFunction: branch harness javac", javac,
    [...javacArgs, "-cp", classes, "-d", directory, path],
    { env, log: join(directory, "javac.log"), timeout: 30_000 });
  const output = await processes.run("BigFunction: branch checks", java,
    ["-Xmx512m", "-cp", `${directory}${delimiter}${classes}`, "BigFunctionChecks"],
    { env, log: join(directory, "execution.log"), capture: true, timeout: 30_000 });
  assert.equal(output.trim(), `BigFunction: 155 branch checks passed (${successfulPatterns} successful nonempty patterns)`);
  process.stdout.write(output);
}

const processes = new TestProcesses();
try {
  const tools = resolveJavaTools();
  const [fixture] = selectFixtures(compilerRoot, parseOptions(["BigFunction"], { fixture: true }));
  await withTemporaryDirectory("javapurs-big-function-", async directory => {
    prepareWorkspace(compilerRoot, directory);
    await runFixture({ fixture, directory, processes, tools, javacArgs: ["-J-Xmx4g"] });
    await checkBranches(directory, tools, processes);
  });
} catch (error) {
  console.error(`[FAILED] ${error.stack || error.message}`);
  process.exitCode = error instanceof Interrupted ? error.exitCode : 1;
} finally {
  processes.dispose();
}
