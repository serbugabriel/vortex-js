/**
 * @file base-dispatcher.js
 * @description Abstract base class for all instruction dispatchers.
 * A dispatcher is responsible for converting the flat list of IR states into
 * the actual JavaScript control flow structures (Switch, BST, etc.) inside the VM loop.
 * It also handles the generation of standard OpCodes (Arithmetic, Memory, Calls).
 */

const t = require("@babel/types");
const traverse = require("@babel/traverse").default;

/**
 * Base class providing shared logic for instruction generation.
 */
class BaseDispatcher {
  /**
   * @param {Object} astGenerator - The main AST Generator instance.
   */
  constructor(astGenerator) {
    this.astGen = astGenerator;
  }

  /**
   * Generates the dispatcher logic structure. Must be implemented by subclasses.
   * @param {Object} vmContext - Variables available in the VM scope (M, S, VM, etc.).
   */
  generate(vmContext) {
    throw new Error(
      "BaseDispatcher.generate() must be implemented by subclass",
    );
  }

  // --- Helpers to access ASTGenerator state ---
  _getMappedId(id) {
    return this.astGen._getMappedId(id);
  }
  _createNumericLiteralOrFail(val, ctx) {
    return this.astGen._createNumericLiteralOrFail(val, ctx);
  }
  _getMemOrFail(name, ctx) {
    return this.astGen._getMemOrFail(name, ctx);
  }
  _getFuncStateOrFail(name, ctx) {
    return this.astGen._getFuncStateOrFail(name, ctx);
  }
  _createStringAccess(str) {
    return this.astGen._createStringAccess(str);
  }

  /**
   * Generates AST nodes for a specific IR Operation.
   * This is the core instruction set architecture of the Vortex VM.
   *
   * @param {Object} op - The IR operation object.
   * @param {Object} helpers - Context helpers (registers, helper functions).
   * @returns {Array} Array of Babel AST statements.
   */
  generateOpCode(op, helpers) {
    const {
      M,
      GlobalM,
      Ctx,
      VM,
      VS,
      S,
      SP_IDX,
      EHP_IDX,
      STACK_AREA_START,
      totalMemorySize,
      _RET_IDX,
      nextMapped,
      resolveArgs,
      assign,
      mem,
      num,
    } = helpers;
    let statements = [];

    switch (op.type) {
      case "SEQUENCE":
        op.ops.forEach((subOp) => {
          statements.push(...this.generateOpCode(subOp, helpers));
        });
        break;

      case "ASSIGN_LITERAL_DIRECT": {
        // Special case: Literal is a complex object (like a wrapper function)
        // We traverse it to ensure recursive obfuscation of state IDs
        const valueNode =
          op.value && typeof op.value === "object" && op.value.type
            ? op.value
            : t.valueToNode(op.value);
        if (
          this.astGen.stateRandomization &&
          valueNode &&
          typeof valueNode === "object"
        ) {
          const self = this;
          traverse(t.file(t.program([t.expressionStatement(valueNode)])), {
            CallExpression(path) {
              if (
                t.isIdentifier(path.node.callee) &&
                path.node.callee.name === VM.name
              ) {
                const firstArg = path.node.arguments[0];
                if (t.isNumericLiteral(firstArg)) {
                  const rawId = firstArg.value;
                  const mapped = self._getMappedId(rawId);
                  path.node.arguments[0] = self._createNumericLiteralOrFail(
                    mapped,
                    "nested wrapper call",
                  );
                }
              }
            },
            noScope: true,
          });
        }
        statements.push(assign(mem(op.to, "dest"), valueNode));
        break;
      }
      case "CALL": {
        // Handle function calls within the VM
        const targetStateId = this._getFuncStateOrFail(op.callee, "jump");
        const mappedTargetId = this._getMappedId(targetStateId);
        const targetState = this.astGen.states[targetStateId];
        const argsList = resolveArgs(op.args);

        const isStandardInternal =
          !targetState.op.isGenerator && !targetState.op.isAsync;

        if (isStandardInternal) {
          // Standard VM Call: Push stack frame and jump
          // SAFETY: If nextMapped is null (tail of function), we cannot push a return address.
          const returnAddr =
            nextMapped !== null
              ? num(nextMapped, "return addr")
              : t.numericLiteral(-1);

          statements.push(
            t.expressionStatement(
              t.callExpression(t.memberExpression(VS, t.identifier("push")), [
                t.objectExpression([
                  t.objectProperty(t.identifier("S"), returnAddr),
                  t.objectProperty(t.identifier("M"), M),
                ]),
              ]),
            ),
          );
          statements.push(
            assign(
              t.memberExpression(Ctx, t.identifier("A")),
              t.arrayExpression(argsList),
            ),
          );
          // Allocate new memory frame
          statements.push(
            assign(
              M,
              t.callExpression(
                t.memberExpression(GlobalM, t.identifier("slice")),
                [],
              ),
            ),
          );
          statements.push(
            assign(
              t.memberExpression(M, t.numericLiteral(SP_IDX), true),
              t.numericLiteral(totalMemorySize),
            ),
          );
          statements.push(
            assign(
              t.memberExpression(M, t.numericLiteral(EHP_IDX), true),
              t.numericLiteral(STACK_AREA_START),
            ),
          );
          statements.push(assign(S, num(mappedTargetId, "call target")));
          statements.push(t.continueStatement());
        } else if (targetState.op.isGenerator) {
          // Generator Call: Delegate to generator wrapper
          if (
            this.astGen.memoryMap.has(op.callee) &&
            this.astGen.globalIds.has(this.astGen.memoryMap.get(op.callee))
          ) {
            const callee = mem(op.callee, "callee");
            statements.push(
              assign(
                t.memberExpression(M, t.numericLiteral(_RET_IDX), true),
                t.callExpression(callee, argsList),
              ),
            );
          } else {
            let callExpr = t.callExpression(VM, [
              num(mappedTargetId, "call target"),
              t.arrayExpression(argsList),
            ]);
            if (targetState.op.isAsync) callExpr = t.awaitExpression(callExpr);
            const awaitCall = t.memberExpression(callExpr, t.identifier("v"));
            statements.push(
              assign(
                t.memberExpression(M, t.numericLiteral(_RET_IDX), true),
                awaitCall,
              ),
            );
          }
        } else if (targetState.op.isAsync) {
          // Async Call: Wrap result in Promise
          const vmCall = t.callExpression(VM, [
            num(mappedTargetId, "call target"),
            t.arrayExpression(argsList),
          ]);
          const promiseWrap = t.callExpression(
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
            [
              t.arrowFunctionExpression(
                [t.identifier("r")],
                t.memberExpression(t.identifier("r"), t.identifier("v")),
              ),
            ],
          );
          statements.push(
            assign(
              t.memberExpression(M, t.numericLiteral(_RET_IDX), true),
              promiseWrap,
            ),
          );
        } else {
          // Fallback
          let callExpr = t.callExpression(VM, [
            num(mappedTargetId, "call target"),
            t.arrayExpression(argsList),
          ]);
          const result = t.memberExpression(callExpr, t.identifier("v"));
          statements.push(
            assign(
              t.memberExpression(M, t.numericLiteral(_RET_IDX), true),
              result,
            ),
          );
        }
        break;
      }
      case "RETURN":
        // Pop stack frame and restore state
        statements.push(
          t.ifStatement(
            t.binaryExpression(
              ">",
              t.memberExpression(VS, t.identifier("length")),
              t.numericLiteral(0),
            ),
            t.blockStatement([
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.identifier("retVal"),
                  mem(op.valueVar, "ret val"),
                ),
              ]),
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.identifier("frame"),
                  t.callExpression(
                    t.memberExpression(VS, t.identifier("pop")),
                    [],
                  ),
                ),
              ]),
              assign(
                S,
                t.memberExpression(t.identifier("frame"), t.identifier("S")),
              ),
              assign(
                M,
                t.memberExpression(t.identifier("frame"), t.identifier("M")),
              ),
              assign(
                t.memberExpression(M, t.numericLiteral(_RET_IDX), true),
                t.identifier("retVal"),
              ),
              t.continueStatement(),
            ]),
            t.returnStatement(
              t.objectExpression([
                t.objectProperty(t.identifier("_"), t.numericLiteral(1)),
                t.objectProperty(
                  t.identifier("v"),
                  mem(op.valueVar, "ret val"),
                ),
              ]),
            ),
          ),
        );
        break;
      case "FUNC_ENTRY":
        // Argument Unpacking (Destructuring params from 'A' register)
        if (op.params && op.params.length > 0) {
          const unpackStmts = [];
          const source = t.memberExpression(Ctx, t.identifier("A"));
          const unpack = (pattern, sourceExpr) => {
            if (t.isIdentifier(pattern)) {
              if (this.astGen.memoryMap.has(pattern.name)) {
                unpackStmts.push(
                  assign(mem(pattern.name, "param"), sourceExpr),
                );
              }
            } else if (t.isAssignmentPattern(pattern)) {
              if (t.isIdentifier(pattern.left)) {
                const val = t.conditionalExpression(
                  t.binaryExpression(
                    "!==",
                    sourceExpr,
                    t.identifier("undefined"),
                  ),
                  sourceExpr,
                  pattern.right,
                );
                if (this.astGen.memoryMap.has(pattern.left.name)) {
                  unpackStmts.push(
                    assign(mem(pattern.left.name, "param default"), val),
                  );
                }
              }
            } else if (t.isArrayPattern(pattern)) {
              pattern.elements.forEach((elem, idx) => {
                if (!elem) return;
                const elemSource = t.memberExpression(
                  sourceExpr,
                  t.numericLiteral(idx),
                  true,
                );
                unpack(elem, elemSource);
              });
            } else if (t.isObjectPattern(pattern)) {
              pattern.properties.forEach((prop) => {
                if (t.isObjectProperty(prop)) {
                  const propKey = prop.key;
                  const propSource = t.memberExpression(
                    sourceExpr,
                    propKey,
                    prop.computed,
                  );
                  unpack(prop.value, propSource);
                }
              });
            }
          };
          op.params.forEach((param, i) => {
            if (t.isRestElement(param)) {
              const sliceExpr = t.callExpression(
                t.memberExpression(source, t.identifier("slice")),
                [t.numericLiteral(i)],
              );
              unpack(param.argument, sliceExpr);
            } else {
              const sourceArg = t.memberExpression(
                source,
                t.numericLiteral(i),
                true,
              );
              unpack(param, sourceArg);
            }
          });
          if (unpackStmts.length > 0) {
            statements.push(
              t.ifStatement(
                t.binaryExpression("!==", source, t.identifier("undefined")),
                t.blockStatement([
                  ...unpackStmts,
                  t.expressionStatement(
                    t.assignmentExpression(
                      "=",
                      source,
                      t.identifier("undefined"),
                    ),
                  ),
                ]),
              ),
            );
          }
        }
        break;
      case "YIELD": {
        statements.push(
          assign(
            t.memberExpression(Ctx, t.identifier("S")),
            num(nextMapped, "next state"),
          ),
        );
        statements.push(
          assign(
            t.memberExpression(Ctx, t.identifier("T")),
            t.numericLiteral(this._getMemOrFail(op.to, "yield target")),
          ),
        );
        const typeCode = op.delegate ? 2 : 0;
        statements.push(
          t.returnStatement(
            t.objectExpression([
              t.objectProperty(t.identifier("_"), t.numericLiteral(typeCode)),
              t.objectProperty(
                t.identifier("v"),
                mem(op.valueVar, "yield val"),
              ),
            ]),
          ),
        );
        break;
      }
      case "HALT":
        statements.push(t.returnStatement());
        break;
      case "AWAIT": {
        // Suspend VM execution, return Promise chain, and resume later
        const promiseExpr = mem(op.promiseVar, "promise");
        const resolvedPromise = t.callExpression(
          t.memberExpression(t.identifier("Promise"), t.identifier("resolve")),
          [promiseExpr],
        );
        const thenCallback = t.arrowFunctionExpression(
          [t.identifier("r")],
          t.blockStatement([
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(
                  t.memberExpression(Ctx, t.identifier("M")),
                  t.numericLiteral(this._getMemOrFail(op.to, "await dest")),
                  true,
                ),
                t.identifier("r"),
              ),
            ),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(Ctx, t.identifier("S")),
                num(nextMapped, "next state"),
              ),
            ),
            t.returnStatement(t.callExpression(VM, [Ctx])),
          ]),
        );
        const catchCallback = t.arrowFunctionExpression(
          [t.identifier("e")],
          t.callExpression(VM, [
            Ctx,
            t.identifier("e"),
            t.booleanLiteral(true),
          ]),
        );
        statements.push(
          t.returnStatement(
            t.callExpression(
              t.memberExpression(
                t.callExpression(
                  t.memberExpression(resolvedPromise, t.identifier("then")),
                  [thenCallback],
                ),
                t.identifier("catch"),
              ),
              [catchCallback],
            ),
          ),
        );
        break;
      }
      case "ASSIGN":
        statements.push(assign(mem(op.to, "dest"), mem(op.from, "src")));
        break;
      case "ASSIGN_GLOBAL":
        statements.push(
          assign(mem(op.to, "dest"), t.identifier(op.globalName)),
        );
        break;
      case "ASSIGN_LITERAL":
        statements.push(assign(mem(op.to, "dest"), t.valueToNode(op.value)));
        break;
      case "EXECUTE_STATEMENT":
        if (t.isBlockStatement(op.statement))
          statements.push(...op.statement.body);
        else statements.push(op.statement);
        break;
      case "BINARY":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.binaryExpression(
              op.op,
              mem(op.left, "left"),
              mem(op.right, "right"),
            ),
          ),
        );
        break;
      case "UNARY":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.unaryExpression(op.op, mem(op.argument, "arg")),
          ),
        );
        break;
      case "CREATE_ARRAY":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.arrayExpression(
              op.elements.map((el) => {
                if (el === null) return null;
                if (typeof el === "object" && el.spreadVar)
                  return t.spreadElement(mem(el.spreadVar, "spread el"));
                return mem(el, "el");
              }),
            ),
          ),
        );
        break;
      case "CREATE_OBJECT":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.objectExpression(
              op.properties.map((prop) => {
                if (prop.spreadVar)
                  return t.spreadElement(mem(prop.spreadVar, "spread src"));
                let keyNode;
                let computed = false;
                if (prop.keyVar) {
                  keyNode = mem(prop.keyVar, "computed key");
                  computed = true;
                } else {
                  keyNode = this._createStringAccess(String(prop.key));
                  computed = true;
                }
                return t.objectProperty(
                  keyNode,
                  mem(prop.valueVar, "prop val"),
                  computed,
                );
              }),
            ),
          ),
        );
        break;
      case "MEMBER_ASSIGN":
        statements.push(
          assign(
            t.memberExpression(
              mem(op.object, "obj"),
              this._createStringAccess(op.property),
              true,
            ),
            mem(op.value, "val"),
          ),
        );
        break;
      case "MEMBER_ASSIGN_COMPUTED":
        statements.push(
          assign(
            t.memberExpression(
              mem(op.object, "obj"),
              mem(op.property, "prop"),
              true,
            ),
            mem(op.value, "val"),
          ),
        );
        break;
      case "COND_JUMP": {
        const mappedTrue = this._getMappedId(op.trueState);
        const mappedFalse = this._getMappedId(op.falseState);
        statements.push(
          assign(
            S,
            t.conditionalExpression(
              mem(op.testVar, "test"),
              num(mappedTrue, "true"),
              num(mappedFalse, "false"),
            ),
          ),
        );
        break;
      }
      case "PUSH_CATCH_HANDLER":
        statements.push(
          assign(
            t.memberExpression(
              M,
              t.updateExpression("++", mem("_EHP", "ehp"), false),
              true,
            ),
            num(this._getMappedId(op.target), "catch target"),
          ),
        );
        break;
      case "POP_CATCH_HANDLER":
        statements.push(
          t.expressionStatement(
            t.updateExpression("--", mem("_EHP", "ehp"), true),
          ),
        );
        break;
      case "THROW":
        statements.push(t.throwStatement(mem(op.valueVar, "throw value")));
        break;
      case "NEW_EXTERNAL_INSTANCE":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.newExpression(mem(op.callee, "callee"), resolveArgs(op.args)),
          ),
        );
        break;
      case "NEW_INSTANCE":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.newExpression(mem(op.className, "callee"), resolveArgs(op.args)),
          ),
        );
        break;
      case "METHOD_CALL":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.callExpression(
              t.memberExpression(
                mem(op.instance, "instance"),
                this._createStringAccess(op.method),
                true,
              ),
              resolveArgs(op.args),
            ),
          ),
        );
        break;
      case "FINALLY_DISPATCH": {
        // Handles routing after a 'finally' block executes.
        // Determines whether to return, throw, continue loop, or proceed normally.
        const normalFlow =
          nextMapped !== null
            ? [assign(S, num(nextMapped, "next")), t.breakStatement()]
            : [t.returnStatement()];

        statements.push(
          t.switchStatement(mem("_FIN", "fin type"), [
            t.switchCase(t.numericLiteral(0), normalFlow),
            t.switchCase(t.numericLiteral(1), [
              t.returnStatement(
                t.objectExpression([
                  t.objectProperty(t.identifier("_"), t.numericLiteral(1)),
                  t.objectProperty(
                    t.identifier("v"),
                    mem("_FIN_V", "fin ret val"),
                  ),
                ]),
              ),
            ]),
            t.switchCase(t.numericLiteral(2), [
              assign(S, mem("_FIN_V", "fin break target")),
              t.breakStatement(),
            ]),
            t.switchCase(t.numericLiteral(3), [
              assign(S, mem("_FIN_V", "fin continue target")),
              t.breakStatement(),
            ]),
            t.switchCase(t.numericLiteral(4), [
              t.throwStatement(mem("_FIN_V", "fin throw val")),
            ]),
          ]),
        );
        break;
      }
      case "RETRIEVE_RESULT":
        statements.push(assign(mem(op.to, "dest"), mem("_RET", "ret val")));
        break;
      case "MEMBER_ACCESS":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.memberExpression(
              mem(op.object, "obj"),
              this._createStringAccess(op.property),
              true,
            ),
          ),
        );
        break;
      case "MEMBER_ACCESS_COMPUTED": {
        const objectExpr = this.astGen.memoryMap.has(op.object)
          ? mem(op.object, "obj")
          : t.identifier(op.object);
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.memberExpression(objectExpr, mem(op.property, "prop"), true),
          ),
        );
        break;
      }
      case "MEMBER_ACCESS_GLOBAL":
        statements.push(
          assign(
            mem(op.to, "dest"),
            t.memberExpression(
              t.identifier(op.object),
              this._createStringAccess(op.property),
              true,
            ),
          ),
        );
        break;
      case "EXTERNAL_CALL": {
        let calleeExpr;

        // NEW: Handle dynamic import() via special marker
        if (op.callee === "import") {
          calleeExpr = t.import();
        } else if (
          typeof op.callee === "object" &&
          op.callee.member_access_global
        ) {
          const { object, property } = op.callee.member_access_global;
          calleeExpr = t.memberExpression(
            t.identifier(object),
            this._createStringAccess(property),
            true,
          );
        } else {
          if (op.callee === this.astGen.stringConcealer.decoderFunctionName)
            calleeExpr = t.identifier(op.callee);
          else if (this.astGen.memoryMap.has(op.callee))
            calleeExpr = mem(op.callee, "callee");
          else calleeExpr = t.identifier(op.callee);
        }
        const argsExprs = resolveArgs(op.args);
        let callExpr;
        if (op.thisObject) {
          const thisObjectExpr = this.astGen.memoryMap.has(op.thisObject)
            ? mem(op.thisObject, "thisObject")
            : t.identifier(op.thisObject);
          callExpr = t.callExpression(
            t.memberExpression(
              calleeExpr,
              this._createStringAccess("call"),
              true,
            ),
            [thisObjectExpr, ...argsExprs],
          );
        } else {
          callExpr = t.callExpression(calleeExpr, argsExprs);
        }
        statements.push(assign(mem(op.to, "dest"), callExpr));
        break;
      }
      case "NOOP":
      case "GOTO":
      case "POST_CALL":
        break;
    }
    return statements;
  }
}

module.exports = BaseDispatcher;
