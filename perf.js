#!/usr/bin/env node

/**
 * Vortex Profiler
 * by Seuriin
 *
 * VM performance & behavioral analysis.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const chalk = require("chalk");
const { performance } = require("perf_hooks");
const crypto = require("crypto");

const version = `v1.1.0`;

// --- COLORS ---
const COLORS = {
  text: chalk.hex("#C0C0C0"),
  muted: chalk.hex("#888888"),
  divider: chalk.hex("#555555"),
  cyan: chalk.cyanBright,
  green: chalk.greenBright,
  yellow: chalk.yellowBright,
  red: chalk.redBright,
  magenta: chalk.magentaBright,
  gold: chalk.hex("#FFD700"),
};

// --- UI HELPERS ---
const getTermWidth = () => process.stdout.columns || 90;
const createDivider = () => COLORS.divider("─".repeat(getTermWidth()));

function renderBanner() {
  const divider = createDivider();
  return [
    "",
    divider,
    ` ${COLORS.cyan.bold(`Vortex Profiler ${version}`)}`,
    ` ${COLORS.green("by Seuriin (GitHub: SSL-ACTX)")}`,
    ` ${COLORS.text("• Behavior Parity • JIT Warm-up Analysis • Memory Profiling")}`,
    divider,
    "",
  ].join("\n");
}

const logger = (() => {
  let levels = [];
  const write = (msg) => process.stderr.write(msg + "\n");
  const getPrefix = () => {
    let str = "";
    for (let i = 0; i < levels.length - 1; i++)
      str += levels[i].isLast ? "   " : "│  ";
    if (levels.length > 0)
      str += levels[levels.length - 1].isLast ? "   " : "│  ";
    return str;
  };

  return {
    start: (title) => write(COLORS.cyan(`┌ ${title}`)),
    phase: (n, total, msg) => {
      levels = [{ isLast: n === total }];
      write(
        `${COLORS.cyan(n === total ? "└─" : "├─")} ${chalk.bold(n)}. ${COLORS.text(msg)}`,
      );
    },
    branch: (msg, isLast = false) => {
      const prefix = getPrefix();
      write(
        `${COLORS.cyan(prefix)}${isLast ? "└─" : "├─"} ${COLORS.text(msg)}`,
      );
    },
    info: (msg) => {
      const prefix = getPrefix();
      write(`${COLORS.cyan(prefix)}│  ${COLORS.muted(msg)}`);
    },
    error: (msg) => write(COLORS.red(`\n[✖] ${msg}`)),
    success: (msg) => write(COLORS.green(`\n[✔] ${msg}`)),
  };
})();

// --- TABLE RENDERER ---
function printTable(rows) {
  const keys = Object.keys(rows[0]);
  const colWidths = keys.map(
    (k) =>
      Math.max(
        k.length,
        ...rows.map((r) => String(r[k]).replace(/\u001b\[.*?m/g, "").length),
      ) + 2,
  );

  const drawLine = () =>
    console.log(
      COLORS.divider("+" + colWidths.map((w) => "-".repeat(w)).join("+") + "+"),
    );

  drawLine();
  console.log(
    COLORS.divider("|") +
      keys
        .map((k, i) => COLORS.cyan(` ${k.padEnd(colWidths[i] - 1)}`))
        .join(COLORS.divider("|")) +
      COLORS.divider("|"),
  );
  drawLine();

  rows.forEach((row) => {
    let line = COLORS.divider("|");
    keys.forEach((k, i) => {
      const val = String(row[k]);
      const cleanVal = val.replace(/\u001b\[.*?m/g, "");
      const padding = " ".repeat(colWidths[i] - cleanVal.length - 1);
      line += ` ${val}${padding}` + COLORS.divider("|");
    });
    console.log(line);
  });
  drawLine();
}

// --- PROFILER CORE ---

function createPolyfilledSandbox(stats, logs) {
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.join(" ")),
      warn: (...args) => logs.push(`[WARN] ${args.join(" ")}`),
      error: (...args) => logs.push(`[ERR] ${args.join(" ")}`),
    },
    atob: (str) => {
      const t0 = performance.now();
      const res = Buffer.from(str, "base64").toString("binary");
      stats.atobTime += performance.now() - t0;
      stats.atobCalls++;
      return res;
    },
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    performance: { now: () => performance.now() },
    crypto: { getRandomValues: (arr) => crypto.randomFillSync(arr) },
    TextEncoder,
    TextDecoder,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
  };
  sandbox.window = sandbox.self = sandbox.globalThis = sandbox;
  return sandbox;
}

async function profileScript(scriptPath, iterations, timeout) {
  const code = fs.readFileSync(scriptPath, "utf8");
  const script = new vm.Script(code, { filename: path.basename(scriptPath) });
  const runs = [];
  const allLogs = [];

  for (let i = 0; i < iterations; i++) {
    const stats = { atobCalls: 0, atobTime: 0 };
    const logs = [];
    const sandbox = createPolyfilledSandbox(stats, logs);
    const context = vm.createContext(sandbox);

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    try {
      script.runInContext(context, { timeout });
    } catch (e) {
      runs.push({ error: e.message });
      continue;
    }
    const duration = performance.now() - t0;
    const memAfter = process.memoryUsage().heapUsed;

    runs.push({ duration, mem: Math.max(0, memAfter - memBefore), ...stats });
    if (i === 0) allLogs.push(...logs); // Store first run logs for parity check
  }

  const valid = runs.filter((r) => !r.error);
  const avg = (key) => valid.reduce((a, b) => a + b[key], 0) / valid.length;

  return {
    name: path.basename(scriptPath),
    size: fs.statSync(scriptPath).size,
    avgTime: avg("duration"),
    coldTime: runs[0].duration,
    warmTime:
      valid.length > 1
        ? valid.slice(1).reduce((a, b) => a + b.duration, 0) /
          (valid.length - 1)
        : runs[0].duration,
    avgAtobTime: avg("atobTime"),
    avgAtobCalls: avg("atobCalls"),
    avgMem: avg("mem"),
    logs: allLogs.join("\n"),
    jitter:
      Math.max(...valid.map((r) => r.duration)) -
      Math.min(...valid.map((r) => r.duration)),
  };
}

async function main() {
  console.clear();
  console.log(renderBanner());

  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("-"));
  const iterations =
    parseInt(args.find((a) => a.startsWith("-n="))?.split("=")[1]) || 10;

  if (files.length < 2) {
    logger.error("Usage: vortex-perf <input.js> <output.js>");
    process.exit(1);
  }

  const [inputPath, outputPath] = files.map((f) => path.resolve(f));

  try {
    logger.start("VORTEX ANALYSIS ENGINE");

    logger.phase(1, 2, `Profiling Baseline: ${path.basename(inputPath)}`);
    const baseline = await profileScript(inputPath, iterations, 5000);
    logger.info(`Done. Size: ${(baseline.size / 1024).toFixed(2)} KB`);

    logger.phase(2, 2, `Profiling Target: ${path.basename(outputPath)}`);
    const target = await profileScript(outputPath, iterations, 5000);
    logger.info(`Done. Size: ${(target.size / 1024).toFixed(2)} KB`);

    // --- CALC METRICS ---
    const timeRatio = target.avgTime / baseline.avgTime;
    const sizeRatio = target.size / baseline.size;
    const parityMatch = baseline.logs === target.logs;

    // Efficiency Score: Higher is better (Speed + Size efficiency)
    const efficiency = (1000 / (timeRatio * sizeRatio)).toFixed(0);

    console.log("\n" + createDivider());
    console.log(COLORS.cyan.bold(" [📊] Detailed Performance Report"));

    printTable([
      {
        Metric: "Avg Execution",
        Baseline: `${baseline.avgTime.toFixed(3)} ms`,
        Target: `${target.avgTime.toFixed(3)} ms`,
        Impact:
          timeRatio > 1
            ? COLORS.red(`+${((timeRatio - 1) * 100).toFixed(1)}%`)
            : COLORS.green(`${(timeRatio * 100).toFixed(1)}%`),
      },
      {
        Metric: "Cold Start",
        Baseline: `${baseline.coldTime.toFixed(3)} ms`,
        Target: `${target.coldTime.toFixed(3)} ms`,
        Impact: COLORS.muted(`JIT Entry`),
      },
      {
        Metric: "Warm Avg (JIT)",
        Baseline: `${baseline.warmTime.toFixed(3)} ms`,
        Target: `${target.warmTime.toFixed(3)} ms`,
        Impact:
          target.warmTime < target.coldTime
            ? COLORS.green("Optimized")
            : COLORS.yellow("Static"),
      },
      {
        Metric: "Memory Heap",
        Baseline: `${(baseline.avgMem / 1024).toFixed(2)} KB`,
        Target: `${(target.avgMem / 1024).toFixed(2)} KB`,
        Impact:
          target.avgMem > baseline.avgMem
            ? COLORS.red("Bloat")
            : COLORS.green("Clean"),
      },
      {
        Metric: "File Size",
        Baseline: `${(baseline.size / 1024).toFixed(2)} KB`,
        Target: `${(target.size / 1024).toFixed(2)} KB`,
        Impact: COLORS.magenta(`x${sizeRatio.toFixed(2)}`),
      },
    ]);

    console.log("\n" + COLORS.cyan.bold(" [🛡] Integrity & Overhead"));
    const structuralOverhead = Math.max(
      0,
      target.avgTime - target.avgAtobTime - baseline.avgTime,
    );

    console.log(
      `  ${COLORS.text("Behavior Parity:")}  ${parityMatch ? COLORS.green("PASSED ✔") : COLORS.red("FAILED ✖ (Outputs differ)")}`,
    );
    console.log(
      `  ${COLORS.text("String Decrypt:")}  ${COLORS.yellow(target.avgAtobTime.toFixed(3) + " ms")} ${COLORS.muted(`(${target.avgAtobCalls} calls)`)}`,
    );
    console.log(
      `  ${COLORS.text("VM Logic Lag:")}    ${COLORS.red(structuralOverhead.toFixed(3) + " ms")}`,
    );
    console.log(
      `  ${COLORS.text("Jitter (STDEV):")}  ${COLORS.magenta(target.jitter.toFixed(3) + " ms")}`,
    );

    const scoreColor =
      efficiency > 500
        ? COLORS.green
        : efficiency > 200
          ? COLORS.yellow
          : COLORS.red;
    console.log(
      `\n  ${COLORS.gold.bold("VORTEX EFFICIENCY SCORE:")} ${scoreColor.bold(efficiency)} pts`,
    );

    console.log(createDivider());

    if (!parityMatch) {
      console.log(
        COLORS.red(
          "\n[!] WARNING: The obfuscated script produced different console output than the baseline.",
        ),
      );
    }
  } catch (err) {
    logger.error(err.message);
  }
}

main();
