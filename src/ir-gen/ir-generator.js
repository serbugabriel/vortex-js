/**
 * @file ir-generator.js
 * @description Core component responsible for transforming the Babel AST into the
 * custom Intermediate Representation (IR) used by the VortexJS Stackless Virtual Machine.
 * Handles state generation, control flow flattening, and memory virtualization.
 */

const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const StatementHandler = require("./ir-statement-handler");
const ExpressionHandler = require("./ir-expression-handler");

/**
 * Class representing the IR Generator.
 * Converts JavaScript AST nodes into a flat list of states for the VM.
 */
class IRGenerator {
  /**
   * @param {Object} context - The compilation context.
   * @param {Object} context.ast - The root AST to transform.
   * @param {Map} context.memoryMap - Map of variable names to memory indices.
   * @param {Set} context.globalIds - Set of memory indices belonging to the Global Memory (GM).
   * @param {Array} context.states - Array to store generated states.
   * @param {Map} context.functionStartStates - Map of function names to their entry state IDs.
   * @param {Object} context.stringConcealer - Handler for string encryption/decoding logic.
   * @param {Object} context.stringCollector - Collector for string literals found in source.
   * @param {Array} context.preloadedGlobals - List of global variables to be proxied.
   * @param {boolean} context.noEncryption - Flag to disable string encryption.
   * @param {Object} context.opaqueManager - Manager for opaque predicates (control flow hardening).
   * @param {boolean} [context.partialMode] - Whether partial virtualization is enabled.
   * @param {Set} [context.virtualizedNodes] - Set of AST nodes explicitly targeted for virtualization.
   */
  constructor(context) {
    this.ast = context.ast;
    this.memoryMap = context.memoryMap;
    this.globalIds = context.globalIds;
    this.states = context.states;
    this.functionStartStates = context.functionStartStates;
    this.stringConcealer = context.stringConcealer;
    this.stringCollector = context.stringCollector;
    this.preloadedGlobals = context.preloadedGlobals;
    this.noEncryption = context.noEncryption;
    this.opaqueManager = context.opaqueManager;

    // Partial Virtualization Support
    this.partialMode = context.partialMode || false;
    this.virtualizedNodes = context.virtualizedNodes || new Set();

    this.tempVarCounter = 0;
    this.stateCounter = 1;
    this.functionContext = null;
    this.controlStack = [];

    // Sub-handlers for specific AST node types
    this.statementHandler = new StatementHandler(this);
    this.expressionHandler = new ExpressionHandler(this);
  }

  /**
   * Adds a new state to the FSM.
   * @param {Object} operation - The operation object defining the instruction.
   * @returns {number} The ID of the newly created state.
   */
  addState(operation) {
    const stateId = this.stateCounter++;
    this.states[stateId] = {
      id: stateId,
      op: operation,
      next: null,
    };
    return stateId;
  }

  /**
   * Retrieves a state by its ID.
   * @param {number} id - The state ID.
   * @returns {Object} The state object.
   * @throws {Error} If the state ID does not exist.
   */
  getState(id) {
    if (!this.states[id]) {
      throw new Error(
        `IR Generation Error: Attempted to access non-existent state with ID ${id}.`,
      );
    }
    return this.states[id];
  }

  /**
   * Links two states (Control Flow).
   * Sets the 'next' pointer of the source state to the target state ID.
   * @param {number} fromStateId - Source state ID.
   * @param {number} toStateId - Target state ID.
   */
  linkStates(fromStateId, toStateId) {
    if (typeof fromStateId !== "number" || typeof toStateId !== "number") {
      throw new Error(
        `State Linking Error: Invalid state IDs provided. From: ${fromStateId}, To: ${toStateId}`,
      );
    }
    const fromState = this.getState(fromStateId);

    // Only link if the state doesn't already have a next pointer
    // and isn't a terminal operation (Return, Throw, etc.)
    if (
      fromState.next === null &&
      !["RETURN", "COND_JUMP", "HALT", "THROW", "FINALLY_DISPATCH"].includes(
        fromState.op.type,
      )
    ) {
      fromState.next = toStateId;
    }
  }

  /**
   * Creates a unique temporary variable identifier.
   * Registers it in the memory map and current function context.
   * @returns {Object} Babel Identifier node.
   */
  createTempVar() {
    const name = `_temp$${this.tempVarCounter++}`;
    if (!this.memoryMap.has(name)) {
      this.memoryMap.set(name, this.memoryMap.size);
    }
    if (this.functionContext) {
      this.functionContext.tempVars.add(name);
    }
    return t.identifier(name);
  }

  /**
   * Delegates processing of a statement to the StatementHandler.
   * @param {Object} path - Babel AST path.
   * @returns {Object} Result object containing start and end state IDs.
   */
  processStatement(path) {
    return this.statementHandler.process(path);
  }

  /**
   * Delegates processing of an expression to the ExpressionHandler.
   * @param {Object} path - Babel AST path.
   * @returns {Object} Result object containing start and end state IDs, and the result variable.
   */
  processExpression(path) {
    return this.expressionHandler.process(path);
  }

  /**
   * Processes a BlockStatement or a single statement.
   * @param {Object} path - Babel AST path.
   */
  processBlock(path) {
    if (path.isBlockStatement()) {
      return this.processStatements(path.get("body"));
    }
    return this.processStatement(path);
  }

  /**
   * Processes a list of statements sequentially.
   * Links the end of one statement to the start of the next.
   * @param {Array} statementPaths - Array of Babel AST paths.
   * @returns {Object} Start and end state IDs for the sequence.
   */
  processStatements(statementPaths) {
    const paths = Array.isArray(statementPaths)
    ? statementPaths.filter(Boolean)
    : [statementPaths].filter(Boolean);

    if (paths.length === 0) {
      const emptyState = this.addState({
        type: "NOOP",
      });
      return {
        start: emptyState,
        end: emptyState,
      };
    }

    let firstResult = null;
    let lastResult = null;

    for (const statementPath of paths) {
      const currentResult = this.processStatement(statementPath);
      if (!currentResult) continue;

      if (!firstResult) firstResult = currentResult;
      if (lastResult) this.linkStates(lastResult.end, currentResult.start);
      lastResult = currentResult;
    }

    return firstResult
    ? {
      start: firstResult.start,
      end: lastResult.end,
    }
    : this.processStatements([]);
  }

  /**
   * Processes a function declaration or expression.
   * Sets up the function context, processes the body, and handles return values.
   * @param {Object} path - Babel AST path for the function.
   * @param {number} funcEntryStateId - The pre-allocated entry state ID.
   */
  processFunction(path, funcEntryStateId) {
    const funcName = path.node.id
    ? path.node.id.name
    : `anonymous_${funcEntryStateId}`;
    const oldContext = this.functionContext;

    this.functionContext = {
      name: funcName,
      tempVars: new Set(),
      isAsync: path.node.async,
    };

    const bodyStates = this.processBlock(path.get("body"));
    this.linkStates(funcEntryStateId, bodyStates.start);

    const isTerminatingOp = (opType) =>
    ["RETURN", "THROW", "HALT", "FINALLY_DISPATCH"].includes(opType);

    const endState = this.getState(bodyStates.end);
    // Ensure function always returns undefined if no return statement exists
    if (endState && !isTerminatingOp(endState.op.type)) {
      const tempUndefinedVar = this.createTempVar();
      const assignUndefinedStateId = this.addState({
        type: "ASSIGN_LITERAL",
        to: tempUndefinedVar.name,
        value: undefined,
      });
      const returnStateId = this.addState({
        type: "RETURN",
        valueVar: tempUndefinedVar.name,
      });
      this.linkStates(bodyStates.end, assignUndefinedStateId);
      this.linkStates(assignUndefinedStateId, returnStateId);
    }

    // Configure the entry state with function metadata
    const funcEntryState = this.getState(funcEntryStateId);
    funcEntryState.op.tempVars = Array.from(this.functionContext.tempVars);
    funcEntryState.op.isGenerator = path.node.generator;
    funcEntryState.op.isAsync = path.node.async;

    if (!funcEntryState.op.params) {
      funcEntryState.op.params = path.node.params;
    }

    this.functionContext = oldContext;
  }

  /**
   * Final optimization and transformation pass on the generated IR.
   * Handles string encryption, memory array replacements (M/GM), and object method wrappers.
   */
  postProcessIR() {
    const self = this;
    const M = t.identifier("M");
    const GM = t.identifier("GM");

    // Helper to generate string access code (encrypted or direct)
    const createStringAccess = (stringValue) => {
      const stringId = self.stringCollector.getStringId(stringValue);
      const arrayIdentifier = t.identifier(
        self.stringCollector.arrayVariableName,
      );

      if (self.noEncryption) {
        return t.memberExpression(
          arrayIdentifier,
          t.numericLiteral(stringId),
                                  true,
        );
      }

      return t.callExpression(
        t.identifier(self.stringConcealer.decoderFunctionName),
                              [t.memberExpression(arrayIdentifier, t.numericLiteral(stringId), true)],
      );
    };

    // Iterate over all valid states
    for (const state of this.states.filter(Boolean)) {
      // Direct literal assignments containing Functions or Classes require deep processing
      if (
        state.op.type === "ASSIGN_LITERAL_DIRECT" &&
        (t.isClassExpression(state.op.value) ||
        t.isFunctionExpression(state.op.value) ||
        t.isArrowFunctionExpression(state.op.value))
      ) {
        // Create a temporary AST program to traverse the literal's body safely
        const tempAst = t.file(
          t.program([t.expressionStatement(state.op.value)]),
        );
        let usesM = false;

        traverse(tempAst, {
          Identifier(path) {
            if (path.node.name === self.stringConcealer.decoderFunctionName)
              return;

            // Skip structural identifiers (keys, params, labels, etc.)
            if (
              (path.key === "key" || path.key === "property") &&
              (path.parent.type === "ObjectProperty" ||
              path.parent.type === "ObjectMethod" ||
              path.parent.type === "ClassProperty" ||
              path.parent.type === "ClassMethod" ||
              path.parent.type === "MemberExpression" ||
              path.parent.type === "OptionalMemberExpression") &&
              !path.parent.computed
            )
              return;
              if (path.listKey === "params") return;
              if (
                path.key === "id" &&
                (path.parent.type === "FunctionExpression" ||
                path.parent.type === "FunctionDeclaration")
              )
                return;
                if (
                  path.key === "label" &&
                  (path.parent.type === "BreakStatement" ||
                  path.parent.type === "ContinueStatement" ||
                  path.parent.type === "LabeledStatement")
                )
                  return;
                  if (path.key === "id" && path.parent.type === "VariableDeclarator")
                    return;
            if (path.key === "param" && path.parent.type === "CatchClause")
              return;

            // Replace known variables with Memory (M) or Global Memory (GM) lookups
            if (self.memoryMap.has(path.node.name)) {
              if (path.scope.hasBinding(path.node.name)) return;
              const memIdx = self.memoryMap.get(path.node.name);
              const targetArray = self.globalIds.has(memIdx) ? GM : M;
              if (targetArray === M) usesM = true;
              path.replaceWith(
                t.memberExpression(targetArray, t.numericLiteral(memIdx), true),
              );
            }
          },
          // --- FIXED: Only rewrite 'this' for Arrow Functions ---
          // Regular functions define their own 'this', so we only intercept it for arrows
          // which inherit 'this' lexically (from our VM context).
          ThisExpression(path) {
            const parentFunc = path.getFunctionParent();
            if (parentFunc && parentFunc.isArrowFunctionExpression()) {
              if (self.memoryMap.has("_THIS")) {
                const memIdx = self.memoryMap.get("_THIS");
                const targetArray = self.globalIds.has(memIdx) ? GM : M;
                if (targetArray === M) usesM = true;
                path.replaceWith(
                  t.memberExpression(
                    targetArray,
                    t.numericLiteral(memIdx),
                                     true,
                  ),
                );
              }
            }
          },
          // ----------------------------------------------------
          MemberExpression(path) {
            if (!path.node.computed && t.isIdentifier(path.node.property)) {
              const propName = path.node.property.name;
              if (self.stringCollector.stringMap.has(propName)) {
                path.replaceWith(
                  t.memberExpression(
                    path.node.object,
                    createStringAccess(propName),
                                     true,
                  ),
                );
              }
            }
          },
          ObjectProperty(path) {
            if (!path.node.computed && t.isIdentifier(path.node.key)) {
              const propName = path.node.key.name;
              if (self.stringCollector.stringMap.has(propName)) {
                path.replaceWith(
                  t.objectProperty(
                    createStringAccess(propName),
                                   path.node.value,
                                   true,
                  ),
                );
              }
            }
          },
          CallExpression(path) {
            const callee = path.get("callee");
            // Check for method calls on known global objects
            if (
              callee.isMemberExpression() &&
              callee.get("object").isIdentifier()
            ) {
              const globalName = callee.get("object").node.name;
              if (path.scope.hasBinding(globalName)) return;
              if (self.preloadedGlobals.includes(globalName)) {
                const globalMemIdx = self.memoryMap.get(globalName);
                const newCallee = t.memberExpression(
                  t.memberExpression(GM, t.numericLiteral(globalMemIdx), true),
                                                     callee.node.property,
                                                     callee.node.computed,
                );
                path.get("callee").replaceWith(newCallee);
              }
            }
          },
          StringLiteral(path) {
            if (
              (path.parentPath.isObjectProperty() ||
              path.parentPath.isClassProperty()) &&
              path.key === "key" &&
              !path.parent.computed
            )
              return;
              const stringValue = path.node.value;
              if (self.stringCollector.stringMap.has(stringValue)) {
                path.replaceWith(createStringAccess(stringValue));
              }
          },
          TemplateLiteral(path) {
            const nodes = [];
            const { quasis, expressions } = path.node;
            let index = 0;
            for (const elem of quasis) {
              // FIX: Use 'cooked' to handle escape sequences correctly
              const val = elem.value.cooked;
              if (val) {
                if (self.stringCollector.stringMap.has(val))
                  nodes.push(createStringAccess(val));
                else nodes.push(t.stringLiteral(""));
              }
              if (index < expressions.length) {
                nodes.push(expressions[index]);
                index++;
              }
            }
            const filteredNodes = nodes.filter(
              (n) => !(t.isStringLiteral(n) && n.value === ""),
            );
            if (filteredNodes.length === 0) {
              path.replaceWith(t.stringLiteral(""));
              return;
            }
            if (filteredNodes.length === 1) {
              path.replaceWith(filteredNodes[0]);
              return;
            }
            let left = filteredNodes[0];
            for (let i = 1; i < filteredNodes.length; i++) {
              left = t.binaryExpression("+", left, filteredNodes[i]);
            }
            path.replaceWith(left);
          },
        });

        // Wrap the transformed node in a closure if it accesses 'M'
        const transformedNode = tempAst.program.body[0].expression;
        if (usesM) {
          const capturedM = t.identifier("M");
          const wrapper = t.callExpression(
            t.arrowFunctionExpression([capturedM], transformedNode),
                                           [t.identifier("M")],
          );
          state.op.value = wrapper;
        } else {
          state.op.value = transformedNode;
        }
      }
    }
  }

  /**
   * Main entry point for transformation.
   * Lowers complex control flow (loops) and recursively processes AST nodes.
   */
  transformToStates() {
    // Initialize Entry State (Index 0)
    this.states[0] = {
      id: 0,
      op: {
        type: "NOOP",
      },
      next: null,
    };
    const self = this;

    // Helper to check if we should process a node (Partial Virtualization)
    const shouldProcess = (path) => {
      if (!self.partialMode) return true;
      let curr = path;
      while (curr) {
        if (self.virtualizedNodes.has(curr.node)) return true;
        curr = curr.parentPath;
      }
      return false;
    };

    traverse(this.ast, {
      // Lower ForOf loops to manual iterator protocol usage
      ForOfStatement(path) {
        if (!shouldProcess(path)) return;
        const { left, right, body } = path.node;
        const iterator = path.scope.generateUidIdentifier("iterator");
        const result = path.scope.generateUidIdentifier("result");

        self.memoryMap.set(iterator.name, self.memoryMap.size);
        self.memoryMap.set(result.name, self.memoryMap.size);

        let isAsyncContext = false;
        const parentFuncPath = path.getFunctionParent();
        if (!parentFuncPath) isAsyncContext = true;
        else if (parentFuncPath.isFunctionDeclaration()) isAsyncContext = true;
        else isAsyncContext = parentFuncPath.node.async;

        if (isAsyncContext) {
          // Async Iterator Protocol Lowering
          const iteratorInitialization = t.variableDeclaration("const", [
            t.variableDeclarator(
              iterator,
              t.callExpression(
                t.memberExpression(
                  t.logicalExpression(
                    "||",
                    t.memberExpression(
                      right,
                      t.memberExpression(
                        t.identifier("Symbol"),
                                         t.identifier("asyncIterator"),
                      ),
                      true,
                    ),
                    t.memberExpression(
                      right,
                      t.memberExpression(
                        t.identifier("Symbol"),
                                         t.identifier("iterator"),
                      ),
                      true,
                    ),
                  ),
                  t.identifier("call"),
                ),
                [right],
              ),
            ),
          ]);
          const resultDeclaration = t.variableDeclaration("let", [
            t.variableDeclarator(result),
          ]);
          const valueAssignment = t.isVariableDeclaration(left)
          ? t.variableDeclaration(left.kind, [
            t.variableDeclarator(
              left.declarations[0].id,
              t.memberExpression(result, t.identifier("value")),
            ),
          ])
          : t.expressionStatement(
            t.assignmentExpression(
              "=",
              left,
              t.memberExpression(result, t.identifier("value")),
            ),
          );
          const nextCall = t.callExpression(
            t.memberExpression(iterator, t.identifier("next")),
                                            [],
          );
          const awaitedNext = t.awaitExpression(nextCall);
          const loop = t.whileStatement(
            t.unaryExpression(
              "!",
              t.memberExpression(
                t.assignmentExpression("=", result, awaitedNext),
                                 t.identifier("done"),
              ),
            ),
            t.blockStatement([valueAssignment, body]),
          );
          // Cleanup handling (iterator.return)
          const cleanupBlock = t.blockStatement([
            t.ifStatement(
              t.logicalExpression(
                "&&",
                t.logicalExpression(
                  "&&",
                  t.identifier(result.name),
                                    t.unaryExpression(
                                      "!",
                                      t.memberExpression(result, t.identifier("done")),
                                    ),
                ),
                t.memberExpression(iterator, t.identifier("return")),
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.awaitExpression(
                    t.callExpression(
                      t.memberExpression(iterator, t.identifier("return")),
                                     [],
                    ),
                  ),
                ),
              ]),
            ),
          ]);
          path.replaceWithMultiple([
            iteratorInitialization,
            resultDeclaration,
            t.tryStatement(t.blockStatement([loop]), null, cleanupBlock),
          ]);
        } else {
          // Sync Iterator Protocol Lowering
          const iteratorInitialization = t.variableDeclaration("const", [
            t.variableDeclarator(
              iterator,
              t.callExpression(
                t.memberExpression(
                  right,
                  t.memberExpression(
                    t.identifier("Symbol"),
                                     t.identifier("iterator"),
                  ),
                  true,
                ),
                [],
              ),
            ),
          ]);
          const resultDeclaration = t.variableDeclaration("let", [
            t.variableDeclarator(result),
          ]);
          const valueAssignment = t.isVariableDeclaration(left)
          ? t.variableDeclaration(left.kind, [
            t.variableDeclarator(
              left.declarations[0].id,
              t.memberExpression(result, t.identifier("value")),
            ),
          ])
          : t.expressionStatement(
            t.assignmentExpression(
              "=",
              left,
              t.memberExpression(result, t.identifier("value")),
            ),
          );
          const nextCall = t.callExpression(
            t.memberExpression(iterator, t.identifier("next")),
                                            [],
          );
          const loop = t.whileStatement(
            t.unaryExpression(
              "!",
              t.memberExpression(
                t.assignmentExpression("=", result, nextCall),
                                 t.identifier("done"),
              ),
            ),
            t.blockStatement([valueAssignment, body]),
          );
          const cleanupBlock = t.blockStatement([
            t.ifStatement(
              t.logicalExpression(
                "&&",
                t.logicalExpression(
                  "&&",
                  t.identifier(result.name),
                                    t.unaryExpression(
                                      "!",
                                      t.memberExpression(result, t.identifier("done")),
                                    ),
                ),
                t.logicalExpression(
                  "&&",
                  t.memberExpression(iterator, t.identifier("return")),
                                    t.binaryExpression(
                                      "===",
                                      t.unaryExpression(
                                        "typeof",
                                        t.memberExpression(iterator, t.identifier("return")),
                                      ),
                                      t.stringLiteral("function"),
                                    ),
                ),
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(iterator, t.identifier("return")),
                                   [],
                  ),
                ),
              ]),
            ),
          ]);
          path.replaceWithMultiple([
            iteratorInitialization,
            resultDeclaration,
            t.tryStatement(t.blockStatement([loop]), null, cleanupBlock),
          ]);
        }
      },
      // Lower ForIn loops to standard for loop over Object.keys
      ForInStatement(path) {
        if (!shouldProcess(path)) return;
        const { left, right, body } = path.node;
        const keys = path.scope.generateUidIdentifier("keys");
        const i = path.scope.generateUidIdentifier("i");
        self.memoryMap.set(keys.name, self.memoryMap.size);
        self.memoryMap.set(i.name, self.memoryMap.size);
        const keyAssignment = t.isVariableDeclaration(left)
        ? t.variableDeclaration(left.kind, [
          t.variableDeclarator(
            left.declarations[0].id,
            t.memberExpression(keys, i, true),
          ),
        ])
        : t.expressionStatement(
          t.assignmentExpression(
            "=",
            left,
            t.memberExpression(keys, i, true),
          ),
        );
        const keysInitialization = t.variableDeclaration("const", [
          t.variableDeclarator(
            keys,
            t.callExpression(
              t.memberExpression(t.identifier("Object"), t.identifier("keys")),
                             [right],
            ),
          ),
        ]);
        const loop = t.forStatement(
          t.variableDeclaration("let", [
            t.variableDeclarator(i, t.numericLiteral(0)),
          ]),
          t.binaryExpression(
            "<",
            i,
            t.memberExpression(keys, t.identifier("length")),
          ),
          t.updateExpression("++", i, false),
                                    t.blockStatement([keyAssignment, body]),
        );
        path.replaceWithMultiple([keysInitialization, loop]);
      },
    });

    // First pass: Identify function declarations to allocate Entry States
    traverse(this.ast, {
      FunctionDeclaration: (path) => {
        if (self.partialMode && !self.virtualizedNodes.has(path.node)) return;

        const funcName = path.node.id.name;
        if (!this.functionStartStates.has(funcName)) {
          this.functionStartStates.set(
            funcName,
            this.addState({
              type: "FUNC_ENTRY",
              name: funcName,
            }),
          );
        }
      },
    });

    // Second pass: Process function bodies and program structure
    traverse(this.ast, {
      FunctionDeclaration(path) {
        if (self.partialMode && !self.virtualizedNodes.has(path.node)) return;

        const funcName = path.node.id.name;
        const funcEntryStateId = self.functionStartStates.get(funcName);
        self.processFunction(path, funcEntryStateId);
        path.skip();
      },
      Program: {
        exit(path) {
          if (self.partialMode && !self.virtualizedNodes.has(path.node)) {
            const haltStateId = self.addState({ type: "HALT" });
            self.getState(0).next = haltStateId;
            return;
          }

          const topLevelStatements = path
          .get("body")
          .filter((p) => !p.isFunctionDeclaration());

          if (topLevelStatements.length > 0) {
            const mainBodyStates = self.processStatements(topLevelStatements);
            self.getState(0).next = mainBodyStates.start;
            const haltStateId = self.addState({
              type: "HALT",
            });
            self.linkStates(mainBodyStates.end, haltStateId);
          } else {
            const haltStateId = self.addState({
              type: "HALT",
            });
            self.getState(0).next = haltStateId;
          }
        },
      },
    });

    this.postProcessIR();
  }
}

module.exports = IRGenerator;
