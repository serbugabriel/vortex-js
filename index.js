#!/usr/bin/env node

/**
 * VortexJS CLI
 * by Seuriin
 *
 * Turns JavaScript into a SVM
 */

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const esbuildPath = require.resolve("esbuild");
const { transform } = require(esbuildPath);
const { minify } = require("terser");
const parser = require("@babel/parser");
const generator = require("@babel/generator").default;
const { performance } = require("perf_hooks");
const { spawn } = require("child_process");
const { StateMachineTransformer } = require("./src/transformer");

const version = `v${global.__APP_VERSION__ || "2.9.1"}`;

// --- COLORS ---
const COLORS = {
  text: chalk.hex("#C0C0C0"),
  muted: chalk.hex("#888888"),
  divider: chalk.hex("#555555"),
};

// --- UI HELPERS ---
const getTermWidth = () => process.stdout.columns || 80;
const createDivider = () => COLORS.divider("─".repeat(getTermWidth()));

function renderBanner() {
  const divider = createDivider();
  const title = chalk.cyanBright.bold(`VortexJS ${version}`);
  const subtitle = chalk.greenBright("by Seuriin (GitHub: SSL-ACTX)");
  const tagline = chalk.whiteBright("Turns JavaScript into a SVM");
  return [
    "",
    divider,
    ` ${title}`,
    ` ${subtitle}`,
    COLORS.text(" • " + tagline),
    divider,
    "",
  ].join("\n");
}

function showHelp() {
  console.log(renderBanner());
  console.log(chalk.whiteBright.bold(" Usage:"));
  console.log(`   ${chalk.cyan("vortex")} <input> <output> [flags]`);
  console.log("");
  console.log(chalk.whiteBright.bold(" Core Flags:"));
  console.log(
    `   ${chalk.yellow("--min")}                Minify output using esbuild.`,
  );
  console.log(
    `   ${chalk.yellow("--terser")}             Minify output using Terser (Aggressive).`,
  );
  console.log(
    `   ${chalk.yellow("--no-post")}            Disable post-processing (Raw Output).`,
  );
  console.log(
    `   ${chalk.yellow("--no-enc")}             Disable string encryption.`,
  );
  console.log("");
  console.log(chalk.whiteBright.bold(" Performance Tuning:"));
  console.log(
    `   ${chalk.yellow("--dispatcher <type>")}  Select dispatcher strategy:`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("switch")}  (Default) Standard switch-case.`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("bst")}     Binary Search Tree.`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("cluster")} Polymorphic Clusters.`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("chaos")} Polymorphic + Chaotic.`,
  );

  console.log(
    `   ${chalk.yellow("--superblock <size>")}  Max merged block size (Optimization).`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("2")}      (Default) Balanced security/speed.`,
  );
  console.log(
    `                           ${chalk.gray("•")} ${chalk.green("10+")}     High speed (reduced graph granularity).`,
  );
  console.log("");
  console.log(chalk.whiteBright.bold(" Security Options:"));
  console.log(
    `   ${chalk.yellow("--opq")}                Enable opaque predicates (Control Flow Hardening).`,
  );
  console.log(
    `   ${chalk.yellow("--opq-lvl <level>")}    Set opacity level: 'low', 'medium', 'high'.`,
  );
  console.log(
    `   ${chalk.yellow("--opq-prob <0-1>")}     Set injection probability (default: 0.2).`,
  );
  console.log(
    `   ${chalk.yellow("--randomize-ids")}      Randomize state IDs.`,
  );
  console.log(
    `   ${chalk.yellow("--anti-debug")}         Inject anti-debugging traps.`,
  );
  console.log("");
  console.log(chalk.whiteBright.bold(" Utility:"));
  console.log(
    `   ${chalk.yellow("--run, -r")}            Execute the output file immediately.`,
  );
  console.log(
    `   ${chalk.yellow("--watch, -w")}          Watch input file for changes.`,
  );
  console.log(
    `   ${chalk.yellow("--help, -h")}           Show this help message.`,
  );
  console.log("");
}

// --- TREE LOGGER ---
const logger = (() => {
  let levels = [];

  const getPrefix = (includeCurrentLevel = true) => {
    if (levels.length === 0) return "";
    let str = "";
    for (let i = 0; i < levels.length - 1; i++) {
      str += levels[i].isLast ? "   " : "│  ";
    }
    if (includeCurrentLevel && levels.length > 0) {
      const last = levels[levels.length - 1];
      str += last.isLast ? "   " : "│  ";
    }
    return str;
  };

  const write = (msg) => process.stderr.write(msg + "\n");

  return {
    start: (title) => {
      levels = [];
      write(chalk.cyan(`┌ ${title}`));
    },

    end: () => {
      levels = [];
      write(chalk.cyan("└─ Build Complete."));
    },

    phase: (n, total, msg) => {
      levels = [];
      const isLast = n === total;
      const branch = isLast ? "└─" : "├─";
      write(
        `${chalk.cyan(branch)} ${chalk.bold(n)}. ${chalk.whiteBright(msg)}`,
      );
      levels.push({ isLast: isLast });
    },

    endPhase: () => {
      if (levels.length > 0) levels.pop();
    },

    branch: (msg) => {
      const prefix = getPrefix(true);
      write(`${chalk.cyan(prefix)}├─ ${COLORS.text(msg)}`);
      levels.push({ isLast: false });
    },

    endBranch: () => {
      if (levels.length > 1) levels.pop();
    },

    info: (msg) => {
      const prefix = getPrefix(true);
      const lines = msg.split("\n");
      lines.forEach((line, idx) => {
        const connector = idx === 0 ? "├─" : "│ ";
        write(`${chalk.cyan(prefix)}${connector} ${COLORS.text(line)}`);
      });
    },

    log: (msg) => {
      const prefix = getPrefix(true);
      const lines = msg.split("\n");
      lines.forEach((line) => {
        write(`${chalk.cyan(prefix)}│  ${COLORS.text(line)}`);
      });
    },

    warn: (msg) => {
      const prefix = getPrefix(true);
      write(`${chalk.cyan(prefix)}│  ${chalk.yellow(msg)}`);
    },

    successResult: (msg) => {
      write("");
      write(chalk.green(`[✔] ${msg}`));
    },

    error: (msg) => write(chalk.red(`\n[✖] ${msg}`)),
  };
})();

const formatKB = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;
const formatTime = (ms) =>
  ms > 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;

const silentLogger = new Proxy({}, { get: () => () => {} });

/**
 * The core transformation logic.
 */
async function obfuscate(sourceCode, options = {}) {
  const {
    minifyMode = false,
    useTerser = false,
    noTerser = false,
    noEnc = false,
    opaquePredicates = false,
    opaqueLevel = "medium",
    opaqueProb = 0.2,
    stateRandomization = false,
    antiDebug = false,
    dispatcher = "switch",
    maxSuperblockSize = 2,
    logger: log = silentLogger,
  } = options;

  const TOTAL_PHASES = 3;

  // --- Phase 1 ---
  log.phase(1, TOTAL_PHASES, "Parsing & Analysis");
  const ast = parser.parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "classProperties"],
    allowReturnOutsideFunction: true, // For loose CJS compatibility
  });

  const transformer = new StateMachineTransformer(ast, log, {
    noEncryption: noEnc,
    opaquePredicates,
    opaqueLevel,
    opaqueProb,
    stateRandomization,
    antiDebug,
    dispatcher,
    maxSuperblockSize,
  });
  log.endPhase();

  // --- Phase 2 ---
  log.phase(2, TOTAL_PHASES, "State Machine Transformation");
  const { ast: resultAst, stats: optimizationStats, isESM } = transformer.run();
  log.endPhase();

  // --- Phase 3 ---
  log.phase(3, TOTAL_PHASES, "Code Generation & Optimization");
  const { code: flattenedCode } = generator(resultAst);

  let finalCode = flattenedCode;
  let modeLabel = "Raw Flattened";

  if (!noTerser) {
    if (useTerser) {
      log.info("Minifying with Terser (aggressive)...");
      const result = await minify(flattenedCode, {
        compress: {
          passes: 3,
          pure_getters: true,
          unsafe: true,
          unsafe_math: true,
          unsafe_methods: true,
          toplevel: true,
          evaluate: false,
        },
        mangle: { toplevel: true },
        format: minifyMode
          ? {} // { beautify: true, indent_level: 2, braces: true }
          : { beautify: true, indent_level: 2, braces: true },
      });
      if (!result.code) throw new Error("Terser returned no output.");
      finalCode = result.code;
      modeLabel = minifyMode ? "Minified (Terser)" : "Beautified (Terser)";
    } else {
      log.info(
        `Processing with esbuild (${minifyMode ? "minify" : "format"})...`,
      );
      const result = await transform(flattenedCode, {
        minify: minifyMode,
        target: "node16",
        loader: "js",
        legalComments: "none",
        charset: "utf8",
      });
      if (!result.code) throw new Error("esbuild returned no output.");
      finalCode = result.code;
      modeLabel = minifyMode ? "Minified (esbuild)" : "Formatted (esbuild)";
    }
  } else {
    log.info("Skipping post-processing (--no-post)");
    modeLabel = "Raw Flattened";
  }
  log.endPhase();

  return { code: finalCode, modeLabel, stats: optimizationStats, isESM };
}

function renderConfig(files, flags) {
  const [inputFile, outputFile] = files;
  const divider = createDivider();

  console.log(chalk.cyanBright.bold(" [⚙] Configuration"));
  console.log(divider);

  console.log(`  ${chalk.white("Input:")}  ${chalk.yellow(inputFile)}`);
  console.log(`  ${chalk.white("Output:")} ${chalk.yellow(outputFile)}`);
  console.log("");

  let postProcessor = chalk.cyan("esbuild (Default)");
  if (flags.noTerser) postProcessor = COLORS.muted("Disabled");
  else if (flags.useTerser) postProcessor = chalk.yellow("Terser (Aggressive)");

  console.log(`  ${chalk.white("Post-Processing:")}   ${postProcessor}`);
  console.log(
    `  ${chalk.white("Minification:")}      ${
      flags.minifyMode ? chalk.green("Enabled") : COLORS.muted("Disabled")
    }`,
  );
  console.log("");
  console.log(
    `  ${chalk.white("Dispatcher:")}        ${chalk.magenta(flags.dispatcher)}`,
  );

  const sbColor = flags.maxSuperblockSize >= 10 ? chalk.green : chalk.yellow;
  console.log(
    `  ${chalk.white("Superblock Merge:")}  ${sbColor(flags.maxSuperblockSize)} ${COLORS.muted("(Ops per block)")}`,
  );

  console.log(
    `  ${chalk.white("String Encryption:")} ${
      !flags.noEnc ? chalk.green("Enabled") : chalk.red("Disabled")
    }`,
  );

  if (flags.opaquePredicates) {
    console.log(
      `  ${chalk.white("Opaque Predicates:")} ${chalk.green("Enabled")} ${COLORS.muted(
        `(lvl: ${flags.opaqueLevel}, prob: ${flags.opaqueProb})`,
      )}`,
    );
  } else {
    console.log(
      `  ${chalk.white("Opaque Predicates:")} ${COLORS.muted("Disabled")}`,
    );
  }

  console.log(
    `  ${chalk.white("State Randomization:")} ${
      flags.stateRandomization
        ? chalk.green("Enabled")
        : COLORS.muted("Disabled")
    }`,
  );
  console.log(
    `  ${chalk.white("Anti-Debugging:")}    ${
      flags.antiDebug ? chalk.green("Enabled") : COLORS.muted("Disabled")
    }`,
  );
  console.log("");
  console.log(
    `  ${chalk.white("Watch Mode:")}        ${
      flags.watch ? chalk.green("Enabled") : COLORS.muted("Disabled")
    }`,
  );
  console.log(
    `  ${chalk.white("Auto-Run:")}          ${
      flags.run ? chalk.green("Enabled") : COLORS.muted("Disabled")
    }`,
  );
  console.log(divider + "\n");
}

async function main() {
  const args = process.argv.slice(2);

  // Help Check
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    showHelp();
    process.exit(0);
  }

  console.clear();
  console.log(renderBanner());

  const flags = {
    minifyMode: false,
    useTerser: false,
    noTerser: false,
    noEnc: false,
    opaquePredicates: false,
    opaqueLevel: "medium",
    opaqueProb: 0.2,
    stateRandomization: false,
    antiDebug: false,
    dispatcher: "switch", // Default
    maxSuperblockSize: 2, // Default safe value
    watch: false,
    run: false,
  };
  const files = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--min") flags.minifyMode = true;
    else if (arg === "--terser") {
      flags.useTerser = true;
      flags.minifyMode = true;
    } else if (arg === "--no-post") flags.noTerser = true;
    else if (arg === "--no-enc") flags.noEnc = true;
    else if (arg === "--opq") flags.opaquePredicates = true;
    else if (arg === "--randomize-ids") flags.stateRandomization = true;
    else if (arg === "--anti-debug") flags.antiDebug = true;
    else if (arg === "--watch" || arg === "-w") flags.watch = true;
    else if (arg === "--run" || arg === "-r") flags.run = true;
    else if (arg === "--dispatcher") {
      if (i + 1 < args.length) flags.dispatcher = args[++i];
    } else if (arg === "--superblock") {
      if (i + 1 < args.length)
        flags.maxSuperblockSize = parseInt(args[++i], 10);
    } else if (arg === "--opq-lvl") {
      if (i + 1 < args.length) flags.opaqueLevel = args[++i];
    } else if (arg === "--opq-prob") {
      if (i + 1 < args.length) flags.opaqueProb = parseFloat(args[++i]);
    } else {
      files.push(arg);
    }
  }

  if (files.length < 2) {
    logger.error(
      "Usage: " + chalk.yellow("vortex <inputFile> <outputFile> [flags]"),
    );
    process.exit(1);
  }

  const [inputFile, outputFile] = files;
  const inputPath = path.resolve(process.cwd(), inputFile);
  const outputPath = path.resolve(process.cwd(), outputFile);

  renderConfig(files, flags);

  if (!fs.existsSync(inputPath)) {
    logger.error(`Input file not found at '${inputPath}'`);
    process.exit(1);
  }

  let activeChild = null;

  const killActiveChild = () => {
    if (activeChild) {
      activeChild.kill();
      activeChild = null;
    }
  };

  const runOutput = () => {
    killActiveChild();
    console.log(COLORS.text(`\n[⚙] Running: node ${outputFile}`));
    activeChild = spawn(process.execPath, [outputPath], { stdio: "inherit" });
    activeChild.on("close", (code) => {
      if (code !== null && code !== 0) {
        console.log(chalk.red(`\n[✖] Process exited with code ${code}`));
      }
    });
  };

  const executeBuild = async () => {
    const freshSourceCode = fs.readFileSync(inputPath, "utf8");
    const startTime = performance.now();

    try {
      logger.start("VORTEX BUILD");

      const {
        code: finalCode,
        modeLabel,
        isESM,
      } = await obfuscate(freshSourceCode, {
        ...flags,
        logger,
      });

      logger.end();

      fs.writeFileSync(outputPath, finalCode, "utf8");

      const endTime = performance.now();
      const duration = endTime - startTime;
      const afterSize = fs.statSync(outputPath).size;

      logger.successResult(
        `Built in ${chalk.bold(formatTime(duration))} ` +
          COLORS.muted(`(${modeLabel}) `) +
          chalk.magenta(`${formatKB(afterSize)}`),
      );

      // Warning for ESM/CommonJS mismatch
      if (isESM && path.extname(outputPath) === ".js") {
        console.log("");
        logger.warn(
          "Output contains ESM syntax (import/export) but uses a .js extension.",
        );
        logger.warn(
          "Node.js may fail to run this file unless you use the .mjs extension",
        );
        logger.warn('or set "type": "module" in your package.json.');
      }

      if (flags.run) {
        runOutput();
      }
    } catch (err) {
      console.error(chalk.redBright("\n[ERROR] Transformation failed:"));
      console.error(err.message);
      if (err.stack) console.error(COLORS.muted(err.stack));
    }
  };

  await executeBuild();

  if (flags.watch) {
    console.log(
      chalk.cyanBright(`\n[👀] Watch mode enabled. Waiting for changes...`),
    );
    let debounceTimer;

    fs.watch(inputPath, (eventType) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.clear();
        console.log(renderBanner());
        renderConfig(files, flags);
        console.log(
          chalk.yellow(
            `[⟳] File change detected (${eventType}). Rebuilding...`,
          ),
        );
        executeBuild();
      }, 100);
    });
  }
}

module.exports = { obfuscate };
if (require.main === module) {
  main();
}
