/**
 * @file transformer.js
 * @description The main entry point for the VortexJS transformation pipeline.
 * Orchestrates the conversion of standard JavaScript AST into a protected, virtualized
 * state machine. Handles preprocessing, memory allocation, IR generation, and code reconstruction.
 */

const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const IRGenerator = require("./ir-gen/ir-generator");
const ASTGenerator = require("./ast-gen/index");
const IROptimizer = require("./ir-optimizer");
const StringConcealer = require("./string-concealer");
const StringCollector = require("./string-collector");
const OpaquePredicateManager = require("./obfuscation/opaque-predicate-manager");
// const PropertyNameMangler = require("./property-name-mangler"); - useless as we already convert properties into flat ones

/**
 * Orchestrates the transformation of JavaScript AST into the Vortex Virtual Machine format.
 */
class StateMachineTransformer {
  /**
   * @param {Object} ast - The input Babel AST.
   * @param {Object} [logger] - Custom logger object.
   * @param {Object} [options] - Configuration options.
   * @param {boolean} [options.noEncryption] - Disable string encryption.
   * @param {boolean} [options.opaquePredicates] - Enable control flow hardening.
   * @param {string} [options.opaqueLevel] - Intensity of opaque predicates ('low', 'medium', 'high').
   * @param {number} [options.opaqueProb] - Probability of inserting opaque predicates (0.0 - 1.0).
   * @param {boolean} [options.stateRandomization] - Randomize state IDs to prevent pattern analysis.
   * @param {string} [options.dispatcher] - Type of dispatcher to use ('switch' or others).
   * @param {number} [options.maxSuperblockSize] - Maximum instructions per superblock.
   */
  constructor(ast, logger = null, options = {}) {
    this.ast = ast;
    this.memoryMap = new Map();
    this.globalIds = new Set();
    this.states = [];
    this.functionStartStates = new Map();

    // Configuration
    this.noEncryption = options.noEncryption || false;
    this.opaquePredicates = options.opaquePredicates || false;
    this.opaqueLevel = options.opaqueLevel || "medium";
    this.opaqueProb = options.opaqueProb || 0.2;
    this.stateRandomization = options.stateRandomization || false;
    this.dispatcher = options.dispatcher || "switch";
    this.maxSuperblockSize = options.maxSuperblockSize || 10;

    // Sub-components
    this.stringConcealer = new StringConcealer();
    this.stringCollector = new StringCollector(
      this.stringConcealer,
      this.noEncryption,
    );

    // Globals that should be treated as external dependencies (proxied via GM)
    this.candidateGlobals = [
      "console",
      "Math",
      "Object",
      "Array",
      "Symbol",
      "Function",
      "WeakMap",
      "WeakRef",
      "Promise",
      "Reflect",
      "Date",
      "Proxy",
      "Error",
      "JSON",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Uint8Array",
      "ArrayBuffer",
    ];

    this.preloadedGlobals = [];
    this.imports = [];
    this.reExports = [];

    this.logger = logger || {
      log: () => {},
      phase: () => {},
      branch: () => {},
      endBranch: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
    };

    this.opaqueManager = this.opaquePredicates
    ? new OpaquePredicateManager(this.opaqueLevel, this.opaqueProb)
    : null;

    // Partial Virtualization State
    this.partialMode = false;
    this.virtualizedNodes = new Set(); // Set<Node>
  }

  /**
   * Executes the full transformation pipeline.
   * @returns {Object} Result object containing the new AST, stats, and ESM status.
   */
  run() {
    // 1. Preprocess Imports/Exports (ESM Support)
    // We must strip these from the logic body to maintain valid syntax inside the VM.
    this.preprocessImportsAndExports();

    // 2. Identify targets for virtualization
    // Checks for "use vortex" directives to enable partial mode.
    this.identifyTargets();

    // const propertyMangler = new PropertyNameMangler();
    // propertyMangler.collect(this.ast);
    // propertyMangler.mangle(this.ast);
    // this.logger.branch(
    //   `Mangled ${propertyMangler.mangledMap.size} property names.`,
    // );

    // 3. Collect strings
    // In partial mode, only strings within targeted scopes are collected.
    this.stringCollector.collect(
      this.ast,
      this.partialMode ? this.virtualizedNodes : null,
    );
    this.stringCollector.finalize();

    // 4. Memory Allocation
    this.analyzeUsedGlobals();
    this.collectGlobalsAndAllocateRegisters();

    // 5. Prepare Context
    const context = {
      ast: this.ast,
      memoryMap: this.memoryMap,
      globalIds: this.globalIds,
      states: this.states,
      functionStartStates: this.functionStartStates,
      stringConcealer: this.stringConcealer,
      stringCollector: this.stringCollector,
      preloadedGlobals: this.preloadedGlobals,
      logger: this.logger,
      noEncryption: this.noEncryption,
      // propertyManglerMap: propertyMangler.mangledMap,
      opaqueManager: this.opaqueManager,
      stateRandomization: this.stateRandomization,
      dispatcher: this.dispatcher,
      maxSuperblockSize: this.maxSuperblockSize,
      partialMode: this.partialMode,
      virtualizedNodes: this.virtualizedNodes,
      imports: this.imports,
      reExports: this.reExports,
    };

    // 6. IR Generation
    // Transforms the AST into a flat list of states.
    const irGenerator = new IRGenerator(context);
    irGenerator.transformToStates();

    // 7. IR Optimization
    // Performs passes like dead code elimination, constant folding, etc.
    const irOptimizer = new IROptimizer(context);
    const count = irOptimizer.run();
    const optimizationStats = irOptimizer.stats;
    if (count > 0) {
      this.logger.branch(`Applied ${count} IR optimizations.`);
    }

    // 8. AST Reconstruction
    // Builds the final VM loop and injects it back into the program.
    const astGenerator = new ASTGenerator(context);
    const finalAst = astGenerator.buildFinalAST();

    // Determine if ESM syntax is present in the output
    const isESM = this.imports.length > 0 || this.reExports.length > 0;

    return { ast: finalAst, stats: optimizationStats, isESM };
  }

  /**
   * Handles ESM specific syntax (import/export).
   * VM logic cannot contain these keywords, so they are separated.
   * Imports are hoisted, Exports are converted to assignments + re-exports.
   */
  preprocessImportsAndExports() {
    this.imports = [];
    this.reExports = [];
    const newBody = [];

    // Filter and process AST body for ESM nodes
    for (const node of this.ast.program.body) {
      if (t.isImportDeclaration(node)) {
        this.imports.push(node);
        // We do not add the bindings to preloadedGlobals manually here;
        // analyzeUsedGlobals will automatically pick them up as "unbound" globals
        // because we are removing the ImportDeclaration from the AST below.
        continue;
      }

      if (t.isExportNamedDeclaration(node)) {
        if (node.declaration) {
          // Handle: export const a = 1; -> const a = 1; (keep in body), append export { a }
          newBody.push(node.declaration);

          const specifiers = [];
          if (t.isVariableDeclaration(node.declaration)) {
            node.declaration.declarations.forEach((decl) => {
              if (t.isIdentifier(decl.id)) {
                specifiers.push(t.exportSpecifier(decl.id, decl.id));
              }
            });
          } else if (
            t.isFunctionDeclaration(node.declaration) ||
            t.isClassDeclaration(node.declaration)
          ) {
            if (node.declaration.id) {
              specifiers.push(
                t.exportSpecifier(node.declaration.id, node.declaration.id),
              );
            }
          }

          if (specifiers.length > 0) {
            this.reExports.push(t.exportNamedDeclaration(null, specifiers));
          }
          continue;
        } else {
          // Handle: export { a }; -> Remove from logic, append to end
          this.reExports.push(node);
          continue;
        }
      }

      if (t.isExportDefaultDeclaration(node)) {
        // Handle: export default function f() {}
        if (
          t.isFunctionDeclaration(node.declaration) ||
          t.isClassDeclaration(node.declaration)
        ) {
          let id = node.declaration.id;
          if (!id) {
            id = t.identifier("_default_export");
            node.declaration.id = id;
          }
          newBody.push(node.declaration);
          this.reExports.push(t.exportDefaultDeclaration(id));
          continue;
        }
        // Handle: export default expression; -> const _default = expression; export default _default;
        const tempId = t.identifier("_default_export");
        const varDecl = t.variableDeclaration("const", [
          t.variableDeclarator(tempId, node.declaration),
        ]);
        newBody.push(varDecl);
        this.reExports.push(t.exportDefaultDeclaration(tempId));
        continue;
      }

      if (t.isExportAllDeclaration(node)) {
        this.reExports.push(node);
        continue;
      }

      newBody.push(node);
    }

    this.ast.program.body = newBody;
  }

  /**
   * Scans the AST for "use vortex" directives to enable partial virtualization.
   * If found, only the marked scopes are processed.
   */
  identifyTargets() {
    let hasDirectives = false;

    // Check Program (Top-level)
    if (this.hasDirective(this.ast.program.directives)) {
      this.virtualizedNodes.add(this.ast.program);
      hasDirectives = true;
      this.removeDirective(this.ast.program);
    }

    traverse(this.ast, {
      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod":
      (path) => {
        if (path.node.body && this.hasDirective(path.node.body.directives)) {
          this.virtualizedNodes.add(path.node);
          hasDirectives = true;
          this.removeDirective(path.node.body);
          this.logger.log(
            `Targeted function: ${path.node.id ? path.node.id.name : "anonymous"}`,
          );
        }
      },
    });

    if (hasDirectives) {
      this.partialMode = true;
      this.logger.branch("Partial Virtualization Mode Enabled.");
      this.logger.log(`Targeted ${this.virtualizedNodes.size} scopes.`);
    }
  }

  /**
   * Checks for the presence of the "use vortex" directive.
   */
  hasDirective(directives) {
    return directives && directives.some((d) => d.value.value === "use vortex");
  }

  /**
   * Removes the directive from the AST to clean up the output.
   */
  removeDirective(node) {
    if (node.directives) {
      node.directives = node.directives.filter(
        (d) => d.value.value !== "use vortex",
      );
    }
  }

  /**
   * Analyzes which global identifiers (e.g., Math, console) are used.
   * These are gathered to be passed into the VM via Global Memory (GM).
   */
  analyzeUsedGlobals() {
    const usedGlobals = new Set();
    const candidates = new Set(this.candidateGlobals);

    // Visitor defines how we find globals.
    // We traverse the full AST to ensure scope chains (bindings) are valid.
    const visitor = {
      Identifier: (innerPath) => {
        // If in partial mode, ignore identifiers that aren't inside a virtualized scope
        if (this.partialMode && !this.isVirtualized(innerPath)) return;

        const { name } = innerPath.node;
        if (!candidates.has(name)) return;

        // If it's not bound in the local scope, it's likely a global reference
        if (!innerPath.scope.hasBinding(name)) {
          if (innerPath.isReferencedIdentifier()) {
            usedGlobals.add(name);
          }
        }
      },
    };

    traverse(this.ast, {
      Program: (path) => {
        // If Program itself is virtualized OR we are not in partial mode,
        // we assume standard implicit globals might be needed (though typically this list comes from inner usage).
        if (!this.partialMode || this.virtualizedNodes.has(path.node)) {
          Object.keys(path.scope.globals).forEach((name) => {
            if (candidates.has(name)) usedGlobals.add(name);
          });
        }
        // Traverse all identifiers in the tree
        path.traverse(visitor);
      },
    });

    this.preloadedGlobals = Array.from(usedGlobals);
  }

  /**
   * Allocates virtual memory indices (Registers/Stack slots) for variables.
   * Maps every identifier to a unique integer index in the `memoryMap`.
   */
  collectGlobalsAndAllocateRegisters() {
    // Reserve internal registers
    this.allocateMemory("_SP", false);
    this.allocateMemory("_RET", false);
    this.allocateMemory("_EHP", false); // Exception Handler Pointer
    this.allocateMemory("_EXV", false); // Exception Value
    this.allocateMemory("_FIN", false);
    this.allocateMemory("_FIN_V", false);
    this.allocateMemory("_THIS", false);
    this.allocateMemory("_NEW_TARGET", false);
    this.allocateMemory(this.stringConcealer.decoderFunctionName, true);
    for (const globalName of this.preloadedGlobals) {
      this.allocateMemory(globalName, true);
    }

    const allocatePattern = (node, isGlobal) => {
      if (t.isIdentifier(node)) {
        this.allocateMemory(node.name, isGlobal);
      } else if (t.isAssignmentPattern(node)) {
        allocatePattern(node.left, isGlobal);
      } else if (t.isArrayPattern(node)) {
        node.elements.forEach(
          (elem) => elem && allocatePattern(elem, isGlobal),
        );
      } else if (t.isObjectPattern(node)) {
        node.properties.forEach((prop) => {
          if (t.isObjectProperty(prop)) allocatePattern(prop.value, isGlobal);
          else if (t.isRestElement(prop))
            allocatePattern(prop.argument, isGlobal);
        });
      } else if (t.isRestElement(node)) {
        allocatePattern(node.argument, isGlobal);
      }
    };

    const visitor = {
      VariableDeclaration: (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;
        const isGlobal = t.isProgram(path.parent);
        path.node.declarations.forEach((decl) => {
          allocatePattern(decl.id, isGlobal);
        });
      },
      FunctionDeclaration: (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;

        const isGlobal = t.isProgram(path.parent);
        if (path.node.id) this.allocateMemory(path.node.id.name, isGlobal);
        path.node.params.forEach((p) => allocatePattern(p, false));
      },
      "ArrowFunctionExpression|FunctionExpression": (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;
        path.node.params.forEach((p) => allocatePattern(p, false));
      },
      ClassDeclaration: (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;
        const isGlobal = t.isProgram(path.parent);
        if (path.node.id) this.allocateMemory(path.node.id.name, isGlobal);
      },
      "ClassMethod|ClassPrivateMethod": (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;
        path.node.params.forEach((p) => allocatePattern(p, false));
      },
      CatchClause: (path) => {
        if (this.partialMode && !this.isVirtualized(path)) return;
        if (path.node.param) {
          allocatePattern(path.node.param, false);
        }
      },
    };

    traverse(this.ast, visitor);
  }

  /**
   * Helper to determine if a specific path is within a virtualized scope.
   */
  isVirtualized(path) {
    let curr = path;
    while (curr) {
      if (this.virtualizedNodes.has(curr.node)) return true;
      curr = curr.parentPath;
    }
    return false;
  }

  /**
   * Assigns a unique memory index to a variable name.
   * If `isGlobal` is true, it is marked as part of the Global Memory (GM).
   */
  allocateMemory(name, isGlobal) {
    if (!this.memoryMap.has(name)) {
      const id = this.memoryMap.size;
      this.memoryMap.set(name, id);
      if (isGlobal) {
        this.globalIds.add(id);
      }
    }
  }
}

module.exports = { StateMachineTransformer };
