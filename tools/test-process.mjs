import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { basename } from "node:path";

export class Interrupted extends Error {
  constructor(signal) {
    super(`Interrupted by ${signal}`);
    this.signal = signal;
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}

export class ProcessFailure extends Error {
  constructor(label, { code, signal, timeout, log, cause }) {
    const reason = timeout ? `timeout after ${timeout} ms` : signal || (code != null ? `exit ${code}` : cause.message);
    super(`${label} failed (${reason})${log ? `; log: ${log}` : ""}`, { cause });
    this.code = code;
    this.signal = signal;
    this.log = log;
    this.timeout = timeout;
  }
}

// The small AST suites run Java synchronously. Preserve their stdout/stdio and
// timeout contracts, while adding the same phase/command diagnostics as runners.
export function runCommandSync(command, args, options = {}) {
  try {
    return execFileSync(command, args, options);
  } catch (cause) {
    if (cause.stdout?.length) process.stderr.write(cause.stdout);
    if (cause.stderr?.length) process.stderr.write(cause.stderr);
    throw new ProcessFailure(`${basename(command)}: ${command} ${args.join(" ")}`, {
      code: cause.status, signal: cause.signal,
      timeout: cause.code === "ETIMEDOUT" ? options.timeout : null, cause,
    });
  }
}

// Give each command its own process group so interrupting the runner also
// stops compilers and grandchildren, without touching another test run.
export class TestProcesses {
  constructor() {
    this.active = null;
    this.signal = null;
    this.escalation = null;
    this.handlers = new Map(["SIGINT", "SIGTERM"].map(signal => {
      const handler = () => {
        this.signal = signal;
        this.stop(signal);
      };
      process.on(signal, handler);
      return [signal, handler];
    }));
  }

  killGroup(signal) {
    if (!this.active?.pid) return;
    try { process.kill(-this.active.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  stop(signal) {
    this.killGroup(signal);
    if (this.active && !this.escalation) {
      this.escalation = setTimeout(() => this.killGroup("SIGKILL"), 1000);
    }
  }

  checkInterrupted() {
    if (this.signal) throw new Interrupted(this.signal);
  }

  async run(label, command, args, { cwd, log, display = !log, capture = false, env, timeout } = {}) {
    this.checkInterrupted();
    if (this.active) throw new Error("TestProcesses runs one phase at a time.");
    console.log(`   [${label}] ${command} ${args.join(" ")}`);
    let fd = null;
    let status;
    let output = "";
    let timer;
    let timedOut = false;
    try {
      fd = log ? openSync(log, "w") : null;
      const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      this.active = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        if (capture) output += chunk;
        if (fd !== null) writeSync(fd, chunk);
        if (display) process.stdout.write(chunk);
      });
      child.stderr.on("data", chunk => {
        if (fd !== null) writeSync(fd, chunk);
        if (display) process.stderr.write(chunk);
      });
      if (timeout) timer = setTimeout(() => { timedOut = true; this.stop("SIGTERM"); }, timeout);
      status = await new Promise((resolve, reject) => {
        child.once("error", reject);
        // Descendants can keep the pipes open after a failed wrapper exits.
        // Stop them on exit, rather than waiting indefinitely for close.
        child.once("exit", (code, signal) => {
          if (code !== 0 || signal) this.killGroup("SIGKILL");
        });
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } catch (error) {
      throw new ProcessFailure(label, { cause: error, log });
    } finally {
      // A wrapper can exit before its descendants. On failure/interrupt, stop
      // the whole group before releasing it, even if its leader already exited.
      if (timedOut || this.signal || !status || status.code !== 0) this.killGroup("SIGKILL");
      clearTimeout(timer);
      clearTimeout(this.escalation);
      this.escalation = null;
      this.active = null;
      if (fd !== null) closeSync(fd);
    }
    this.checkInterrupted();
    if (timedOut || status.code !== 0) {
      if (log && !display) console.error(readFileSync(log, "utf8").trimEnd().split("\n").slice(-40).join("\n"));
      throw new ProcessFailure(label, { ...status, timeout: timedOut ? timeout : null, log });
    }
    return output;
  }

  dispose() {
    clearTimeout(this.escalation);
    for (const [signal, handler] of this.handlers) process.off(signal, handler);
  }
}
