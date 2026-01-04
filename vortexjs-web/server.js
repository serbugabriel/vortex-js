// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
// const parser = require("@babel/parser");
// const traverse = require("@babel/traverse").default;
const crypto = require("crypto");
const { obfuscate } = require("./dist/vortex");

const app = express();
const PORT = process.env.PORT || 3000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 160,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// --- HELMET config  ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "cdn.tailwindcss.com",
          "cdn.jsdelivr.net",
          "cdnjs.cloudflare.com",
        ],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "cdnjs.cloudflare.com",
          "fonts.googleapis.com",
        ],
        "font-src": ["'self'", "cdnjs.cloudflare.com", "fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": ["*"],
        "upgrade-insecure-requests": null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(morgan("dev"));
app.use(cors());
app.use(limiter);
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// useless as I just used acorn now
// app.post("/api/scan", (req, res) => {
//     try {
//         const { code } = req.body;
//         if (!code || typeof code !== "string") {
//             return res.json({ functions: [] });
//         }
//
//         const ast = parser.parse(code, {
//             sourceType: "module",
//             plugins: ["jsx", "typescript", "decorators-legacy"],
//         });
//
//         const functions = [];
//
//         traverse(ast, {
//             "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod"(
//                 path,
//             ) {
//                 if (!path.node.body || path.node.body.type !== "BlockStatement") return;
//
//                 let name = "anonymous";
//                 if (path.node.id) {
//                     name = path.node.id.name;
//                 } else if (path.node.key && path.node.key.name) {
//                     name = path.node.key.name;
//                 } else if (path.parent.key && path.parent.key.name) {
//                     name = path.parent.key.name;
//                 }
//
//                 const hasDirective = path.node.body.directives?.some(
//                     (d) => d.value.value === "use vortex",
//                 );
//                 const bodyLoc = path.node.body.loc.start;
//
//                 functions.push({
//                     name,
//                     line: path.node.loc.start.line - 1,
//                     bodyStart: {
//                         line: bodyLoc.line - 1,
//                         ch: bodyLoc.column + 1,
//                     },
//                     type: path.type,
//                     isVirtualized: !!hasDirective,
//                 });
//             },
//         });
//
//         res.json({ functions });
//     } catch (err) {
//         console.error(`[Scan Error] ${err.message}`);
//         res.status(400).json({ functions: [], error: err.message });
//     }
// });

app.post("/api/obfuscate", async (req, res) => {
  try {
    const { code, options = {} } = req.body;

    if (!code) {
      return res.status(400).json({ error: "No source code provided." });
    }

    const startTime = Date.now();
    const generationId = crypto.randomUUID();
    const currentDate = new Date().toISOString();
    const clientIp = req.ip || req.connection.remoteAddress || "Unknown";

    const vortexOptions = {
      minifyMode: !!options.minify,
      useTerser: !!options.terser,
      noTerser: !!options.noPost,
      noEnc: !options.stringEnc,
      opaquePredicates: !!options.opaque,
      opaqueLevel: parseInt(options.opaqueLevel) || 1,
      opaqueProb: parseFloat(options.opaqueProb) || 0.5,
      stateRandomization: !!options.randomize,
      antiDebug: !!options.antiDebug,
      dispatcher: options.dispatcher || "switch",
      maxSuperblockSize: parseInt(options.superblock) || 10,
      logger: {
        log: () => {},
        phase: () => {},
        branch: () => {},
        endPhase: () => {},
        info: () => {},
        warn: () => {},
        successResult: () => {},
        start: () => {},
        end: () => {},
        error: (e) => console.error(`[Vortex Error] ${e}`),
      },
    };

    const result = await obfuscate(code, vortexOptions);
    const duration = Date.now() - startTime;
    const header = `/**
        * Obfuscated by VortexJS 3.0.0
        * Generation ID: ${generationId}
        * Date: ${currentDate}
        * Request IP: ${clientIp}
        */
        `;
    const finalCode = header + result.code;

    res.json({
      success: true,
      code: finalCode,
      generationId: generationId, // Returning ID in response as well for reference
      stats: {
        time: duration,
        size: finalCode.length,
        modeLabel: result.modeLabel || "Default",
        optimization: result.stats || {},
      },
    });
  } catch (err) {
    console.error(`[Obfuscation Error] ${err.stack}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(`[Fatal Error] ${err.stack}`);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] Active on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
});
