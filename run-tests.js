// run-tests.js — HYBRID MODE

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const util = require("util");
const chalk = require("chalk");
const { performance } = require("perf_hooks");
const { spawn } = require("child_process");
const { obfuscate } = require("./index");


const CONCURRENCY_LIMIT = 3;
const EXEC_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB
const NODE_HEAP_MB = 128;

const COLORS = {
  text: chalk.hex("#e8e8e8"),
  muted: chalk.hex("#27c9ea"),
  divider: chalk.hex("#555555"),
};

const getTermWidth = () => process.stdout.columns || 80;
const createDivider = () => COLORS.divider("─".repeat(getTermWidth()));

// This prevents the runner from crashing when obfuscated code throws async errors
process.on("uncaughtException", (err) => {
  // Silently handle or log to a debug file if needed
});

process.on("unhandledRejection", (reason) => {
  // Silently handle
});

const logger = (() => {
  const write = (msg) => process.stderr.write(msg + "\n");

  return {
    start: (title) => {
      write(chalk.cyan(`┌ ${title}`));
    },
    end: () => {
      write(chalk.cyan("└─ Testing Complete."));
    },
    testItem: (name, status, method, isLast) => {
      const connector = isLast ? "└─" : "├─";
      let statusIcon =
        status === "PASSED" ? chalk.green("✔") : chalk.red("✖");
      let methodTag = method ? COLORS.muted(` [${method}]`) : "";
      write(
        `${chalk.cyan(connector)} ${statusIcon} ${COLORS.text(name)}${methodTag}`,
      );
    },
    info: (msg) => {
      write(`${chalk.cyan("│ ")} ${COLORS.text(msg)}`);
    },
    error: (msg) => {
      const lines = msg.split("\n");
      lines.forEach((l) => write(`${chalk.cyan("│ ")} ${chalk.red(l)}`));
    },
  };
})();


function normalizeOutput(output) {
  if (!output) return "";
  return output
    .toString()
    .replace(/\r\n/g, "\n")
    .replace(/\[Function \(anonymous\)\]/g, "[Function]")
    .replace(/\[Function:\s*[^\]]+\]/g, "[Function]")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
}

function formatTime(ms) {
  return ms > 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}


function buildVmSandbox(filePath, stdout, stderr) {
  const sandbox = {
    console: new Proxy(
      {},
      {
        get(target, prop) {
          return (...args) => {
            const output = util.format(...args) + "\n";
            if (["log", "info", "warn"].includes(prop))
              stdout.content += output;
            else if (prop === "error") stderr.content += output;
          };
        },
      },
    ),
    process: {
      stdout: {
        write: (chunk) => {
          stdout.content += chunk.toString();
        },
      },
      stderr: {
        write: (chunk) => {
          stderr.content += chunk.toString();
        },
      },
      exit: (code) => {
        throw new Error(`process.exit(${code}) called`);
      },
      nextTick: process.nextTick,
      env: { ...process.env },
    },
    Buffer,
    require,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    atob,
    btoa,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto,
    fetch,
    Headers,
    Request,
    Response,
    AbortController,
    AbortSignal,
    queueMicrotask,
  };
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  sandbox.__filename = filePath;
  sandbox.__dirname = path.dirname(filePath);
  sandbox.global = sandbox;
  return sandbox;
}

async function execInVm(code, filePath) {
  const stdout = { content: "" };
  const stderr = { content: "" };

  try {
    const context = vm.createContext(buildVmSandbox(filePath, stdout, stderr));
    const script = new vm.Script(
      `(function(exports, require, module, __filename, __dirname) {
      try {
        ${code}
      } catch(e) {
        console.error(e.stack);
      }
    });`,
      { filename: filePath },
    );

    const wrapper = script.runInContext(context, { timeout: EXEC_TIMEOUT_MS });
    wrapper.call(
      context.module.exports,
      context.exports,
      context.require,
      context.module,
      context.__filename,
      context.__dirname,
    );

    // Allow minor settling time for microtasks
    await new Promise((r) => setTimeout(r, 10));
  } catch (err) {
    if (err.code === "ERR_SCRIPT_EXECUTION_TIMED_OUT")
      throw new Error("TIMEOUT");
    stderr.content += err.stack || err.message;
  }
  return { combined: stdout.content + stderr.content };
}

function execInChildProcess(scriptPath) {
  return new Promise((resolve) => {
    let stdout = "",
      stderr = "";
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${NODE_HEAP_MB}`, "--no-warnings", scriptPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, EXEC_TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d;
    });

    child.on("error", (err) => {
      stderr += err.message;
    });

    child.on("close", () => {
      clearTimeout(timer);
      resolve({ combined: stdout + stderr });
    });
  });
}

async function runTest(testFile, testsDir, tempOutputDir) {
  const inputFile = path.join(testsDir, testFile);
  const tempOutputFile = path.join(tempOutputDir, `obf_${testFile}`);

  try {
    const source = await fs.promises.readFile(inputFile, "utf8");

    // Obfuscate
    let obfuscatedCode;
    try {
      const result = await obfuscate(source, {
        logger: {
          phase: () => {},
          endPhase: () => {},
          branch: () => {},
          info: () => {},
          endBranch: () => {},
        },
      });
      obfuscatedCode = result.code;
    } catch (obfErr) {
      return {
        file: testFile,
        status: "FAILED",
        reason: `Obfuscation Error: ${obfErr.message}`,
      };
    }

    // Attempt VM Mode
    const originalVm = await execInVm(source, inputFile);
    const obfuscatedVm = await execInVm(obfuscatedCode, "obfuscated.js");

    if (
      normalizeOutput(originalVm.combined) ===
      normalizeOutput(obfuscatedVm.combined)
    ) {
      return { file: testFile, status: "PASSED", method: "VM" };
    }

    // Fallback to Child Process (more isolation)
    const originalChild = await execInChildProcess(inputFile);
    await fs.promises.writeFile(tempOutputFile, obfuscatedCode);
    const obfuscatedChild = await execInChildProcess(tempOutputFile);

    if (
      normalizeOutput(originalChild.combined) ===
      normalizeOutput(obfuscatedChild.combined)
    ) {
      return { file: testFile, status: "PASSED", method: "Fallback" };
    }

    return {
      file: testFile,
      status: "FAILED",
      reason: "Output mismatch",
      expected: originalChild.combined,
      actual: obfuscatedChild.combined,
    };
  } catch (err) {
    return { file: testFile, status: "FAILED", reason: err.message };
  }
}

const testsDir = path.join(__dirname, "tests");
const tempOutputDir = path.join(__dirname, "temp_test_output");

async function main() {
  console.clear();
  console.log(createDivider());
  console.log(` ${chalk.cyanBright.bold("VortexJS Test Suite")}`);
  console.log(` ${chalk.greenBright("Hybrid Execution Mode (Resilient)")}`);
  console.log(createDivider() + "\n");

  if (!fs.existsSync(testsDir)) {
    console.log(chalk.red("Error: 'tests' directory not found."));
    process.exit(1);
  }

  const files = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".js"))
    .sort();
  fs.rmSync(tempOutputDir, { recursive: true, force: true });
  fs.mkdirSync(tempOutputDir, { recursive: true });

  logger.start(`RUNNING ${files.length} TESTS`);
  const startTime = performance.now();

  const results = [];
  const queue = [...files];
  let completedCount = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      try {
        const res = await runTest(file, testsDir, tempOutputDir);
        results.push(res);
      } catch (criticalErr) {
        results.push({
          file,
          status: "FAILED",
          reason: `Runner Error: ${criticalErr.message}`,
        });
      } finally {
        completedCount++;
        const lastRes = results[results.length - 1];
        logger.testItem(
          lastRes.file,
          lastRes.status,
          lastRes.method,
          completedCount === files.length,
        );
      }
    }
  };

  // Run workers
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY_LIMIT, files.length) }, worker),
  );

  const endTime = performance.now();
  logger.end();

  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED");

  if (failed.length > 0) {
    console.log(`\n${chalk.red.bold(" [✖] Failure Details")}`);
    console.log(createDivider());
    failed.forEach((f) => {
      console.log(
        `${chalk.red(" ● ")}${chalk.white(f.file)}: ${chalk.yellow(f.reason)}`,
      );
      if (f.expected || f.actual) {
        const exp = (f.expected || "").trim().substring(0, 100);
        const act = (f.actual || "").trim().substring(0, 100);
        console.log(COLORS.muted(`   Expected: ${exp}...`));
        console.log(COLORS.muted(`   Actual:   ${act}...`));
      }
    });
  }

  console.log(`\n${chalk.cyanBright.bold(" [📊] Summary")}`);
  console.log(createDivider());
  console.log(`  ${chalk.white("Total Tests:")}  ${files.length}`);
  console.log(`  ${chalk.white("Passed:")}       ${chalk.green(passed)}`);
  console.log(
    `  ${chalk.white("Failed:")}       ${failed.length > 0 ? chalk.red(failed.length) : chalk.green(0)}`,
  );
  console.log(
    `  ${chalk.white("Duration:")}     ${COLORS.text(formatTime(endTime - startTime))}`,
  );
  console.log(createDivider() + "\n");

  fs.rmSync(tempOutputDir, { recursive: true, force: true });
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal Runner Error:", err);
  process.exit(1);
});
