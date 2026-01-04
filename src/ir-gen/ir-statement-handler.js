/**
 * @file ir-statement-handler.js
 * @description Handles the transformation of Babel AST Statement nodes into
 * Intermediate Representation (IR) states. This class is responsible for
 * flattening control flow (loops, ifs, switches) and managing high-level
 * language constructs like try-catch and function declarations.
 */

const t = require("@babel/types");
const ClassHandler = require("./ir-class-handler");

/**
 * Class responsible for processing statement nodes.
 */
class StatementHandler {
  /**
   * @param {Object} irGenerator - The parent IR Generator instance.
   */
  constructor(irGenerator) {
    this.ir = irGenerator;
    this.classHandler = new ClassHandler(irGenerator);
  }

  /**
   * Attempts to inject an opaque predicate (obfuscation) at the end of a block.
   * Creates a divergent path that eventually converges, confusing static analysis.
   * @param {number} endStateId - The state ID where the block currently ends.
   * @returns {number} The new end state ID (convergence point).
   */
  tryInject(endStateId) {
    if (!this.ir.opaqueManager || !this.ir.opaqueManager.shouldInject()) {
      return endStateId;
    }

    const predicateGraph = this.ir.opaqueManager.getPredicateIR(this.ir);
    if (!predicateGraph) return endStateId;

    this.ir.linkStates(endStateId, predicateGraph.start);

    const convergenceState = this.ir.addState({ type: "NOOP" });
    const jumpState = this.ir.getState(predicateGraph.end);

    const bogusGraph = this.ir.opaqueManager.getBogusCodeIR(this.ir);

    // Link true path to convergence, false path to garbage code
    jumpState.op.trueState = convergenceState;
    jumpState.op.falseState = predicateGraph.bogusTarget;

    this.ir.linkStates(predicateGraph.bogusTarget, bogusGraph.start);

    return convergenceState;
  }

  /**
   * Dispatches the statement processing to the appropriate handler.
   * @param {Object} path - Babel AST path.
   * @returns {Object} Result object { start, end }.
   */
  process(path) {
    if (!path || !path.node) return null;

    if (path.isFunctionDeclaration())
      return this.handleFunctionDeclaration(path);

    if (path.isBlockStatement()) return this.ir.processBlock(path);
    if (path.isClassDeclaration()) return this.classHandler.process(path);
    if (path.isVariableDeclaration())
      return this.ir.processStatements(path.get("declarations"));
    if (path.isVariableDeclarator()) return this.handleVariableDeclarator(path);
    if (path.isExpressionStatement())
      return this.ir.processExpression(path.get("expression"));
    if (path.isIfStatement()) return this.handleIfStatement(path);
    if (path.isTryStatement()) return this.handleTryStatement(path);
    if (path.isThrowStatement()) return this.handleThrowStatement(path);
    if (path.isReturnStatement()) return this.handleReturnStatement(path);
    if (path.isBreakStatement()) return this.handleBreakStatement(path);
    if (path.isContinueStatement()) return this.handleContinueStatement(path);
    if (path.isSwitchStatement()) return this.handleSwitchStatement(path);
    if (path.isWhileStatement()) return this.handleWhileStatement(path);
    if (path.isForStatement()) return this.handleForStatement(path);
    if (path.isDoWhileStatement()) return this.handleDoWhileStatement(path);
    if (path.isEmptyStatement()) return null;

    const loc = path.node.loc?.start;
    throw new Error(
      `Unsupported statement type: ${path.type} at ${
        loc ? `${loc.line}:${loc.column}` : "Unknown location"
      }`,
    );
  }

  // --- HELPER: Extract all bound names from a parameter list (handling destructuring) ---
  _getParamNames(params) {
    const names = new Set();
    const collect = (node) => {
      if (!node) return;
      if (t.isIdentifier(node)) {
        names.add(node.name);
      } else if (t.isAssignmentPattern(node)) {
        collect(node.left);
      } else if (t.isArrayPattern(node)) {
        node.elements.forEach((e) => collect(e));
      } else if (t.isObjectPattern(node)) {
        node.properties.forEach((p) => {
          if (t.isObjectProperty(p)) collect(p.value);
          else if (t.isRestElement(p)) collect(p.argument);
        });
      } else if (t.isRestElement(node)) {
        collect(node.argument);
      }
    };
    params.forEach(collect);
    return names;
  }

  /**
   * Handles Function Declarations.
   * 1. Detects variables captured from the outer scope (closure analysis).
   * 2. Modifies the VM function entry to accept captured vars as arguments.
   * 3. Wraps the VM execution call (V) in a native JS function to maintain compatibility.
   */
  handleFunctionDeclaration(path) {
    const funcName = path.node.id.name;
    const startStateId = this.ir.functionStartStates.get(funcName);

    // --- 1. Closure Capture Analysis ---
    const capturedSet = new Set();
    const self = this;
    const parentScope = path.scope;

    // FIX: Get list of own params to avoid capturing them
    const ownParams = this._getParamNames(path.node.params);

    path.traverse({
      Identifier(p) {
        if (!p.isReferenced()) return;
        const name = p.node.name;

        // Ignore if it's one of our own parameters
        if (ownParams.has(name)) return;

        // Must be in memory map (virtualized) and not a global
        if (!self.ir.memoryMap.has(name)) return;
        const memIdx = self.ir.memoryMap.get(name);
        if (self.ir.globalIds.has(memIdx)) return;

        if (parentScope.hasBinding(name)) {
          const parentBinding = parentScope.getBinding(name);
          const localBinding = p.scope.getBinding(name);
          // If the binding resolves to the parent scope, it's captured
          if (parentBinding === localBinding) {
            capturedSet.add(name);
          }
        }
      },
      ThisExpression(p) {
        // FunctionDeclaration has its own 'this', do not capture outer 'this'
        // (Unless we support transforming arrow functions via this handler later)
        // TODO: Soon :P
      },
    });

    const capturedVars = Array.from(capturedSet).sort();

    // --- 2. Update Entry State Parameters (Append Captures) ---
    const entryState = this.ir.getState(startStateId);
    const originalParams = path.node.params;
    const capturedParams = capturedVars.map((name) => t.identifier(name));
    entryState.op.params = [...originalParams, ...capturedParams];

    // --- 3. Process Function Body (Recursive) ---
    this.ir.processFunction(path, startStateId);

    // --- 4. Generate Wrapper Assignment ---
    // Generates: function name(...args) { return V(startState, [args, ...capturedVars]); }
    const VM = t.identifier("V");
    const wrapperArgs = t.identifier("args");

    const vmCallArgs = [
      t.spreadElement(wrapperArgs),
      ...capturedVars.map((name) => t.identifier(name)),
    ];

    let vmCall = t.callExpression(VM, [
      t.numericLiteral(
        this.ir.stateMapping
        ? this.ir._getMappedId(startStateId)
        : startStateId,
      ),
      t.arrayExpression(vmCallArgs),
    ]);

    let wrapperBody;
    if (path.node.async) {
      wrapperBody = t.callExpression(
        t.memberExpression(vmCall, t.identifier("then")),
                                     [
                                       t.arrowFunctionExpression(
                                         [t.identifier("r")],
                                                                 t.memberExpression(t.identifier("r"), t.identifier("v")),
                                       ),
                                     ],
      );
    } else if (path.node.generator) {
      wrapperBody = t.memberExpression(
        t.awaitExpression(vmCall),
                                       t.identifier("v"),
      );
    } else {
      wrapperBody = t.memberExpression(
        t.awaitExpression(vmCall),
                                       t.identifier("v"),
      );
    }

    const wrapperFunc = t.arrowFunctionExpression(
      [t.restElement(wrapperArgs)],
                                                  wrapperBody,
                                                  true, // async to await V
    );

    const assignStateId = this.ir.addState({
      type: "ASSIGN_LITERAL_DIRECT",
      to: funcName,
      value: wrapperFunc,
    });

    return { start: assignStateId, end: assignStateId };
  }

  /**
   * Handles Variable Declarations (const/let/var).
   * Supports destructuring assignments by breaking them down into primitive moves.
   */
  handleVariableDeclarator(path) {
    if (!path.node.init) {
      const noopState = this.ir.addState({ type: "NOOP" });
      return { start: noopState, end: noopState };
    }

    const exprInfo = this.ir.processExpression(path.get("init"));

    // Simple identifier assignment
    if (t.isIdentifier(path.node.id)) {
      const assignStateId = this.ir.addState({
        type: "ASSIGN",
        to: path.node.id.name,
        from: exprInfo.resultVar.name,
      });
      this.ir.linkStates(exprInfo.end, assignStateId);
      return { start: exprInfo.start, end: assignStateId };
    }
    // Destructuring assignment (Array or Object pattern)
    else if (t.isPattern(path.node.id)) {
      const M = t.identifier("M");
      const GM = t.identifier("GM");

      // Resolve the memory index of the source object/array
      const sourceMemExpr = t.memberExpression(
        M,
        t.numericLiteral(this.ir.memoryMap.get(exprInfo.resultVar.name)),
                                               true,
      );

      const assignments = [];
      const processPattern = (pattern, parentExpr) => {
        if (t.isArrayPattern(pattern)) {
          pattern.elements.forEach((elem, i) => {
            if (elem) {
              const newParentExpr = t.memberExpression(
                parentExpr,
                t.numericLiteral(i),
                                                       true,
              );
              processPattern(elem, newParentExpr);
            }
          });
        } else if (t.isObjectPattern(pattern)) {
          pattern.properties.forEach((prop) => {
            if (t.isObjectProperty(prop)) {
              const key = prop.key;
              const newParentExpr = t.memberExpression(
                parentExpr,
                key,
                prop.computed,
              );
              processPattern(prop.value, newParentExpr);
            }
          });
        } else if (t.isIdentifier(pattern)) {
          const targetMemIdx = this.ir.memoryMap.get(pattern.name);
          const targetArray = this.ir.globalIds.has(targetMemIdx) ? GM : M;
          const targetMemExpr = t.memberExpression(
            targetArray,
            t.numericLiteral(targetMemIdx),
                                                   true,
          );
          assignments.push(
            t.expressionStatement(
              t.assignmentExpression("=", targetMemExpr, parentExpr),
            ),
          );
        }
      };

      processPattern(path.node.id, sourceMemExpr);

      const execStateId = this.ir.addState({
        type: "EXECUTE_STATEMENT",
        statement: t.blockStatement(assignments),
      });

      this.ir.linkStates(exprInfo.end, execStateId);
      return { start: exprInfo.start, end: execStateId };
    }
  }

  /**
   * Handles If statements.
   * Flattens the structure into Conditional Jumps (COND_JUMP).
   */
  handleIfStatement(path) {
    const condInfo = this.ir.processExpression(path.get("test"));
    const consequentInfo = this.process(path.get("consequent"));
    const endIfStateId = this.ir.addState({ type: "NOOP" });

    if (consequentInfo) {
      this.ir.linkStates(consequentInfo.end, endIfStateId);
    }

    let alternateInfo = null;
    let alternateStart = endIfStateId;
    if (path.node.alternate) {
      alternateInfo = this.process(path.get("alternate"));
      if (alternateInfo) {
        this.ir.linkStates(alternateInfo.end, endIfStateId);
        alternateStart = alternateInfo.start;
      }
    }

    const jumpStateId = this.ir.addState({
      type: "COND_JUMP",
      testVar: condInfo.resultVar.name,
      trueState: consequentInfo ? consequentInfo.start : endIfStateId,
      falseState: alternateStart,
    });
    this.ir.linkStates(condInfo.end, jumpStateId);

    if (!consequentInfo) {
      this.ir.linkStates(condInfo.end, jumpStateId);
    }

    const finalEnd = this.tryInject(endIfStateId);

    return { start: condInfo.start, end: finalEnd };
  }

  /**
   * Handles Try-Catch-Finally statements.
   * Manually manages the Exception Handler Pointer (_EHP) on the VM stack.
   * Uses shims to handle 'finally' blocks which must run on return, break, or throw.
   */
  handleTryStatement(path) {
    const endTryStateId = this.ir.addState({ type: "NOOP" });
    const catchClause = path.get("handler");
    const finalizer = path.get("finalizer");

    // --- FINALLY BLOCK PROCESSING ---
    let finallyInfo = null;
    let finallyDispatchId = null;
    let finallyShim = null;

    if (finalizer.node) {
      finallyInfo = this.ir.processBlock(finalizer);
      // Dispatcher decides where to go after finally (return, throw, next, etc.)
      finallyDispatchId = this.ir.addState({ type: "FINALLY_DISPATCH" });
      this.ir.getState(finallyDispatchId).next = endTryStateId;
      this.ir.linkStates(finallyInfo.end, finallyDispatchId);

      // Shim to jump to finally in case of uncaught exception in try/catch
      const shimState = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 4, // 4 = Throwing
      });
      const copyExcState = this.ir.addState({
        type: "ASSIGN",
        to: "_FIN_V",
        from: "_EXV",
      });
      this.ir.linkStates(shimState, copyExcState);
      this.ir.linkStates(copyExcState, finallyInfo.start);
      finallyShim = shimState;
    }

    // --- CATCH BLOCK PROCESSING ---
    let catchEntryStateId;
    let catchInfo = null;

    if (catchClause.node) {
      catchInfo = this.ir.processBlock(catchClause.get("body"));

      // FIX: Handle optional catch binding (catch {}) where param is null
      const catchParamName = catchClause.node.param
      ? catchClause.node.param.name
      : null;

      const magicTokenVar = this.ir.createTempVar();
      const loadMagicToken = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: magicTokenVar.name,
        value: "@@VRXT", // Magic token for rethrow detection
      });

      const isMagicVar = this.ir.createTempVar();
      const checkMagic = this.ir.addState({
        type: "BINARY",
        op: "===",
        to: isMagicVar.name,
        left: "_EXV",
        right: magicTokenVar.name,
      });
      this.ir.linkStates(loadMagicToken, checkMagic);

      const rethrowState = this.ir.addState({
        type: "THROW",
        valueVar: "_EXV",
      });

      // --- Determine Catch Entry ---
      let falseTargetStateId;

      if (catchParamName) {
        const assignErrorStateId = this.ir.addState({
          type: "ASSIGN",
          to: catchParamName,
          from: "_EXV",
        });
        this.ir.linkStates(assignErrorStateId, catchInfo.start);
        falseTargetStateId = assignErrorStateId;
      } else {
        // Optional catch binding: skip error assignment, go straight to body
        falseTargetStateId = catchInfo.start;
      }

      const decisionState = this.ir.addState({
        type: "COND_JUMP",
        testVar: isMagicVar.name,
        trueState: rethrowState,
        falseState: falseTargetStateId,
      });
      this.ir.linkStates(checkMagic, decisionState);

      const guardEntry = loadMagicToken;

      if (finallyInfo) {
        // If finally exists, catch block must also push a handler for the finally
        const pushCatchShim = this.ir.addState({
          type: "PUSH_CATCH_HANDLER",
          target: finallyShim,
        });
        this.ir.linkStates(pushCatchShim, guardEntry);

        const popCatchShim = this.ir.addState({ type: "POP_CATCH_HANDLER" });
        this.ir.linkStates(catchInfo.end, popCatchShim);

        const setFinNormalFromCatch = this.ir.addState({
          type: "ASSIGN_LITERAL",
          to: "_FIN",
          value: 0, // 0 = Normal
        });
        this.ir.linkStates(popCatchShim, setFinNormalFromCatch);
        this.ir.linkStates(setFinNormalFromCatch, finallyInfo.start);

        catchEntryStateId = pushCatchShim;
      } else {
        catchEntryStateId = guardEntry;
        this.ir.linkStates(catchInfo.end, endTryStateId);
      }
    } else {
      // No catch block
      if (finallyInfo) {
        catchEntryStateId = finallyShim;
      } else {
        catchEntryStateId = endTryStateId;
      }
    }

    // --- TRY BLOCK SETUP ---
    const pushHandlerStateId = this.ir.addState({
      type: "PUSH_CATCH_HANDLER",
      target: catchEntryStateId,
    });

    this.ir.controlStack.push({
      type: "TRY",
      finallyStart: finallyInfo ? finallyInfo.start : null,
      hasCatch: !!catchClause.node,
    });

    const tryInfo = this.ir.processBlock(path.get("block"));

    this.ir.controlStack.pop();

    const popHandlerStateId = this.ir.addState({ type: "POP_CATCH_HANDLER" });

    this.ir.linkStates(pushHandlerStateId, tryInfo.start);
    this.ir.linkStates(tryInfo.end, popHandlerStateId);

    if (finallyInfo) {
      const setFinNormalState = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 0,
      });
      this.ir.linkStates(popHandlerStateId, setFinNormalState);
      this.ir.linkStates(setFinNormalState, finallyInfo.start);
    } else {
      this.ir.linkStates(popHandlerStateId, endTryStateId);
    }

    return { start: pushHandlerStateId, end: endTryStateId };
  }

  /**
   * Handles Throw statements.
   * If inside a try-catch-finally, it diverts flow to the finally block via `_FIN` register.
   */
  handleThrowStatement(path) {
    let interceptingFinally = null;
    for (let i = this.ir.controlStack.length - 1; i >= 0; i--) {
      const ctx = this.ir.controlStack[i];
      if (ctx.type === "TRY" && ctx.finallyStart && !ctx.hasCatch) {
        interceptingFinally = ctx.finallyStart;
        break;
      }
    }

    const argInfo = this.ir.processExpression(path.get("argument"));

    if (interceptingFinally) {
      const setFinThrow = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 4, // 4 = Throw
      });
      const setFinVal = this.ir.addState({
        type: "ASSIGN",
        to: "_FIN_V",
        from: argInfo.resultVar.name,
      });
      this.ir.linkStates(argInfo.end, setFinThrow);
      this.ir.linkStates(setFinThrow, setFinVal);
      this.ir.linkStates(setFinVal, interceptingFinally);
      return { start: argInfo.start, end: interceptingFinally };
    } else {
      const throwStateId = this.ir.addState({
        type: "THROW",
        valueVar: argInfo.resultVar.name,
      });
      this.ir.linkStates(argInfo.end, throwStateId);
      return { start: argInfo.start, end: throwStateId };
    }
  }

  /**
   * Handles Return statements.
   * If inside a try-finally, it diverts flow to the finally block via `_FIN` register.
   */
  handleReturnStatement(path) {
    let interceptingFinally = null;
    for (let i = this.ir.controlStack.length - 1; i >= 0; i--) {
      const ctx = this.ir.controlStack[i];
      if (ctx.type === "TRY" && ctx.finallyStart) {
        interceptingFinally = ctx.finallyStart;
        break;
      }
    }

    const argInfo = this.ir.processExpression(
      path.get("argument") || { node: t.valueToNode(undefined) },
    );

    if (interceptingFinally) {
      const setFinReturn = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 1, // 1 = Return
      });
      const setFinVal = this.ir.addState({
        type: "ASSIGN",
        to: "_FIN_V",
        from: argInfo.resultVar.name,
      });
      this.ir.linkStates(argInfo.end, setFinReturn);
      this.ir.linkStates(setFinReturn, setFinVal);
      this.ir.linkStates(setFinVal, interceptingFinally);
      return { start: argInfo.start, end: interceptingFinally };
    } else {
      const returnStateId = this.ir.addState({
        type: "RETURN",
        valueVar: argInfo.resultVar.name,
        funcName: this.ir.functionContext.name,
      });
      this.ir.linkStates(argInfo.end, returnStateId);
      return { start: argInfo.start, end: returnStateId };
    }
  }

  /**
   * Handles Break statements.
   * Jumps to the loop/switch end target, or diverts to finally if applicable.
   */
  handleBreakStatement(path) {
    let target = null;
    let interceptingFinally = null;

    for (let i = this.ir.controlStack.length - 1; i >= 0; i--) {
      const ctx = this.ir.controlStack[i];

      if (ctx.type === "SWITCH" || ctx.type === "LOOP") {
        target = ctx.breakTarget;
        break;
      }

      if (ctx.type === "TRY" && ctx.finallyStart) {
        if (!interceptingFinally) interceptingFinally = ctx.finallyStart;
      }
    }

    if (!target) throw new Error("Illegal break statement.");

    if (interceptingFinally) {
      const setFinBreak = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 2, // 2 = Break
      });
      const setFinTarget = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN_V",
        value: target,
      });
      this.ir.linkStates(setFinBreak, setFinTarget);
      this.ir.linkStates(setFinTarget, interceptingFinally);
      const startNode = this.ir.addState({ type: "NOOP" });
      this.ir.linkStates(startNode, setFinBreak);
      return { start: startNode, end: interceptingFinally };
    }

    const jumpState = this.ir.addState({
      type: "GOTO",
      target: target,
    });
    this.ir.getState(jumpState).next = target;
    return { start: jumpState, end: jumpState };
  }

  /**
   * Handles Continue statements.
   * Jumps to the loop update target, or diverts to finally if applicable.
   */
  handleContinueStatement(path) {
    let target = null;
    let interceptingFinally = null;

    for (let i = this.ir.controlStack.length - 1; i >= 0; i--) {
      const ctx = this.ir.controlStack[i];

      if (ctx.type === "LOOP") {
        target = ctx.continueTarget;
        break;
      }

      if (ctx.type === "TRY" && ctx.finallyStart) {
        if (!interceptingFinally) interceptingFinally = ctx.finallyStart;
      }
    }

    if (!target) throw new Error("Illegal continue statement.");

    if (interceptingFinally) {
      const setFinContinue = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN",
        value: 3, // 3 = Continue
      });
      const setFinTarget = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: "_FIN_V",
        value: target,
      });
      this.ir.linkStates(setFinContinue, setFinTarget);
      this.ir.linkStates(setFinTarget, interceptingFinally);
      const startNode = this.ir.addState({ type: "NOOP" });
      this.ir.linkStates(startNode, setFinContinue);
      return { start: startNode, end: interceptingFinally };
    }

    const jumpState = this.ir.addState({
      type: "GOTO",
      target: target,
    });
    this.ir.getState(jumpState).next = target;
    return { start: jumpState, end: jumpState };
  }

  /**
   * Handles Switch statements.
   * Flattens into a series of conditional jumps (If-Else chain).
   */
  handleSwitchStatement(path) {
    const endSwitchStateId = this.ir.addState({ type: "NOOP" });

    this.ir.controlStack.push({
      type: "SWITCH",
      breakTarget: endSwitchStateId,
    });

    const discriminantInfo = this.ir.processExpression(
      path.get("discriminant"),
    );
    let lastLink = discriminantInfo.end;
    const caseInfos = path.get("cases").map((casePath) => ({
      path: casePath,
      testInfo: casePath.node.test
      ? this.ir.processExpression(casePath.get("test"))
      : null,
      consequentInfo: this.ir.processStatements(casePath.get("consequent")),
                                                           isDefault: !casePath.node.test,
    }));
    for (const caseInfo of caseInfos) {
      if (caseInfo.testInfo) {
        this.ir.linkStates(lastLink, caseInfo.testInfo.start);
        lastLink = caseInfo.testInfo.end;
      }
    }
    // Handle fallthrough by linking end of one case to start of next
    for (let i = 0; i < caseInfos.length; i++) {
      const currentCase = caseInfos[i];
      const lastStatement = currentCase.path.get("consequent").pop();
      if (!lastStatement || !lastStatement.isBreakStatement()) {
        const nextCase = caseInfos[i + 1];
        if (nextCase) {
          this.ir.linkStates(
            currentCase.consequentInfo.end,
            nextCase.consequentInfo.start,
          );
        } else {
          this.ir.linkStates(currentCase.consequentInfo.end, endSwitchStateId);
        }
      }
    }
    const defaultCase = caseInfos.find((c) => c.isDefault);
    let fallthroughTarget = defaultCase
    ? defaultCase.consequentInfo.start
    : endSwitchStateId;
    const checkStates = caseInfos
    .filter((c) => !c.isDefault)
    .map(() => this.ir.addState({ type: "NOOP" }));
    let currentLink = lastLink;
    let caseIndex = 0;

    // Generate comparison chain
    for (const caseInfo of caseInfos) {
      if (!caseInfo.isDefault) {
        const currentCheckStateId = checkStates[caseIndex];
        const nextCheckStateId =
        caseIndex + 1 < checkStates.length
        ? checkStates[caseIndex + 1]
        : fallthroughTarget;
        this.ir.linkStates(currentLink, currentCheckStateId);
        const comparisonVar = this.ir.createTempVar();
        const compareStateId = this.ir.addState({
          type: "BINARY",
          op: "===",
          to: comparisonVar.name,
          left: discriminantInfo.resultVar.name,
          right: caseInfo.testInfo.resultVar.name,
        });
        const jumpStateId = this.ir.addState({
          type: "COND_JUMP",
          testVar: comparisonVar.name,
          trueState: caseInfo.consequentInfo.start,
          falseState: nextCheckStateId,
        });
        this.ir.getState(currentCheckStateId).next = compareStateId;
        this.ir.linkStates(compareStateId, jumpStateId);
        currentLink = jumpStateId;
        caseIndex++;
      }
    }
    if (checkStates.length > 0) {
      this.ir.linkStates(lastLink, checkStates[0]);
    } else {
      this.ir.linkStates(lastLink, fallthroughTarget);
    }

    this.ir.controlStack.pop();

    return { start: discriminantInfo.start, end: endSwitchStateId };
  }

  /**
   * Handles While loops.
   */
  handleWhileStatement(path) {
    const loopStartId = this.ir.addState({ type: "NOOP" });
    const loopEndId = this.ir.addState({ type: "NOOP" });

    this.ir.controlStack.push({
      type: "LOOP",
      continueTarget: loopStartId,
      breakTarget: loopEndId,
    });

    const condInfo = this.ir.processExpression(path.get("test"));
    const bodyInfo = this.ir.processBlock(path.get("body"));

    this.ir.controlStack.pop();

    this.ir.linkStates(loopStartId, condInfo.start);
    this.ir.linkStates(bodyInfo.end, loopStartId);
    const jumpStateId = this.ir.addState({
      type: "COND_JUMP",
      testVar: condInfo.resultVar.name,
      trueState: bodyInfo.start,
      falseState: loopEndId,
    });
    this.ir.linkStates(condInfo.end, jumpStateId);

    const finalEnd = this.tryInject(loopEndId);

    return { start: loopStartId, end: finalEnd };
  }

  /**
   * Handles For loops.
   */
  handleForStatement(path) {
    const loopStartId = this.ir.addState({ type: "NOOP" });
    const condCheckId = this.ir.addState({ type: "NOOP" });
    const loopEndId = this.ir.addState({ type: "NOOP" });
    const updateId = this.ir.addState({ type: "NOOP" });

    this.ir.controlStack.push({
      type: "LOOP",
      continueTarget: updateId,
      breakTarget: loopEndId,
    });

    const initInfo = path.node.init ? this.process(path.get("init")) : null;
    const condInfo = path.node.test
    ? this.ir.processExpression(path.get("test"))
    : null;
    const bodyInfo = this.ir.processBlock(path.get("body"));
    const updateInfo = path.node.update
    ? this.ir.processExpression(path.get("update"))
    : null;

    this.ir.controlStack.pop();

    if (initInfo) {
      this.ir.linkStates(loopStartId, initInfo.start);
      this.ir.linkStates(initInfo.end, condCheckId);
    } else {
      this.ir.linkStates(loopStartId, condCheckId);
    }

    if (condInfo) {
      const jumpStateId = this.ir.addState({
        type: "COND_JUMP",
        testVar: condInfo.resultVar.name,
        trueState: bodyInfo.start,
        falseState: loopEndId,
      });
      this.ir.linkStates(condCheckId, condInfo.start);
      this.ir.linkStates(condInfo.end, jumpStateId);
    } else {
      this.ir.linkStates(condCheckId, bodyInfo.start);
    }

    this.ir.linkStates(bodyInfo.end, updateId);
    if (updateInfo) {
      this.ir.linkStates(updateId, updateInfo.start);
      this.ir.linkStates(updateInfo.end, condCheckId);
    } else {
      this.ir.linkStates(updateId, condCheckId);
    }

    const finalEnd = this.tryInject(loopEndId);

    return { start: loopStartId, end: finalEnd };
  }

  /**
   * Handles Do-While loops.
   */
  handleDoWhileStatement(path) {
    const bodyStartId = this.ir.addState({ type: "NOOP" });
    const condCheckId = this.ir.addState({ type: "NOOP" });
    const loopEndId = this.ir.addState({ type: "NOOP" });

    this.ir.controlStack.push({
      type: "LOOP",
      continueTarget: condCheckId,
      breakTarget: loopEndId,
    });

    const bodyInfo = this.ir.processBlock(path.get("body"));
    const condInfo = this.ir.processExpression(path.get("test"));

    this.ir.controlStack.pop();

    this.ir.linkStates(bodyStartId, bodyInfo.start);
    this.ir.linkStates(bodyInfo.end, condCheckId);
    this.ir.linkStates(condCheckId, condInfo.start);
    const jumpStateId = this.ir.addState({
      type: "COND_JUMP",
      testVar: condInfo.resultVar.name,
      trueState: bodyStartId,
      falseState: loopEndId,
    });
    this.ir.linkStates(condInfo.end, jumpStateId);

    const finalEnd = this.tryInject(loopEndId);

    return { start: bodyStartId, end: finalEnd };
  }
}

module.exports = StatementHandler;
