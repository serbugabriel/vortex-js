/**
 * @file index.js
 * @description The AST Generator is the final stage of the transformation pipeline.
 * It constructs the runtime Virtual Machine (VM) function, initializes memory regions,
 * and generates the entry point for the obfuscated code. It selects specific dispatchers
 * (Switch, BST, etc.) to control the flow of execution.
 */

const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const SwitchDispatcher = require("./dispatcher/switch-dispatcher");
const BSTDispatcher = require("./dispatcher/bst-dispatcher");
const ClusterDispatcher = require("./dispatcher/cluster-dispatcher");
const ChaosDispatcher = require("./dispatcher/chaos-dispatcher");

/**
 * Class responsible for generating the final AST of the protected code.
 */
class ASTGenerator {
  /**
   * @param {Object} context - The shared compilation context.
   */
  constructor(context) {
    this.context = context;
    this.ast = context.ast;
    this.memoryMap = context.memoryMap;
    this.globalIds = context.globalIds;
    this.states = context.states;
    this.functionStartStates = context.functionStartStates;
    this.stringConcealer = context.stringConcealer;
    this.stringCollector = context.stringCollector;
    this.preloadedGlobals = context.preloadedGlobals;
    this.noEncryption = context.noEncryption;
    this.stateRandomization = context.stateRandomization || false;
    this.partialMode = context.partialMode || false;
    this.virtualizedNodes = context.virtualizedNodes || new Set();

    // ESM Support (Imports/Exports must be hoisted/reordered)
    this.imports = context.imports || [];
    this.reExports = context.reExports || [];

    // Dispatcher Selection
    this.dispatcherType = context.dispatcher || "switch";

    this.stateMapping = new Map();
    this.hasAsync = false;

    this._initializeStateMapping();
    this._analyzeAsyncUsage();

    // Initialize the specific dispatcher strategy
    this.dispatcher = this._createDispatcher();
  }

  /**
   * Factory method to instantiate the chosen dispatcher.
   */
  _createDispatcher() {
    switch (this.dispatcherType) {
      case "switch":
        return new SwitchDispatcher(this);
      case "bst":
        return new BSTDispatcher(this);
      case "cluster":
        return new ClusterDispatcher(this);
      case "chaos":
        return new ChaosDispatcher(this);
      default:
        return new SwitchDispatcher(this);
    }
  }

  /**
   * Randomizes state IDs to prevent static analysis from easily reconstructing control flow.
   * Maps logical IR IDs to random 32-bit integers.
   */
  _initializeStateMapping() {
    const usedIds = new Set();
    const generateId = () => {
      let id;
      do {
        id = Math.floor(Math.random() * 2 ** 31) - 2 ** 30;
      } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    };

    const activeStates = this.states.filter((s) => s);

    for (const state of activeStates) {
      if (this.stateRandomization) {
        this.stateMapping.set(state.id, generateId());
      } else {
        this.stateMapping.set(state.id, state.id);
      }
    }
  }

  /**
   * Checks if any state involves async operations (Await).
   */
  _analyzeAsyncUsage() {
    this.hasAsync = this.states.some(
      (s) => s && (s.op.type === "AWAIT" || s.op.isAsync),
    );
  }

  _getMappedId(oldId) {
    if (!this.stateMapping.has(oldId)) {
      return oldId;
    }
    return this.stateMapping.get(oldId);
  }

  _getMemOrFail(varName, context) {
    if (!this.memoryMap.has(varName))
      throw new Error(
        `AST Gen Error: Unallocated variable "${varName}". Context: ${context}`,
      );
    return this.memoryMap.get(varName);
  }

  _getFuncStateOrFail(funcName, context) {
    if (!this.functionStartStates.has(funcName))
      throw new Error(
        `AST Gen Error: Unknown function "${funcName}". Context: ${context}`,
      );
    return this.functionStartStates.get(funcName);
  }

  /**
   * Creates an AST node to access a string from the encrypted string array.
   */
  _createStringAccess(str) {
    const id = this.stringCollector.getStringId(str);
    const arrayIdentifier = t.identifier(
      this.stringCollector.arrayVariableName,
    );

    let access = t.memberExpression(
      arrayIdentifier,
      t.numericLiteral(id),
      true,
    );

    if (!this.noEncryption) {
      access = t.callExpression(
        t.identifier(this.stringConcealer.decoderFunctionName),
        [access],
      );
    }
    return access;
  }

  /**
   * Generates a numeric literal, optionally obfuscating it as a small arithmetic expression.
   */
  _createNumericLiteralOrFail(value, context) {
    if (typeof value !== "number")
      throw new TypeError(
        `AST Gen Error: Expected number, got "${value}". Context: ${context}`,
      );

    if (!this.stateRandomization) return t.numericLiteral(value);

    // Simple constant obfuscation (20% chance)
    if (Math.random() > 0.8) {
      return t.numericLiteral(value);
    }

    const ops = ["+", "-", "^"];
    const op = ops[Math.floor(Math.random() * ops.length)];

    let a = Math.floor(Math.random() * 1000);
    let b;

    if (op === "+") {
      b = value - a;
    } else if (op === "-") {
      b = a - value;
    } else if (op === "^") {
      b = value ^ a;
    }

    return t.binaryExpression(op, t.numericLiteral(a), t.numericLiteral(b));
  }

  /**
   * Constructs the final AST for the VM.
   * This includes the register definitions, memory initialization, the main loop,
   * and the function wrappers that interface with the VM.
   */
  buildFinalAST() {
    // VM Register Identifiers
    const M = t.identifier("M"); // Memory Array
    const GlobalM = t.identifier("GM"); // Global Memory (proxied globals)
    const VM = t.identifier("V"); // The VM Function
    const S = t.identifier("S"); // State Register (Instruction Pointer)
    const VS = t.identifier("VS"); // Value Stack (Call Stack)
    const args = t.identifier("A"); // Arguments Register
    const Ctx = t.identifier("X"); // Context Object
    const Input = t.identifier("I"); // Input/Output Register
    const IsErr = t.identifier("IsErr"); // Error Flag
    const ThisVal = t.identifier("Tv"); // 'this' Binding
    const NewTargetVal = t.identifier("Nt"); // new.target Binding

    // Resolve fixed memory indices
    const SP_IDX = this._getMemOrFail("_SP", "Stack Pointer initialization");
    const EHP_IDX = this._getMemOrFail("_EHP", "EH Ptr");
    const EXV_IDX = this._getMemOrFail("_EXV", "EX Val");
    const RET_IDX = this._getMemOrFail("_RET", "RET Val");
    const THIS_IDX = this.memoryMap.has("_THIS")
      ? this.memoryMap.get("_THIS")
      : -1;
    const NEW_TARGET_IDX = this.memoryMap.has("_NEW_TARGET")
      ? this.memoryMap.get("_NEW_TARGET")
      : -1;

    const STACK_AREA_START = this.memoryMap.size;
    const STACK_SIZE = 600;
    const totalMemorySize = STACK_AREA_START + STACK_SIZE;

    // 1. Global Memory Initialization
    const globalMInit = t.variableDeclaration("const", [
      t.variableDeclarator(
        GlobalM,
        t.newExpression(t.identifier("Array"), [
          t.numericLiteral(totalMemorySize),
        ]),
      ),
    ]);

    // Preload used globals into GM
    const globalPreloaders = this.preloadedGlobals.map((globalName) => {
      const memIdx = this._getMemOrFail(
        globalName,
        `Preloading global ${globalName}`,
      );
      return t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(GlobalM, t.numericLiteral(memIdx), true),
          t.identifier(globalName),
        ),
      );
    });

    // 2. VM Function Body Setup
    const vmBody = [];
    vmBody.push(
      t.variableDeclaration("let", [
        t.variableDeclarator(M),
        t.variableDeclarator(S),
        t.variableDeclarator(VS, t.arrayExpression([])),
      ]),
    );

    // Context Initialization Logic
    const initBlockStatements = [
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          M,
          t.callExpression(
            t.memberExpression(GlobalM, t.identifier("slice")),
            [],
          ),
        ),
      ),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(M, t.numericLiteral(SP_IDX), true),
          t.numericLiteral(totalMemorySize),
        ),
      ),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(M, t.numericLiteral(EHP_IDX), true),
          t.numericLiteral(STACK_AREA_START),
        ),
      ),
      t.expressionStatement(t.assignmentExpression("=", S, Ctx)),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          Ctx,
          t.objectExpression([
            t.objectProperty(t.identifier("M"), M),
            t.objectProperty(t.identifier("S"), S),
            t.objectProperty(t.identifier("T"), t.nullLiteral()),
            t.objectProperty(t.identifier("A"), Input),
          ]),
        ),
      ),
    ];

    if (THIS_IDX !== -1) {
      initBlockStatements.splice(
        1,
        0,
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(M, t.numericLiteral(THIS_IDX), true),
            ThisVal,
          ),
        ),
      );
    }

    if (NEW_TARGET_IDX !== -1) {
      initBlockStatements.splice(
        1,
        0,
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(M, t.numericLiteral(NEW_TARGET_IDX), true),
            NewTargetVal,
          ),
        ),
      );
    }

    // Determine if context is a raw state ID (new call) or a resumed context
    const initLogic = t.ifStatement(
      t.binaryExpression(
        "===",
        t.unaryExpression("typeof", Ctx),
        t.stringLiteral("number"),
      ),
      t.blockStatement(initBlockStatements),
      t.blockStatement([
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            M,
            t.memberExpression(Ctx, t.identifier("M")),
          ),
        ),
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            S,
            t.memberExpression(Ctx, t.identifier("S")),
          ),
        ),
      ]),
    );
    vmBody.push(initLogic);

    // Generator/Yield Resumption Logic
    vmBody.push(
      t.ifStatement(
        t.logicalExpression(
          "&&",
          t.binaryExpression(
            "!==",
            t.memberExpression(Ctx, t.identifier("T")),
            t.nullLiteral(),
          ),
          t.binaryExpression("!==", Input, t.identifier("undefined")),
        ),
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              t.memberExpression(
                M,
                t.memberExpression(Ctx, t.identifier("T")),
                true,
              ),
              Input,
            ),
          ),
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              t.memberExpression(Ctx, t.identifier("T")),
              t.nullLiteral(),
            ),
          ),
        ]),
      ),
    );

    // 3. Dispatch Logic Generation (Switch/BST/etc.)
    const dispatchLogic = this.dispatcher.generate({
      M,
      S,
      VM,
      Ctx,
      GlobalM,
      VS,
      SP_IDX,
      EHP_IDX,
      STACK_AREA_START,
      totalMemorySize,
      RET_IDX,
    });

    // 4. Main Loop & Exception Handling
    const E = t.identifier("E");
    const exceptionHandler = t.catchClause(
      E,
      t.blockStatement([
        t.whileStatement(
          t.booleanLiteral(true),
          t.blockStatement([
            // Stack Unwinding for Try-Catch
            t.ifStatement(
              t.binaryExpression(
                ">",
                t.memberExpression(M, t.numericLiteral(EHP_IDX), true),
                t.numericLiteral(STACK_AREA_START),
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    S,
                    t.memberExpression(
                      M,
                      t.updateExpression(
                        "--",
                        t.memberExpression(M, t.numericLiteral(EHP_IDX), true),
                        true,
                      ),
                      true,
                    ),
                  ),
                ),
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(M, t.numericLiteral(EXV_IDX), true),
                    E,
                  ),
                ),
                t.breakStatement(),
              ]),
            ),
            // Stack Unwinding for Functions (Bubble up)
            t.ifStatement(
              t.binaryExpression(
                "===",
                t.memberExpression(VS, t.identifier("length")),
                t.numericLiteral(0),
              ),
              t.throwStatement(E),
            ),
            t.variableDeclaration("const", [
              t.variableDeclarator(
                t.identifier("frame"),
                t.callExpression(
                  t.memberExpression(VS, t.identifier("pop")),
                  [],
                ),
              ),
            ]),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                S,
                t.memberExpression(t.identifier("frame"), t.identifier("S")),
              ),
            ),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                M,
                t.memberExpression(t.identifier("frame"), t.identifier("M")),
              ),
            ),
          ]),
        ),
      ]),
    );

    const loopBody = t.blockStatement([
      t.ifStatement(
        IsErr,
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression("=", IsErr, t.booleanLiteral(false)),
          ),
          t.throwStatement(Input),
        ]),
      ),
      dispatchLogic,
    ]);

    const loop = t.labeledStatement(
      t.identifier("dispatcher_loop"),
      t.whileStatement(
        t.booleanLiteral(true),
        t.tryStatement(loopBody, exceptionHandler),
      ),
    );

    vmBody.push(loop);

    const vmFunction = t.variableDeclaration("const", [
      t.variableDeclarator(
        VM,
        t.arrowFunctionExpression(
          [
            Ctx,
            t.assignmentPattern(Input, t.identifier("undefined")),
            t.assignmentPattern(IsErr, t.booleanLiteral(false)),
            t.assignmentPattern(ThisVal, t.identifier("undefined")),
            t.assignmentPattern(NewTargetVal, t.identifier("undefined")),
          ],
          t.blockStatement(vmBody),
          false,
        ),
      ),
    ]);

    // 5. Wrapper Generation for Virtualized Functions
    const functionInits = [];
    const partialWrappers = new Map();

    for (const [funcName, startStateId] of this.functionStartStates.entries()) {
      if (this.memoryMap.has(funcName)) {
        const memIdx = this.memoryMap.get(funcName);
        const targetArray = this.globalIds.has(memIdx) ? GlobalM : null;
        const startState = this.states[startStateId];
        const mappedStartId = this._getMappedId(startStateId);

        let wrapper;
        if (startState.op.isGenerator) {
          wrapper = this.createGeneratorWrapper(
            VM,
            mappedStartId,
            totalMemorySize,
            SP_IDX,
            EHP_IDX,
            STACK_AREA_START,
            GlobalM,
            THIS_IDX,
            NEW_TARGET_IDX,
            startState.op.isAsync,
          );
        } else {
          // Standard Function Wrapper
          const vmCall = t.callExpression(VM, [
            this._createNumericLiteralOrFail(mappedStartId, "wrapper init"),
            t.identifier("args"),
            t.booleanLiteral(false),
            t.thisExpression(),
            t.metaProperty(t.identifier("new"), t.identifier("target")),
          ]);

          let returnLogic;
          if (startState.op.isAsync) {
            // Async Wrapper: wraps VM call in Promise.resolve().then(...)
            const thenCallback = t.arrowFunctionExpression(
              [t.identifier("r")],
              t.memberExpression(t.identifier("r"), t.identifier("v")),
            );
            returnLogic = t.returnStatement(
              t.callExpression(
                t.memberExpression(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier("Promise"),
                      t.identifier("resolve"),
                    ),
                    [vmCall],
                  ),
                  t.identifier("then"),
                ),
                [thenCallback],
              ),
            );
          } else {
            returnLogic = t.returnStatement(
              t.memberExpression(vmCall, t.identifier("v")),
            );
          }

          wrapper = t.functionExpression(
            null,
            [t.restElement(t.identifier("args"))],
            t.blockStatement([returnLogic]),
            false,
            startState.op.isAsync,
          );
        }

        if (this.partialMode) {
          partialWrappers.set(funcName, wrapper);
          if (targetArray) {
            functionInits.push(
              t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  t.memberExpression(
                    targetArray,
                    t.numericLiteral(memIdx),
                    true,
                  ),
                  wrapper,
                ),
              ),
            );
          }
        } else {
          if (targetArray) {
            functionInits.push(
              t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  t.memberExpression(
                    targetArray,
                    t.numericLiteral(memIdx),
                    true,
                  ),
                  wrapper,
                ),
              ),
            );
          }
        }
      }
    }

    // 6. Program Reconstruction
    if (this.partialMode) {
      // Partial Mode: Replace specific function declarations with wrappers
      traverse(this.ast, {
        FunctionDeclaration: (path) => {
          const name = path.node.id.name;
          if (partialWrappers.has(name)) {
            const wrapperExpr = partialWrappers.get(name);
            const wrapperDecl = t.functionDeclaration(
              t.identifier(name),
              wrapperExpr.params,
              wrapperExpr.body,
              wrapperExpr.generator,
              wrapperExpr.async,
            );
            path.replaceWith(wrapperDecl);
            path.skip();
          }
        },
      });

      const runtimeNodes = [];
      if (!this.noEncryption) {
        runtimeNodes.push(this.stringConcealer.getDecoderAST());
      }
      const stringArrayAST = this.stringCollector.getArrayAST();
      if (stringArrayAST) {
        runtimeNodes.push(stringArrayAST);
      }
      runtimeNodes.push(globalMInit);
      runtimeNodes.push(...globalPreloaders);
      runtimeNodes.push(vmFunction);

      const fixedFunctionInits = [];
      for (const [funcName] of partialWrappers) {
        const memIdx = this.memoryMap.get(funcName);
        if (this.globalIds.has(memIdx)) {
          fixedFunctionInits.push(
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(GlobalM, t.numericLiteral(memIdx), true),
                t.identifier(funcName),
              ),
            ),
          );
        }
      }
      runtimeNodes.push(...fixedFunctionInits);

      if (this.virtualizedNodes.has(this.ast.program)) {
        const originalBody = this.ast.program.body;
        const preservedFunctions = originalBody.filter(
          (node) =>
            t.isFunctionDeclaration(node) && !partialWrappers.has(node.id.name),
        );

        const mappedEntryId = this._getMappedId(0);
        const entryCall = t.expressionStatement(
          t.callExpression(VM, [
            this._createNumericLiteralOrFail(mappedEntryId, "entry call"),
          ]),
        );

        this.ast.program.body = [
          ...this.imports, // Prepend Imports
          ...runtimeNodes,
          ...preservedFunctions,
          entryCall,
          ...this.reExports, // Append Exports
        ];
      } else {
        this.ast.program.body.unshift(...runtimeNodes);
        this.ast.program.body.unshift(...this.imports); // Prepend Imports
        this.ast.program.body.push(...this.reExports); // Append Exports
      }

      return this.ast;
    } else {
      // Full Mode: Rebuild entire program
      const mappedEntryId = this._getMappedId(0);
      const entryCall = t.expressionStatement(
        t.callExpression(VM, [
          this._createNumericLiteralOrFail(mappedEntryId, "entry call"),
        ]),
      );

      const newProgramBody = [];

      // 1. Imports (Must be top level)
      newProgramBody.push(...this.imports);

      // 2. Runtime Utils
      if (!this.noEncryption)
        newProgramBody.push(this.stringConcealer.getDecoderAST());
      const stringArrayAST = this.stringCollector.getArrayAST();
      if (stringArrayAST) newProgramBody.push(stringArrayAST);

      // 3. VM & Globals
      newProgramBody.push(globalMInit);
      newProgramBody.push(...globalPreloaders);
      newProgramBody.push(vmFunction);
      newProgramBody.push(...functionInits);

      // 4. Entry Point
      newProgramBody.push(entryCall);

      // 5. Exports (Must be top level, after execution)
      newProgramBody.push(...this.reExports);

      return t.program(newProgramBody);
    }
  }

  /**
   * Creates a specialized wrapper function for Generators.
   * Manages the generator state machine interaction with the VM.
   */
  createGeneratorWrapper(
    VM,
    mappedStartId,
    totalMem,
    spIdx,
    ehpIdx,
    stackStart,
    GlobalM,
    thisIdx,
    newTargetIdx,
    isAsync,
  ) {
    const M = t.identifier("M");
    const ctx = t.identifier("X");
    const args = t.identifier("args");
    const input = t.identifier("I");
    const res = t.identifier("R");
    const err = t.identifier("E");
    const returnToken = t.stringLiteral("@@VRXT");

    const vmCall = t.callExpression(VM, [ctx, input]);
    const initVmCall = t.callExpression(VM, [ctx, err, t.booleanLiteral(true)]);
    const finalVmCall = t.callExpression(VM, [
      ctx,
      returnToken,
      t.booleanLiteral(true),
    ]);

    const wrapAwait = (expr) => (isAsync ? t.awaitExpression(expr) : expr);

    // Loop body handling yield/return/error
    const loopBody = t.blockStatement([
      t.tryStatement(
        t.blockStatement([
          t.variableDeclaration("const", [
            t.variableDeclarator(res, wrapAwait(vmCall)),
          ]),
          // Case 1: Return
          t.ifStatement(
            t.binaryExpression(
              "===",
              t.memberExpression(res, t.identifier("_")),
              t.numericLiteral(1),
            ),
            t.returnStatement(t.memberExpression(res, t.identifier("v"))),
          ),
          // Case 2: Delegated Yield
          t.ifStatement(
            t.binaryExpression(
              "===",
              t.memberExpression(res, t.identifier("_")),
              t.numericLiteral(2),
            ),
            t.blockStatement([
              t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  input,
                  t.yieldExpression(
                    t.memberExpression(res, t.identifier("v")),
                    true,
                  ),
                ),
              ),
              t.continueStatement(),
            ]),
          ),
          // Case 3: Standard Yield
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              input,
              t.yieldExpression(t.memberExpression(res, t.identifier("v"))),
            ),
          ),
        ]),
        t.catchClause(
          err,
          t.blockStatement([
            // Special token check for internal VM return
            t.ifStatement(
              t.binaryExpression("===", err, returnToken),
              t.returnStatement(
                t.objectExpression([
                  t.objectProperty(
                    t.identifier("done"),
                    t.booleanLiteral(true),
                  ),
                  t.objectProperty(
                    t.identifier("value"),
                    t.identifier("undefined"),
                  ),
                ]),
              ),
            ),
            // Exception propagation back into VM
            t.variableDeclaration("const", [
              t.variableDeclarator(res, wrapAwait(initVmCall)),
            ]),
            t.ifStatement(
              t.binaryExpression(
                "===",
                t.memberExpression(res, t.identifier("_")),
                t.numericLiteral(1),
              ),
              t.returnStatement(t.memberExpression(res, t.identifier("v"))),
            ),
            t.ifStatement(
              t.binaryExpression(
                "===",
                t.memberExpression(res, t.identifier("_")),
                t.numericLiteral(2),
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    input,
                    t.yieldExpression(
                      t.memberExpression(res, t.identifier("v")),
                      true,
                    ),
                  ),
                ),
                t.continueStatement(),
              ]),
            ),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                input,
                t.yieldExpression(t.memberExpression(res, t.identifier("v"))),
              ),
            ),
          ]),
        ),
      ),
    ]);

    // Generator Context Initialization
    const initStmts = [
      t.variableDeclaration("let", [
        t.variableDeclarator(
          M,
          t.callExpression(
            t.memberExpression(GlobalM, t.identifier("slice")),
            [],
          ),
        ),
      ]),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(M, t.numericLiteral(spIdx), true),
          t.numericLiteral(totalMem),
        ),
      ),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(M, t.numericLiteral(ehpIdx), true),
          t.numericLiteral(stackStart),
        ),
      ),
    ];

    if (thisIdx !== -1) {
      initStmts.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(M, t.numericLiteral(thisIdx), true),
            t.thisExpression(),
          ),
        ),
      );
    }

    if (newTargetIdx !== -1) {
      initStmts.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(M, t.numericLiteral(newTargetIdx), true),
            t.metaProperty(t.identifier("new"), t.identifier("target")),
          ),
        ),
      );
    }

    initStmts.push(
      t.variableDeclaration("let", [
        t.variableDeclarator(
          ctx,
          t.objectExpression([
            t.objectProperty(t.identifier("M"), M),
            t.objectProperty(
              t.identifier("S"),
              this._createNumericLiteralOrFail(mappedStartId, "gen init"),
            ),
            t.objectProperty(t.identifier("T"), t.nullLiteral()),
            t.objectProperty(t.identifier("A"), args),
          ]),
        ),
        t.variableDeclarator(input, t.identifier("undefined")),
      ]),
    );

    initStmts.push(
      t.tryStatement(
        t.blockStatement([t.whileStatement(t.booleanLiteral(true), loopBody)]),
        null,
        t.blockStatement([
          t.tryStatement(
            t.blockStatement([t.expressionStatement(wrapAwait(finalVmCall))]),
            t.catchClause(t.identifier("e"), t.blockStatement([])),
          ),
        ]),
      ),
    );

    return t.functionExpression(
      null,
      [t.restElement(args)],
      t.blockStatement(initStmts),
      true,
      isAsync,
    );
  }
}

module.exports = ASTGenerator;
