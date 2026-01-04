/**
 * @file ir-expression-handler.js
 * @description Handles the transformation of Babel AST Expression nodes into
 * Intermediate Representation (IR) states. Manages complex expressions like
 * assignments, binary operations, function calls, and object creation.
 */

const t = require("@babel/types");
const ClassHandler = require("./ir-class-handler");

/**
 * Class responsible for processing expression nodes.
 */
class ExpressionHandler {
  /**
   * @param {Object} irGenerator - The parent IR Generator instance.
   */
  constructor(irGenerator) {
    this.ir = irGenerator;
    this.classHandler = new ClassHandler(irGenerator);
  }

  /**
   * Dispatches the expression processing to the appropriate handler method based on node type.
   * @param {Object} path - Babel AST path for the expression.
   * @returns {Object} Result object { start, end, resultVar }.
   */
  process(path) {
    if (path === null || path.node === null)
      path = { node: t.valueToNode(undefined) };

    const node = path.node;

    if (t.isSpreadElement(node)) return this.handleSpreadElement(path);

    if (t.isClassExpression(node)) return this.handleClassExpression(path);
    if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node))
      return this.handleFunctionLikeExpression(path);
    if (t.isIdentifier(node)) return this.handleIdentifier(path);
    if (t.isThisExpression(node)) return this.handleThisExpression(path);

    if (t.isMetaProperty(node)) return this.handleMetaProperty(path);

    if (t.isUpdateExpression(node)) return this.handleUpdateExpression(path);
    if (t.isAssignmentExpression(node))
      return this.handleAssignmentExpression(path);
    if (t.isUnaryExpression(node)) return this.handleUnaryExpression(path);
    if (t.isLogicalExpression(node)) return this.handleLogicalExpression(path);
    if (t.isConditionalExpression(node))
      return this.handleConditionalExpression(path);
    if (t.isSequenceExpression(node))
      return this.handleSequenceExpression(path);
    if (t.isArrayExpression(node)) return this.handleArrayExpression(path);
    if (t.isObjectExpression(node)) return this.handleObjectExpression(path);
    if (t.isTemplateLiteral(node)) return this.handleTemplateLiteral(path);
    if (t.isTemplateElement(node) || t.isStringLiteral(node))
      return this.handleStringLiteral(path);
    if (
      [
        "NumericLiteral",
        "BooleanLiteral",
        "NullLiteral",
        "RegExpLiteral",
      ].includes(node.type)
    )
      return this.handleSimpleLiteral(path);
      if (t.isAwaitExpression(node)) return this.handleAwaitExpression(path);
      if (t.isYieldExpression(node)) return this.handleYieldExpression(path);
      if (t.isBinaryExpression(node)) return this.handleBinaryExpression(path);
      if (t.isMemberExpression(node)) return this.handleMemberExpression(path);
      if (t.isCallExpression(node)) return this.handleCallExpression(path);
      if (t.isNewExpression(node)) return this.handleNewExpression(path);

      const loc = node.loc?.start;
    throw new Error(
      `Unsupported expression type: ${node.type} at ${
        loc ? `${loc.line}:${loc.column}` : "Unknown location"
      }`,
    );
  }

  /**
   * Handles MetaProperties (e.g., new.target).
   */
  handleMetaProperty(path) {
    const { meta, property } = path.node;
    if (meta.name === "new" && property.name === "target") {
      const tempVar = this.ir.createTempVar();
      const stateId = this.ir.addState({
        type: "ASSIGN",
        to: tempVar.name,
        from: "_NEW_TARGET",
      });
      return { start: stateId, end: stateId, resultVar: tempVar };
    }
    throw new Error(
      "Unsupported MetaProperty: " + meta.name + "." + property.name,
    );
  }

  /**
   * Handles Sequence Expressions (comma operator).
   * Evaluates all expressions and returns the result of the last one.
   */
  handleSequenceExpression(path) {
    const exprPaths = path.get("expressions");
    if (!exprPaths || exprPaths.length === 0) {
      const noop = this.ir.addState({ type: "NOOP" });
      const tempVar = this.ir.createTempVar();
      const assignUndefined = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: tempVar.name,
        value: undefined,
      });
      this.ir.linkStates(noop, assignUndefined);
      return { start: noop, end: assignUndefined, resultVar: tempVar };
    }

    let startState = null;
    let lastEndState = null;
    let lastResultVar = null;

    for (const exprPath of exprPaths) {
      const info = this.process(exprPath);
      if (startState === null) startState = info.start;
      if (lastEndState !== null) this.ir.linkStates(lastEndState, info.start);
      lastEndState = info.end;
      lastResultVar = info.resultVar;
    }

    return { start: startState, end: lastEndState, resultVar: lastResultVar };
  }

  /**
   * Handles spread syntax (...arg).
   * Marks the result variable with an 'isSpread' flag for consumers.
   */
  handleSpreadElement(path) {
    const argInfo = this.process(path.get("argument"));
    return {
      start: argInfo.start,
      end: argInfo.end,
      resultVar: argInfo.resultVar,
      isSpread: true,
    };
  }

  /**
   * Helper to format argument lists, handling spread elements.
   */
  _getArgList(argInfos) {
    return argInfos.map((info) =>
    info.isSpread ? { spreadVar: info.resultVar.name } : info.resultVar.name,
    );
  }

  /**
   * Handles yield expressions in generators.
   * Can delegate (yield*) or yield a single value.
   */
  handleYieldExpression(path) {
    let argVar = null;
    let startState = null;
    let lastState = null;

    if (path.node.argument) {
      const info = this.process(path.get("argument"));
      argVar = info.resultVar.name;
      startState = info.start;
      lastState = info.end;
    } else {
      const temp = this.ir.createTempVar();
      const noop = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: temp.name,
        value: undefined,
      });
      argVar = temp.name;
      startState = lastState = noop;
    }

    const resultVar = this.ir.createTempVar();

    const yieldStateId = this.ir.addState({
      type: "YIELD",
      valueVar: argVar,
      to: resultVar.name,
      delegate: path.node.delegate,
    });

    this.ir.linkStates(lastState, yieldStateId);

    return {
      start: startState,
      end: yieldStateId,
      resultVar,
    };
  }

  /**
   * Delegates class expression processing to ClassHandler.
   */
  handleClassExpression(path) {
    const resultVar = this.ir.createTempVar();
    const result = this.classHandler.process(path, resultVar.name);
    return result;
  }

  /**
   * Handles conditional (ternary) expressions using conditional jumps.
   */
  handleConditionalExpression(path) {
    const resultVar = this.ir.createTempVar();
    const testInfo = this.process(path.get("test"));
    const consequentInfo = this.process(path.get("consequent"));
    const alternateInfo = this.process(path.get("alternate"));

    const endStateId = this.ir.addState({ type: "NOOP" });

    // Path 1: Consequent
    const assignTrueStateId = this.ir.addState({
      type: "ASSIGN",
      to: resultVar.name,
      from: consequentInfo.resultVar.name,
    });
    this.ir.linkStates(consequentInfo.end, assignTrueStateId);
    this.ir.linkStates(assignTrueStateId, endStateId);

    // Path 2: Alternate
    const assignFalseStateId = this.ir.addState({
      type: "ASSIGN",
      to: resultVar.name,
      from: alternateInfo.resultVar.name,
    });
    this.ir.linkStates(alternateInfo.end, assignFalseStateId);
    this.ir.linkStates(assignFalseStateId, endStateId);

    // Branching
    const jumpStateId = this.ir.addState({
      type: "COND_JUMP",
      testVar: testInfo.resultVar.name,
      trueState: consequentInfo.start,
      falseState: alternateInfo.start,
    });
    this.ir.linkStates(testInfo.end, jumpStateId);

    return { start: testInfo.start, end: endStateId, resultVar };
  }

  /**
   * Handles await expressions.
   * Generates a state that pauses execution until the promise resolves.
   */
  handleAwaitExpression(path) {
    const argumentInfo = this.process(path.get("argument"));
    const resultVar = this.ir.createTempVar();
    const awaitStateId = this.ir.addState({
      type: "AWAIT",
      promiseVar: argumentInfo.resultVar.name,
      to: resultVar.name,
    });
    this.ir.linkStates(argumentInfo.end, awaitStateId);
    return {
      start: argumentInfo.start,
      end: awaitStateId,
      resultVar,
    };
  }

  /**
   * Handles function expressions (including arrow functions).
   * Assigns the function node directly to a temp var (post-processed later).
   */
  handleFunctionLikeExpression(path) {
    const tempVar = this.ir.createTempVar();
    const stateId = this.ir.addState({
      type: "ASSIGN_LITERAL_DIRECT",
      to: tempVar.name,
      value: path.node,
    });
    return { start: stateId, end: stateId, resultVar: tempVar };
  }

  /**
   * Handles identifiers.
   * Distinguishes between internal memory variables and implicit globals.
   */
  handleIdentifier(path) {
    const tempVar = this.ir.createTempVar();
    const varName = path.node.name;
    if (this.ir.memoryMap.has(varName)) {
      const stateId = this.ir.addState({
        type: "ASSIGN",
        to: tempVar.name,
        from: varName,
      });
      return { start: stateId, end: stateId, resultVar: tempVar };
    } else {
      const stateId = this.ir.addState({
        type: "ASSIGN_GLOBAL",
        to: tempVar.name,
        globalName: varName,
      });
      return { start: stateId, end: stateId, resultVar: tempVar };
    }
  }

  /**
   * Handles 'this' expressions.
   */
  handleThisExpression() {
    const tempVar = this.ir.createTempVar();
    const stateId = this.ir.addState({
      type: "ASSIGN",
      to: tempVar.name,
      from: "_THIS",
    });
    return { start: stateId, end: stateId, resultVar: tempVar };
  }

  /**
   * Handles update expressions (e.g., i++, --j).
   * Supports both identifiers and member expressions.
   */
  handleUpdateExpression(path) {
    const arg = path.get("argument");
    const op = path.node.operator === "++" ? "+" : "-";
    const prefix = path.node.prefix;

    if (t.isIdentifier(arg.node)) {
      const varName = arg.node.name;
      const tempVar = this.ir.createTempVar();

      const loadState = this.ir.addState({
        type: "ASSIGN",
        to: tempVar.name,
        from: varName,
      });

      const one = this.ir.createTempVar();
      const assignOne = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: one.name,
        value: 1,
      });
      this.ir.linkStates(loadState, assignOne);

      const opState = this.ir.addState({
        type: "BINARY",
        op,
        to: varName,
        left: tempVar.name,
        right: one.name,
      });
      this.ir.linkStates(assignOne, opState);

      const resultVar = prefix ? t.identifier(varName) : tempVar;
      return { start: loadState, end: opState, resultVar };
    } else if (t.isMemberExpression(arg.node)) {
      const objectInfo = this.process(arg.get("object"));
      let start = objectInfo.start;
      let lastStateId = objectInfo.end;

      let propertyResultVar;
      const isComputed = arg.node.computed;

      if (isComputed) {
        const propertyInfo = this.process(arg.get("property"));
        this.ir.linkStates(lastStateId, propertyInfo.start);
        lastStateId = propertyInfo.end;
        propertyResultVar = propertyInfo.resultVar;
      }

      const oldValue = this.ir.createTempVar();
      let readState;
      if (isComputed) {
        readState = this.ir.addState({
          type: "MEMBER_ACCESS_COMPUTED",
          to: oldValue.name,
          object: objectInfo.resultVar.name,
          property: propertyResultVar.name,
        });
      } else {
        readState = this.ir.addState({
          type: "MEMBER_ACCESS",
          to: oldValue.name,
          object: objectInfo.resultVar.name,
          property: arg.node.property.name,
        });
      }
      this.ir.linkStates(lastStateId, readState);
      lastStateId = readState;

      const newValue = this.ir.createTempVar();
      const one = this.ir.createTempVar();
      const assignOne = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: one.name,
        value: 1,
      });
      this.ir.linkStates(lastStateId, assignOne);

      const calcState = this.ir.addState({
        type: "BINARY",
        op: op,
        to: newValue.name,
        left: oldValue.name,
        right: one.name,
      });
      this.ir.linkStates(assignOne, calcState);
      lastStateId = calcState;

      let writeState;
      if (isComputed) {
        writeState = this.ir.addState({
          type: "MEMBER_ASSIGN_COMPUTED",
          object: objectInfo.resultVar.name,
          property: propertyResultVar.name,
          value: newValue.name,
        });
      } else {
        writeState = this.ir.addState({
          type: "MEMBER_ASSIGN",
          object: objectInfo.resultVar.name,
          property: arg.node.property.name,
          value: newValue.name,
        });
      }
      this.ir.linkStates(lastStateId, writeState);

      return {
        start: start,
        end: writeState,
        resultVar: prefix ? newValue : oldValue,
      };
    } else {
      throw new Error(
        "Update expressions are only supported on identifiers or member expressions.",
      );
    }
  }

  /**
   * Handles assignment expressions.
   * Includes complex logic for destructuring (arrays/objects) and compound assignments.
   */
  handleAssignmentExpression(path) {
    const left = path.get("left");
    const rightInfo = this.process(path.get("right"));
    let start = rightInfo.start;
    let end = rightInfo.end;

    // --- SUPPORT FOR DESTRUCTURING (ArrayPattern / ObjectPattern) ---
    if (left.isArrayPattern() || left.isObjectPattern()) {
      let lastState = end;

      const destructure = (patternPath, sourceVarName) => {
        if (patternPath.isArrayPattern()) {
          patternPath.get("elements").forEach((elemPath, index) => {
            if (!elemPath.hasNode()) return; // Sparse array
            if (elemPath.isRestElement()) return; // TODO: Support rest elements

            // 1. Extract value: temp = source[index]
            const tempVar = this.ir.createTempVar();
            const accessState = this.ir.addState({
              type: "MEMBER_ACCESS",
              to: tempVar.name,
              object: sourceVarName,
              property: String(index),
            });
            this.ir.linkStates(lastState, accessState);
            lastState = accessState;

            // 2. Recurse into element
            destructure(elemPath, tempVar.name);
          });
        } else if (patternPath.isObjectPattern()) {
          patternPath.get("properties").forEach((propPath) => {
            if (propPath.isRestElement()) return; // TODO: Support rest elements

            const tempVar = this.ir.createTempVar();
            let propKeyVar = null;
            let staticKey = null;

            // Compute Key
            if (propPath.node.computed) {
              const keyInfo = this.process(propPath.get("key"));
              this.ir.linkStates(lastState, keyInfo.start);
              lastState = keyInfo.end;
              propKeyVar = keyInfo.resultVar.name;
            } else {
              if (t.isIdentifier(propPath.node.key))
                staticKey = propPath.node.key.name;
              else if (t.isLiteral(propPath.node.key))
                staticKey = String(propPath.node.key.value);
            }

            // Access Property
            if (propKeyVar) {
              const accessState = this.ir.addState({
                type: "MEMBER_ACCESS_COMPUTED",
                to: tempVar.name,
                object: sourceVarName,
                property: propKeyVar,
              });
              this.ir.linkStates(lastState, accessState);
              lastState = accessState;
            } else {
              const accessState = this.ir.addState({
                type: "MEMBER_ACCESS",
                to: tempVar.name,
                object: sourceVarName,
                property: staticKey,
              });
              this.ir.linkStates(lastState, accessState);
              lastState = accessState;
            }

            // Recurse into value
            destructure(propPath.get("value"), tempVar.name);
          });
        } else if (patternPath.isIdentifier()) {
          const assignState = this.ir.addState({
            type: "ASSIGN",
            to: patternPath.node.name,
            from: sourceVarName,
          });
          this.ir.linkStates(lastState, assignState);
          lastState = assignState;
        } else if (patternPath.isMemberExpression()) {
          const objectInfo = this.process(patternPath.get("object"));
          this.ir.linkStates(lastState, objectInfo.start);
          lastState = objectInfo.end;

          if (patternPath.node.computed) {
            const propertyInfo = this.process(patternPath.get("property"));
            this.ir.linkStates(lastState, propertyInfo.start);
            lastState = propertyInfo.end;

            const assignState = this.ir.addState({
              type: "MEMBER_ASSIGN_COMPUTED",
              object: objectInfo.resultVar.name,
              property: propertyInfo.resultVar.name,
              value: sourceVarName,
            });
            this.ir.linkStates(lastState, assignState);
            lastState = assignState;
          } else {
            const assignState = this.ir.addState({
              type: "MEMBER_ASSIGN",
              object: objectInfo.resultVar.name,
              property: patternPath.node.property.name,
              value: sourceVarName,
            });
            this.ir.linkStates(lastState, assignState);
            lastState = assignState;
          }
        } else if (patternPath.isAssignmentPattern()) {
          // Treat as direct assignment (ignores default value logic for simplicity to avoid branching)
          destructure(patternPath.get("left"), sourceVarName);
        }
      };

      destructure(left, rightInfo.resultVar.name);
      return { start, end: lastState, resultVar: rightInfo.resultVar };
    }

    // --- STANDARD ASSIGNMENT ---
    if (t.isIdentifier(left.node)) {
      const varName = left.node.name;
      if (path.node.operator === "=") {
        const assignStateId = this.ir.addState({
          type: "ASSIGN",
          to: varName,
          from: rightInfo.resultVar.name,
        });
        this.ir.linkStates(end, assignStateId);
        return { start, end: assignStateId, resultVar: rightInfo.resultVar };
      } else {
        const op = path.node.operator.slice(0, -1);
        const assignStateId = this.ir.addState({
          type: "BINARY",
          op: op,
          to: varName,
          left: varName,
          right: rightInfo.resultVar.name,
        });
        this.ir.linkStates(end, assignStateId);
        return { start, end: assignStateId, resultVar: t.identifier(varName) };
      }
    } else if (t.isMemberExpression(left.node)) {
      const objectInfo = this.process(left.get("object"));
      this.ir.linkStates(end, objectInfo.start);
      end = objectInfo.end;

      if (path.node.operator === "=") {
        if (left.node.computed) {
          const propertyInfo = this.process(left.get("property"));
          this.ir.linkStates(end, propertyInfo.start);
          end = propertyInfo.end;
          const assignStateId = this.ir.addState({
            type: "MEMBER_ASSIGN_COMPUTED",
            object: objectInfo.resultVar.name,
            property: propertyInfo.resultVar.name,
            value: rightInfo.resultVar.name,
          });
          this.ir.linkStates(end, assignStateId);
          return { start, end: assignStateId, resultVar: rightInfo.resultVar };
        } else {
          const propName = left.node.property.name;
          const assignStateId = this.ir.addState({
            type: "MEMBER_ASSIGN",
            object: objectInfo.resultVar.name,
            property: propName,
            value: rightInfo.resultVar.name,
          });
          this.ir.linkStates(end, assignStateId);
          return { start, end: assignStateId, resultVar: rightInfo.resultVar };
        }
      } else {
        // --- FIXED: Handle Compound Assignments for Members (+=, -=, etc.) ---
        const op = path.node.operator.slice(0, -1);
        const oldValue = this.ir.createTempVar();
        const newValue = this.ir.createTempVar();
        let propertyResultVar;

        if (left.node.computed) {
          const propertyInfo = this.process(left.get("property"));
          this.ir.linkStates(end, propertyInfo.start);
          end = propertyInfo.end;
          propertyResultVar = propertyInfo.resultVar;

          const readState = this.ir.addState({
            type: "MEMBER_ACCESS_COMPUTED",
            to: oldValue.name,
            object: objectInfo.resultVar.name,
            property: propertyResultVar.name,
          });
          this.ir.linkStates(end, readState);
          end = readState;
        } else {
          const readState = this.ir.addState({
            type: "MEMBER_ACCESS",
            to: oldValue.name,
            object: objectInfo.resultVar.name,
            property: left.node.property.name,
          });
          this.ir.linkStates(end, readState);
          end = readState;
        }

        const calcState = this.ir.addState({
          type: "BINARY",
          op: op,
          to: newValue.name,
          left: oldValue.name,
          right: rightInfo.resultVar.name,
        });
        this.ir.linkStates(end, calcState);
        end = calcState;

        if (left.node.computed) {
          const writeState = this.ir.addState({
            type: "MEMBER_ASSIGN_COMPUTED",
            object: objectInfo.resultVar.name,
            property: propertyResultVar.name,
            value: newValue.name,
          });
          this.ir.linkStates(end, writeState);
          return { start, end: writeState, resultVar: newValue };
        } else {
          const writeState = this.ir.addState({
            type: "MEMBER_ASSIGN",
            object: objectInfo.resultVar.name,
            property: left.node.property.name,
            value: newValue.name,
          });
          this.ir.linkStates(end, writeState);
          return { start, end: writeState, resultVar: newValue };
        }
      }
    } else {
      throw new Error(`Unsupported assignment target type: ${left.type}`);
    }
  }

  /**
   * Handles unary expressions (e.g., !, typeof, -, +).
   */
  handleUnaryExpression(path) {
    const argumentInfo = this.process(path.get("argument"));
    const tempVar = this.ir.createTempVar();
    const opStateId = this.ir.addState({
      type: "UNARY",
      op: path.node.operator,
      to: tempVar.name,
      argument: argumentInfo.resultVar.name,
    });
    this.ir.linkStates(argumentInfo.end, opStateId);
    return { start: argumentInfo.start, end: opStateId, resultVar: tempVar };
  }

  /**
   * Handles logical expressions (&&, ||).
   * Implements short-circuit evaluation using conditional jumps.
   */
  handleLogicalExpression(path) {
    const resultVar = this.ir.createTempVar();
    const leftInfo = this.process(path.get("left"));
    const rightInfo = this.process(path.get("right"));
    const endStateId = this.ir.addState({ type: "NOOP" });
    const assignLeftStateId = this.ir.addState({
      type: "ASSIGN",
      to: resultVar.name,
      from: leftInfo.resultVar.name,
    });
    this.ir.linkStates(assignLeftStateId, endStateId);
    const assignRightStateId = this.ir.addState({
      type: "ASSIGN",
      to: resultVar.name,
      from: rightInfo.resultVar.name,
    });
    this.ir.linkStates(rightInfo.end, assignRightStateId);
    this.ir.linkStates(assignRightStateId, endStateId);
    let trueState, falseState;
    if (path.node.operator === "&&") {
      trueState = rightInfo.start;
      falseState = assignLeftStateId;
    } else {
      trueState = assignLeftStateId;
      falseState = rightInfo.start;
    }
    const jumpStateId = this.ir.addState({
      type: "COND_JUMP",
      testVar: leftInfo.resultVar.name,
      trueState,
      falseState,
    });
    this.ir.linkStates(leftInfo.end, jumpStateId);
    return { start: leftInfo.start, end: endStateId, resultVar };
  }

  /**
   * Handles array literals.
   * Processes elements sequentially and then triggers an array creation state.
   */
  handleArrayExpression(path) {
    const elementInfos = path.get("elements").map((el) => {
      if (!el.node) return null;
      return this.process(el);
    });

    let start = null,
    end = null;

    const validInfos = elementInfos.filter((i) => i);

    if (validInfos.length > 0) {
      start = validInfos[0].start;
      end = validInfos[0].end;
      for (let i = 1; i < validInfos.length; i++) {
        this.ir.linkStates(end, validInfos[i].start);
        end = validInfos[i].end;
      }
    } else {
      start = end = this.ir.addState({ type: "NOOP" });
    }

    const tempVar = this.ir.createTempVar();

    const elements = elementInfos.map((info) => {
      if (!info) return null;
      if (info.isSpread) return { spreadVar: info.resultVar.name };
      return info.resultVar.name;
    });

    const createStateId = this.ir.addState({
      type: "CREATE_ARRAY",
      to: tempVar.name,
      elements: elements,
    });
    this.ir.linkStates(end, createStateId);
    return { start, end: createStateId, resultVar: tempVar };
  }

  /**
   * Handles object literals.
   * separates simple properties (assigned during creation) and complex properties
   * (getters/setters, defined via Object.defineProperty).
   */
  handleObjectExpression(path) {
    const simpleProperties = [];
    const complexProperties = []; // getters/setters
    let start = null;
    let end = null;

    const link = (newStart, newEnd) => {
      if (!start) start = newStart;
      if (end) this.ir.linkStates(end, newStart);
      end = newEnd;
    };

    for (const propPath of path.get("properties")) {
      if (propPath.isSpreadElement()) {
        const argInfo = this.process(propPath.get("argument"));
        link(argInfo.start, argInfo.end);
        simpleProperties.push({ spreadVar: argInfo.resultVar.name });
        continue;
      }

      const kind = propPath.node.kind || "init"; // 'init', 'get', 'set', 'method'

      // 1. Process Key
      let keyInfo;
      let computedKeyVar = null;
      let staticKeyName = null;

      if (propPath.node.computed) {
        keyInfo = this.process(propPath.get("key"));
      } else {
        let keyVal;
        if (t.isIdentifier(propPath.node.key)) keyVal = propPath.node.key.name;
        else if (t.isLiteral(propPath.node.key))
          keyVal = String(propPath.node.key.value);
        else keyVal = "unknown";

        staticKeyName = keyVal;

        const fakePath = {
          node: t.stringLiteral(keyVal),
          isTemplateElement: () => false,
          isStringLiteral: () => true,
        };
        keyInfo = this.handleStringLiteral(fakePath);
      }

      link(keyInfo.start, keyInfo.end);
      computedKeyVar = keyInfo.resultVar.name;

      // 2. Process Value
      let valueResultVar;

      if (propPath.isObjectMethod()) {
        const funcNode = t.functionExpression(
          null,
          propPath.node.params,
          propPath.node.body,
          propPath.node.generator,
          propPath.node.async,
        );
        const tempVar = this.ir.createTempVar();
        const funcStateId = this.ir.addState({
          type: "ASSIGN_LITERAL_DIRECT",
          to: tempVar.name,
          value: funcNode,
        });
        link(funcStateId, funcStateId);
        valueResultVar = tempVar.name;
      } else {
        const valInfo = this.process(propPath.get("value"));
        link(valInfo.start, valInfo.end);
        valueResultVar = valInfo.resultVar.name;
      }

      if (kind === "get" || kind === "set") {
        complexProperties.push({
          kind,
          keyVar: computedKeyVar,
          valueVar: valueResultVar,
        });
      } else {
        simpleProperties.push({
          key: staticKeyName,
          keyVar: computedKeyVar,
          valueVar: valueResultVar,
          computed: true,
        });
      }
    }

    if (!start) {
      start = end = this.ir.addState({ type: "NOOP" });
    }

    // 3. Create Base Object
    const objVar = this.ir.createTempVar();
    const createObjState = this.ir.addState({
      type: "CREATE_OBJECT",
      to: objVar.name,
      properties: simpleProperties,
    });
    link(createObjState, createObjState);

    // 4. Define Complex Properties (Getters/Setters) via Object.defineProperty
    for (const prop of complexProperties) {
      const descVar = this.ir.createTempVar();
      const trueVar = this.ir.createTempVar();
      const trueAssign = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: trueVar.name,
        value: true,
      });
      link(trueAssign, trueAssign);

      const getStrVar = (str) => {
        const fp = {
          node: t.stringLiteral(str),
          isTemplateElement: () => false,
          isStringLiteral: () => true,
        };
        const ret = this.handleStringLiteral(fp);
        link(ret.start, ret.end);
        return ret.resultVar.name;
      };

      const kindKeyVar = getStrVar(prop.kind);
      const confKeyVar = getStrVar("configurable");
      const enumKeyVar = getStrVar("enumerable");

      const descProps = [
        { keyVar: kindKeyVar, valueVar: prop.valueVar, computed: true },
        { keyVar: confKeyVar, valueVar: trueVar.name, computed: true },
        { keyVar: enumKeyVar, valueVar: trueVar.name, computed: true },
      ];

      const createDescState = this.ir.addState({
        type: "CREATE_OBJECT",
        to: descVar.name,
        properties: descProps,
      });
      link(createDescState, createDescState);

      const defPropResult = this.ir.createTempVar();
      const callState = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: defPropResult.name,
        callee: {
          member_access_global: {
            object: "Object",
            property: "defineProperty",
          },
        },
        args: [objVar.name, prop.keyVar, descVar.name],
      });
      link(callState, callState);
    }

    return { start, end, resultVar: objVar };
  }

  /**
   * Handles template literals.
   * Converts them into a series of string concatenations.
   */
  handleTemplateLiteral(path) {
    if (path.node.expressions.length === 0) {
      return this.handleStringLiteral(path.get("quasis")[0]);
    }
    const parts = [];
    for (let i = 0; i < path.node.quasis.length; i++) {
      const quasi = path.get("quasis")[i];
      if (quasi.node.value.raw) {
        parts.push(quasi);
      }
      if (path.node.expressions[i]) {
        parts.push(path.get("expressions")[i]);
      }
    }
    let lastInfo = this.process(parts[0]);
    let overallStart = lastInfo.start;
    for (let i = 1; i < parts.length; i++) {
      const partInfo = this.process(parts[i]);
      this.ir.linkStates(lastInfo.end, partInfo.start);
      const tempVar = this.ir.createTempVar();
      const addStateId = this.ir.addState({
        type: "BINARY",
        op: "+",
        to: tempVar.name,
        left: lastInfo.resultVar.name,
        right: partInfo.resultVar.name,
      });
      this.ir.linkStates(partInfo.end, addStateId);
      lastInfo = { start: overallStart, end: addStateId, resultVar: tempVar };
    }
    return lastInfo;
  }

  /**
   * Handles string literals.
   * Integrates with the string concealer to encrypt strings and generate
   * runtime decryption calls.
   */
  handleStringLiteral(path) {
    // FIX: Use 'cooked' to handle escape sequences correctly
    const str = path.isTemplateElement()
    ? path.node.value.cooked
    : path.node.value;

    const stringId = this.ir.stringCollector.getStringId(str);
    const tempVarId = this.ir.createTempVar();
    const resultVar = this.ir.createTempVar();

    const assignIdState = this.ir.addState({
      type: "ASSIGN_LITERAL",
      to: tempVarId.name,
      value: stringId,
    });

    const accessState = this.ir.addState({
      type: "MEMBER_ACCESS_COMPUTED",
      to: resultVar.name,
      object: this.ir.stringCollector.arrayVariableName,
      property: tempVarId.name,
    });

    this.ir.linkStates(assignIdState, accessState);

    if (!this.ir.noEncryption) {
      const decodedResultVar = this.ir.createTempVar();
      const decoderCallState = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: decodedResultVar.name,
        callee: this.ir.stringConcealer.decoderFunctionName,
        thisObject: null,
        args: [resultVar.name],
      });
      this.ir.linkStates(accessState, decoderCallState);
      return {
        start: assignIdState,
        end: decoderCallState,
        resultVar: decodedResultVar,
      };
    }

    return {
      start: assignIdState,
      end: accessState,
      resultVar: resultVar,
    };
  }

  /**
   * Handles primitive literals (number, boolean, null).
   */
  handleSimpleLiteral(path) {
    const tempVar = this.ir.createTempVar();
    const value = path.node.hasOwnProperty("value") ? path.node.value : null;
    const stateId = this.ir.addState({
      type: "ASSIGN_LITERAL",
      to: tempVar.name,
      value: value,
    });
    return { start: stateId, end: stateId, resultVar: tempVar };
  }

  /**
   * Handles binary expressions (e.g., +, -, *, /).
   */
  handleBinaryExpression(path) {
    const leftInfo = this.process(path.get("left"));
    const rightInfo = this.process(path.get("right"));
    const tempVar = this.ir.createTempVar();
    const opStateId = this.ir.addState({
      type: "BINARY",
      op: path.node.operator,
      to: tempVar.name,
      left: leftInfo.resultVar.name,
      right: rightInfo.resultVar.name,
    });
    this.ir.linkStates(leftInfo.end, rightInfo.start);
    this.ir.linkStates(rightInfo.end, opStateId);
    return { start: leftInfo.start, end: opStateId, resultVar: tempVar };
  }

  /**
   * Handles member access (e.g., obj.prop or obj[prop]).
   */
  handleMemberExpression(path) {
    if (
      t.isIdentifier(path.get("object").node, { name: "Symbol" }) &&
      t.isIdentifier(path.get("property").node, { name: "iterator" })
    ) {
      const tempVar = this.ir.createTempVar();
      const stateId = this.ir.addState({
        type: "ASSIGN_LITERAL_DIRECT",
        to: tempVar.name,
        value: t.memberExpression(
          t.identifier("Symbol"),
                                  t.identifier("iterator"),
        ),
      });
      return { start: stateId, end: stateId, resultVar: tempVar };
    }

    if (path.node.computed) {
      const objectInfo = this.process(path.get("object"));
      const propertyInfo = this.process(path.get("property"));
      this.ir.linkStates(objectInfo.end, propertyInfo.start);
      const tempVar = this.ir.createTempVar();
      const stateId = this.ir.addState({
        type: "MEMBER_ACCESS_COMPUTED",
        to: tempVar.name,
        object: objectInfo.resultVar.name,
        property: propertyInfo.resultVar.name,
      });
      this.ir.linkStates(propertyInfo.end, stateId);
      return { start: objectInfo.start, end: stateId, resultVar: tempVar };
    } else {
      const objectInfo = this.process(path.get("object"));
      const tempVar = this.ir.createTempVar();
      const stateId = this.ir.addState({
        type: "MEMBER_ACCESS",
        to: tempVar.name,
        object: objectInfo.resultVar.name,
        property: path.node.property.name,
      });
      this.ir.linkStates(objectInfo.end, stateId);
      return { start: objectInfo.start, end: stateId, resultVar: tempVar };
    }
  }

  /**
   * Handles Immediately Invoked Function Expressions (IIFE).
   * Manually captures the closure scope and rewrites the call.
   */
  handleIIFE(path, calleePath) {
    const funcName = `_iife_${this.ir.stateCounter}`;
    const startStateId = this.ir.addState({
      type: "FUNC_ENTRY",
      name: funcName,
      isAsync: calleePath.node.async,
    });
    this.ir.functionStartStates.set(funcName, startStateId);

    const capturedSet = new Set();
    const self = this;

    // --- SCOPE FIX ---
    // Use the scope surrounding the CallExpression, NOT the function's own scope.
    // The function's own scope (calleePath.scope) treats all its local variables as "bindings",
    // causing us to think they are captured from outside if we use it as parentScope.
    const parentScope = path.scope;

    calleePath.traverse({
      Identifier(p) {
        if (!p.isReferenced()) return;

        const name = p.node.name;
        if (!self.ir.memoryMap.has(name)) return;
        const memIdx = self.ir.memoryMap.get(name);
        if (self.ir.globalIds.has(memIdx)) return;

        if (parentScope.hasBinding(name)) {
          const parentBinding = parentScope.getBinding(name);
          const localBinding = p.scope.getBinding(name);

          if (parentBinding === localBinding) {
            capturedSet.add(name);
          }
        }
      },
      ThisExpression(p) {
        if (t.isArrowFunctionExpression(calleePath.node)) {
          if (self.ir.memoryMap.has("_THIS")) {
            capturedSet.add("_THIS");
          }
        }
      },
    });

    const capturedVars = Array.from(capturedSet).sort();

    const oldContext = this.ir.functionContext;
    this.ir.functionContext = {
      name: funcName,
      tempVars: new Set(),
      isAsync: calleePath.node.async,
    };

    let bodyPath = calleePath.get("body");
    let bodyResult;

    if (bodyPath.isBlockStatement()) {
      bodyResult = this.ir.processBlock(bodyPath);
    } else {
      const exprResult = this.ir.processExpression(bodyPath);
      const returnStateId = this.ir.addState({
        type: "RETURN",
        valueVar: exprResult.resultVar.name,
        funcName: funcName,
      });
      this.ir.linkStates(exprResult.end, returnStateId);
      bodyResult = { start: exprResult.start, end: returnStateId };
    }

    this.ir.linkStates(startStateId, bodyResult.start);

    const endState = this.ir.getState(bodyResult.end);
    if (
      endState &&
      !["RETURN", "THROW", "HALT", "FINALLY_DISPATCH"].includes(
        endState.op.type,
      )
    ) {
      const tempUndef = this.ir.createTempVar();
      const assignUndef = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: tempUndef.name,
        value: undefined,
      });
      const implicitRet = this.ir.addState({
        type: "RETURN",
        valueVar: tempUndef.name,
        funcName: funcName,
      });
      this.ir.linkStates(bodyResult.end, assignUndef);
      this.ir.linkStates(assignUndef, implicitRet);
    }

    const entryState = this.ir.getState(startStateId);
    entryState.op.tempVars = Array.from(this.ir.functionContext.tempVars);

    const capturedParams = capturedVars.map((name) => t.identifier(name));
    entryState.op.params = [...calleePath.node.params, ...capturedParams];

    entryState.op.isGenerator = calleePath.node.generator;
    entryState.op.isAsync = calleePath.node.async;

    this.ir.functionContext = oldContext;

    const resultVar = this.ir.createTempVar();
    const argInfos = path.get("arguments").map((p) => this.process(p));

    let lastLink = null,
    overallStart = null;
    if (argInfos.length > 0) {
      overallStart = argInfos[0].start;
      lastLink = argInfos[0].end;
      for (let i = 1; i < argInfos.length; i++) {
        this.ir.linkStates(lastLink, argInfos[i].start);
        lastLink = argInfos[i].end;
      }
    } else {
      const noop = this.ir.addState({ type: "NOOP" });
      overallStart = lastLink = noop;
    }

    const mappedArgs = this._getArgList(argInfos);
    const finalArgs = [...mappedArgs, ...capturedVars];

    const callStateId = this.ir.addState({
      type: "CALL",
      callee: funcName,
      args: finalArgs,
      callerFuncName: this.ir.functionContext
      ? this.ir.functionContext.name
      : null,
    });

    this.ir.linkStates(lastLink, callStateId);

    const postCall = this.ir.addState({
      type: "POST_CALL",
      callerFuncName: this.ir.functionContext
      ? this.ir.functionContext.name
      : null,
    });
    this.ir.getState(callStateId).next = postCall;

    const retrieve = this.ir.addState({
      type: "RETRIEVE_RESULT",
      to: resultVar.name,
    });
    this.ir.linkStates(postCall, retrieve);

    return { start: overallStart, end: retrieve, resultVar };
  }

  /**
   * Handles Call Expressions.
   * Supports standard calls, method calls, IIFEs, and dynamic imports.
   */
  handleCallExpression(path) {
    const resultVar = this.ir.createTempVar();
    const calleePath = path.get("callee");

    // Handle dynamic import()
    if (calleePath.isImport()) {
      const argInfos = path
      .get("arguments")
      .map((argPath) => this.process(argPath));
      let lastLink = null,
      overallStart = null;

      if (argInfos.length > 0) {
        overallStart = argInfos[0].start;
        lastLink = argInfos[0].end;
        for (let i = 1; i < argInfos.length; i++) {
          this.ir.linkStates(lastLink, argInfos[i].start);
          lastLink = argInfos[i].end;
        }
      } else {
        const noopState = this.ir.addState({ type: "NOOP" });
        overallStart = lastLink = noopState;
      }

      const finalArgs = this._getArgList(argInfos);

      const callStateId = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: resultVar.name,
        callee: "import", // Special marker for Import node
        args: finalArgs,
      });
      this.ir.linkStates(lastLink, callStateId);

      return { start: overallStart, end: callStateId, resultVar: resultVar };
    }

    if (
      t.isFunctionExpression(calleePath.node) ||
      t.isArrowFunctionExpression(calleePath.node)
    ) {
      return this.handleIIFE(path, calleePath);
    }

    const argInfos = path
    .get("arguments")
    .map((argPath) => this.process(argPath));
    let lastLink = null,
    overallStart = null;

    if (argInfos.length > 0) {
      overallStart = argInfos[0].start;
      lastLink = argInfos[0].end;
      for (let i = 1; i < argInfos.length; i++) {
        this.ir.linkStates(lastLink, argInfos[i].start);
        lastLink = argInfos[i].end;
      }
    } else {
      const noopState = this.ir.addState({ type: "NOOP" });
      overallStart = lastLink = noopState;
    }

    const finalArgs = this._getArgList(argInfos);

    if (calleePath.isMemberExpression() && !calleePath.node.computed) {
      const objectInfo = this.process(calleePath.get("object"));

      this.ir.linkStates(lastLink, objectInfo.start);
      lastLink = objectInfo.end;
      if (!overallStart) overallStart = objectInfo.start;

      const methodName = calleePath.node.property.name;
      const callStateId = this.ir.addState({
        type: "METHOD_CALL",
        to: resultVar.name,
        instance: objectInfo.resultVar.name,
        method: methodName,
        args: finalArgs,
      });
      this.ir.linkStates(lastLink, callStateId);

      if (["next", "throw", "return"].includes(methodName)) {
        const awaitResultVar = this.ir.createTempVar();
        const awaitStateId = this.ir.addState({
          type: "AWAIT",
          promiseVar: resultVar.name,
          to: awaitResultVar.name,
        });
        this.ir.linkStates(callStateId, awaitStateId);
        return {
          start: overallStart,
          end: awaitStateId,
          resultVar: awaitResultVar,
        };
      }

      return { start: overallStart, end: callStateId, resultVar: resultVar };
    }

    if (
      t.isIdentifier(path.node.callee) &&
      this.ir.functionStartStates.has(path.node.callee.name)
    ) {
      const calleeName = path.node.callee.name;
      const callStateId = this.ir.addState({
        type: "CALL",
        callee: calleeName,
        args: finalArgs,
        callerFuncName: this.ir.functionContext
        ? this.ir.functionContext.name
        : null,
      });
      this.ir.linkStates(lastLink, callStateId);
      const postCallStateId = this.ir.addState({
        type: "POST_CALL",
        callerFuncName: this.ir.functionContext
        ? this.ir.functionContext.name
        : null,
      });
      this.ir.getState(callStateId).next = postCallStateId;
      const retrieveStateId = this.ir.addState({
        type: "RETRIEVE_RESULT",
        to: resultVar.name,
      });
      this.ir.linkStates(postCallStateId, retrieveStateId);
      return {
        start: overallStart,
        end: retrieveStateId,
        resultVar: resultVar,
      };
    } else {
      const calleeInfo = this.process(calleePath);
      this.ir.linkStates(lastLink, calleeInfo.start);
      lastLink = calleeInfo.end;
      if (!overallStart) overallStart = calleeInfo.start;

      let thisObjectVarName = null;
      if (calleePath.isMemberExpression()) {
        const thisObjectInfo = this.process(calleePath.get("object"));
        thisObjectVarName = thisObjectInfo.resultVar.name;
        this.ir.linkStates(lastLink, thisObjectInfo.start);
        lastLink = thisObjectInfo.end;
      }

      const callStateId = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: resultVar.name,
        callee: calleeInfo.resultVar.name,
        thisObject: thisObjectVarName,
        args: finalArgs,
      });
      this.ir.linkStates(lastLink, callStateId);
      return { start: overallStart, end: callStateId, resultVar: resultVar };
    }
  }

  /**
   * Handles New Expressions (constructor calls).
   */
  handleNewExpression(path) {
    const resultVar = this.ir.createTempVar();
    const calleePath = path.get("callee");
    const argInfos = path
    .get("arguments")
    .map((argPath) => this.process(argPath));
    let lastLink = null,
    overallStart = null;

    if (argInfos.length > 0) {
      overallStart = argInfos[0].start;
      lastLink = argInfos[0].end;
      for (let i = 1; i < argInfos.length; i++) {
        this.ir.linkStates(lastLink, argInfos[i].start);
        lastLink = argInfos[i].end;
      }
    } else {
      const noopState = this.ir.addState({ type: "NOOP" });
      overallStart = lastLink = noopState;
    }

    const finalArgs = this._getArgList(argInfos);

    if (
      t.isIdentifier(calleePath.node) &&
      this.ir.memoryMap.has(calleePath.node.name)
    ) {
      const newStateId = this.ir.addState({
        type: "NEW_INSTANCE",
        to: resultVar.name,
        className: calleePath.node.name,
        args: finalArgs,
      });
      this.ir.linkStates(lastLink, newStateId);
      return { start: overallStart, end: newStateId, resultVar: resultVar };
    } else {
      const calleeInfo = this.process(calleePath);
      this.ir.linkStates(lastLink, calleeInfo.start);
      if (!overallStart) overallStart = calleeInfo.start;

      const newStateId = this.ir.addState({
        type: "NEW_EXTERNAL_INSTANCE",
        to: resultVar.name,
        callee: calleeInfo.resultVar.name,
        args: finalArgs,
      });
      this.ir.linkStates(calleeInfo.end, newStateId);
      return { start: overallStart, end: newStateId, resultVar: resultVar };
    }
  }
}

module.exports = ExpressionHandler;
