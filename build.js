#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const chalk = require("chalk");
const { performance } = require("perf_hooks");
const pkg = require("./package.json");

const appVersion = pkg.version;
const distDir = "dist";
const outFile = path.join(distDir, "vortex");
const includeTerser = !process.argv.includes("--no-terser");

const COLORS = {
  text: chalk.hex("#C0C0C0"),
  muted: chalk.hex("#888888"),
  divider: chalk.hex("#555555"),
  success: chalk.green,
  error: chalk.red,
  highlight: chalk.cyanBright,
};

const getTermWidth = () => process.stdout.columns || 80;
const createDivider = (char = "─") =>
  COLORS.divider(char.repeat(getTermWidth()));
const formatKB = (bytes) => `${(bytes / 1024).toFixed(2)} KB`.padStart(10, " ");
const formatTime = (ms) =>
  ms > 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;

// goofy spinner
const spinner = (() => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let interval;
  let frameIndex = 0;

  return {
    start: (text) => {
      process.stdout.write("\n");
      interval = setInterval(() => {
        const frame = chalk.cyan(frames[frameIndex]);
        frameIndex = (frameIndex + 1) % frames.length;
        process.stdout.write(`\r ${frame} ${COLORS.text(text)}`);
      }, 80);
    },
    stop: (isSuccess, text) => {
      clearInterval(interval);
      const icon = isSuccess ? chalk.green("✔") : chalk.red("✖");
      process.stdout.write(`\r ${icon} ${COLORS.muted(text)}\n`);
    },
  };
})();

// plugin
const stripShebangPlugin = {
  name: "strip-shebang",
  setup(build) {
    build.onLoad({ filter: /index\.js$/ }, async (args) => {
      let contents = await fs.promises.readFile(args.path, "utf8");
      if (contents.startsWith("#!")) {
        contents = contents.slice(contents.indexOf("\n") + 1);
      }
      return { contents, loader: "js" };
    });
  },
};

/**
 * A plugin to replace the 'terser' module with a stub if it's excluded.
 * The stub throws an error if the user tries to use Terser-specific features.
 */
const terserStubPlugin = {
  name: "terser-stub",
  setup(build) {
    // Intercept any attempt to resolve the 'terser' package
    build.onResolve({ filter: /^terser$/ }, (args) => {
      return { path: args.path, namespace: "terser-stub-ns" };
    });

    // Provide the contents for our virtual 'terser-stub' module
    build.onLoad({ filter: /.*/, namespace: "terser-stub-ns" }, () => {
      const contents = `
            export const minify = () => {
                throw new Error("Terser functionality is not available in this 'lite' build. Please rebuild without the --no-terser flag to use this feature.");
            };
            `;
      return { contents, loader: "js" };
    });
  },
};


function analyzeBundle(metafile, buildTime) {
  const stats = Object.entries(metafile.inputs).map(([path, data]) => ({
    path,
    size: data.bytes,
  }));

  stats.sort((a, b) => b.size - a.size);
  const totalSize = stats.reduce((acc, s) => acc + s.size, 0);

  console.log(`\n${COLORS.highlight.bold(" [📊] Bundle Analysis")}`);
  console.log(createDivider());

  console.log(
    chalk.white("Rank".padEnd(5)) +
      chalk.white("Size".padStart(12)) +
      chalk.white("%".padStart(8)) +
      "  " +
      chalk.white("Module"),
  );
  console.log(
    COLORS.muted("──".padEnd(5)) +
      COLORS.muted("".padStart(12, "─")) +
      COLORS.muted("".padStart(8, "─")) +
      "  " +
      COLORS.muted("".padEnd(40, "─")),
  );

  stats.slice(0, 10).forEach((file, index) => {
    const percent = ((file.size / totalSize) * 100).toFixed(2);
    const rank = `${index + 1}.`.padEnd(5);
    const size = formatKB(file.size);
    const percentStr = `${percent}%`.padStart(7);
    const pathStr = COLORS.muted(file.path.replace(process.cwd() + "/", ""));
    console.log(
      `${rank}${chalk.magenta(size)} ${chalk.green(percentStr)}   ${pathStr}`,
    );
  });

  const otherFiles = stats.length - 10;
  if (otherFiles > 0) {
    console.log(COLORS.muted(`\n...and ${otherFiles} other smaller modules.`));
  }

  const finalStats = fs.statSync(outFile);
  console.log(`\n${COLORS.highlight.bold(" [📦] Build Summary")}`);
  console.log(createDivider());
  console.log(`  ${chalk.white("Target:")}     ${chalk.yellow(outFile)}`);
  console.log(
    `  ${chalk.white("Final Size:")} ${chalk.magenta(formatKB(finalStats.size))}`,
  );
  console.log(
    `  ${chalk.white("Terser:")}     ${includeTerser ? chalk.green("Included") : chalk.yellow("Excluded")}`,
  );
  console.log(
    `  ${chalk.white("Time:")}       ${COLORS.text(formatTime(buildTime))}`,
  );
  console.log(`  ${chalk.white("Install:")}    ${COLORS.muted("npm link")}`);
  console.log(createDivider() + "\n");
}


async function build() {
  console.clear();
  const startTime = performance.now();

  // Banner
  console.log(createDivider());
  console.log(
    ` ${COLORS.highlight.bold("VortexJS Builder")} ${chalk.greenBright(`v${appVersion}`)}`,
  );
  console.log(createDivider());

  const buildPlugins = [stripShebangPlugin];
  if (!includeTerser) {
    buildPlugins.push(terserStubPlugin);
    console.log(
      chalk.yellow("Building in 'lite' mode (Terser will be excluded).\n"),
    );
  }

  try {
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir);

    spinner.start("Bundling, Minifying, and Analyzing...");

    const result = await esbuild.build({
      entryPoints: ["index.js"],
      outfile: outFile,
      bundle: true,
      platform: "node",
      target: "node12",
      minify: true,
      sourcemap: false,
      metafile: true,
      define: { "global.__APP_VERSION__": JSON.stringify(appVersion) },
      banner: { js: "#!/usr/bin/env node" },
      plugins: buildPlugins,
      logOverride: { "require-resolve-not-external": "silent" },
    });

    spinner.stop(true, "Build process complete!");

    fs.chmodSync(outFile, "755");

    const endTime = performance.now();
    analyzeBundle(result.metafile, endTime - startTime);
  } catch (error) {
    spinner.stop(false, "Build failed unexpectedly.");
    console.error(COLORS.muted(error.stack || error.message));
    process.exit(1);
  }
}

build();
