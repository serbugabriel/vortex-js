/**
 * @file ir-class-handler.js
 * @description Handles the transformation of ES6 Classes into Vortex VM compatible states.
 * Since the VM is stackless and register-based, classes are "lowered" into:
 * 1. Constructor functions (virtualized).
 * 2. Prototype manipulations (for methods).
 * 3. WeakMaps (for private fields).
 * 4. Reflect.construct calls (for inheritance).
 */

const t = require("@babel/types");
const traverse = require("@babel/traverse").default;

/**
 * Class responsible for decomposing and virtualizing ES6 Class definitions.
 */
class ClassHandler {
  /**
   * @param {Object} irGenerator - The parent IR Generator instance.
   */
  constructor(irGenerator) {
    this.ir = irGenerator;
    // Maps private field names (#field) to their corresponding WeakMap variable names.
    this.privateMembers = new Map();
  }

  /**
   * Helper: Compiles a detached AST node into IR states.
   * Used for static property initializers.
   * @param {Object} astNode - The AST node to compile.
   * @param {number} previousStateId - The state to link from.
   * @returns {Object} Result object { lastStateId, resultVar }.
   */
  _compileASTNode(astNode, previousStateId) {
    if (!astNode) {
      const temp = this.ir.createTempVar();
      const noop = this.ir.addState({
        type: "ASSIGN_LITERAL",
        to: temp.name,
        value: undefined,
      });
      if (previousStateId) this.ir.linkStates(previousStateId, noop);
      return { lastStateId: noop, resultVar: temp };
    }

    const file = t.file(t.program([t.expressionStatement(astNode)]));
    let result = null;

    traverse(file, {
      Program: (path) => {
        const exprPath = path.get("body")[0].get("expression");
        result = this.ir.processExpression(exprPath);
        path.stop();
      },
    });

    if (previousStateId && result) {
      this.ir.linkStates(previousStateId, result.start);
    }

    return { lastStateId: result.end, resultVar: result.resultVar };
  }

  /**
   * Helper: Virtualizes a class method by extracting it into a standalone function
   * and registering it with the VM's function table.
   * @param {Object} funcNode - The FunctionExpression node.
   * @param {string} funcName - The desired name for the function.
   * @returns {string} The final variable name allocated in memory.
   */
  _virtualizeMethod(funcNode, funcName) {
    if (this.ir.memoryMap.has(funcName)) {
      funcName = funcName + "_" + this.ir.stateCounter;
    }

    if (!this.ir.memoryMap.has(funcName)) {
      this.ir.memoryMap.set(funcName, this.ir.memoryMap.size);
    }
    const memIdx = this.ir.memoryMap.get(funcName);
    this.ir.globalIds.add(memIdx);

    funcNode.id = t.identifier(funcName);

    const startStateId = this.ir.addState({
      type: "FUNC_ENTRY",
      name: funcName,
      isAsync: funcNode.async,
      isGenerator: funcNode.generator,
    });
    this.ir.functionStartStates.set(funcName, startStateId);

    const tempFile = t.file(t.program([t.expressionStatement(funcNode)]));
    let funcPath = null;
    traverse(tempFile, {
      FunctionExpression(path) {
        funcPath = path;
        path.stop();
      },
    });

    const oldContext = this.ir.functionContext;
    this.ir.functionContext = {
      name: funcName,
      tempVars: new Set(),
      isAsync: funcNode.async,
    };

    this.ir.processFunction(funcPath, startStateId);

    const entryState = this.ir.getState(startStateId);
    entryState.op.params = funcNode.params;
    entryState.op.tempVars = Array.from(this.ir.functionContext.tempVars);

    this.ir.functionContext = oldContext;

    return funcName;
  }

  /**
   * Main entry point for processing a ClassExpression or ClassDeclaration.
   * @param {Object} path - The Babel path to the Class node.
   * @param {string} [targetVarName] - Optional variable name to assign the class to.
   * @returns {Object} Result object { start, end, resultVar }.
   */
  process(path, targetVarName = null) {
    this.privateMembers.clear();
    const { node } = path;

    let className;
    if (targetVarName) {
      className = targetVarName;
    } else if (node.id) {
      className = node.id.name;
    } else {
      const temp = this.ir.createTempVar();
      className = temp.name;
    }

    // 1. Handle Super Class (Inheritance)
    let superVarName = null;
    let superClassStart = null;
    let superClassEnd = null;

    if (node.superClass) {
      const superInfo = this.ir.processExpression(path.get("superClass"));
      superVarName = superInfo.resultVar.name;
      superClassStart = superInfo.start;
      superClassEnd = superInfo.end;

      const superIdx = this.ir.memoryMap.get(superVarName);
      if (superIdx !== undefined) this.ir.globalIds.add(superIdx);
    }

    // 2. Scan and Prepare Private Members
    this.scanForPrivateMembers(path);

    // 3. Initialize WeakMaps for Private Members
    let weakMapCreationStates = this.createWeakMapStates();
    let startStateId = null;
    let lastStateId = null;

    if (superClassStart) {
      startStateId = superClassStart;
      lastStateId = superClassEnd;
      if (weakMapCreationStates) {
        this.ir.linkStates(lastStateId, weakMapCreationStates.start);
        lastStateId = weakMapCreationStates.end;
      }
    } else if (weakMapCreationStates) {
      startStateId = weakMapCreationStates.start;
      lastStateId = weakMapCreationStates.end;
    }

    // 4. Transpile Class Body (Rewrite private fields to WeakMaps, etc.)
    const { transpiledMembers, staticPrivateInit, constructorInitializers } =
    this.transpileClassBody(path, superVarName);

    // 5. Build/Rewrite Constructor
    let constructorMember = transpiledMembers.find(
      (m) => m.kind === "constructor",
    );

    if (constructorMember) {
      if (constructorInitializers.length > 0) {
        if (superVarName) {
          this.injectInitializersAfterSuper(
            constructorMember,
            constructorInitializers,
          );
        } else {
          constructorMember.body.body.unshift(...constructorInitializers);
        }
      }
      if (superVarName) {
        this.rewriteConstructorForInheritance(constructorMember, superVarName);
      }
    } else {
      // --- Synthetic Default Constructor ---
      if (superVarName) {
        const thisVar = this.ir.createTempVar();
        // FIX: Explicitly allocate 'args' for the synthetic constructor
        const argsVar = this.ir.createTempVar("args");

        if (constructorInitializers.length > 0) {
          const tempAst = t.file(t.program(constructorInitializers));
          traverse(tempAst, {
            ThisExpression(path) {
              path.replaceWith(thisVar);
            },
          });
        }
        // Logic: return Reflect.construct(Super, args, new.target)
        const bodyStatements = [
          t.variableDeclaration("let", [t.variableDeclarator(thisVar)]),
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              thisVar,
              t.callExpression(
                t.memberExpression(
                  t.identifier("Reflect"),
                                   t.identifier("construct"),
                ),
                [
                  t.identifier(superVarName),
                               argsVar, // Use allocated var
                               t.metaProperty(t.identifier("new"), t.identifier("target")),
                ],
              ),
            ),
          ),
          ...constructorInitializers,
          t.returnStatement(thisVar),
        ];
        constructorMember = t.classMethod(
          "constructor",
          t.identifier("constructor"),
                                          [t.restElement(argsVar)], // Use allocated var
                                          t.blockStatement(bodyStatements),
        );
      } else {
        constructorMember = t.classMethod(
          "constructor",
          t.identifier("constructor"),
                                          [],
                                          t.blockStatement(constructorInitializers),
        );
      }
    }

    // 6. Virtualize the Constructor Function
    const constructorFuncExpr = t.functionExpression(
      node.id ? t.identifier(node.id.name) : null,
                                                     constructorMember.params,
                                                     constructorMember.body,
    );

    const ctorVarName = this._virtualizeMethod(
      constructorFuncExpr,
      `${className}_ctor`,
    );

    const classAssignStateId = this.ir.addState({
      type: "ASSIGN",
      to: className,
      from: ctorVarName,
    });

    if (startStateId === null) startStateId = classAssignStateId;
    if (lastStateId !== null)
      this.ir.linkStates(lastStateId, classAssignStateId);
    lastStateId = classAssignStateId;

    // 7. Inheritance Wiring (Object.setPrototypeOf)
    if (superVarName) {
      const setProtoState = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: this.ir.createTempVar().name,
                                             callee: {
                                               member_access_global: {
                                                 object: "Object",
                                                 property: "setPrototypeOf",
                                               },
                                             },
                                             args: [className, superVarName],
      });
      this.ir.linkStates(lastStateId, setProtoState);
      lastStateId = setProtoState;

      // Set up prototype chain: Child.prototype = Object.create(Parent.prototype)
      const parentProtoVar = this.ir.createTempVar();
      const getParentProto = this.ir.addState({
        type: "MEMBER_ACCESS",
        to: parentProtoVar.name,
        object: superVarName,
        property: "prototype",
      });
      this.ir.linkStates(lastStateId, getParentProto);

      const newProtoVar = this.ir.createTempVar();
      const createProto = this.ir.addState({
        type: "EXTERNAL_CALL",
        to: newProtoVar.name,
        callee: {
          member_access_global: { object: "Object", property: "create" },
        },
        args: [parentProtoVar.name],
      });
      this.ir.linkStates(getParentProto, createProto);

      const setChildProto = this.ir.addState({
        type: "MEMBER_ASSIGN",
        object: className,
        property: "prototype",
        value: newProtoVar.name,
      });
      this.ir.linkStates(createProto, setChildProto);

      const fixConstructor = this.ir.addState({
        type: "MEMBER_ASSIGN",
        object: newProtoVar.name,
        property: "constructor",
        value: className,
      });
      this.ir.linkStates(setChildProto, fixConstructor);
      lastStateId = fixConstructor;
    }

    // 8. Static Private Initialization
    if (staticPrivateInit && staticPrivateInit.length > 0) {
      for (const init of staticPrivateInit) {
        let compiledValueName;
        if (t.isFunction(init.value)) {
          compiledValueName = this._virtualizeMethod(
            init.value,
            `${className}_static_priv`,
          );
        } else {
          const { lastStateId: newState, resultVar } = this._compileASTNode(
            init.value,
            lastStateId,
          );
          lastStateId = newState;
          compiledValueName = resultVar.name;
        }

        const wmSetId = this.ir.addState({
          type: "METHOD_CALL",
          to: this.ir.createTempVar().name,
                                         instance: init.weakMapVar,
                                         method: "set",
                                         args: [className, compiledValueName],
        });
        this.ir.linkStates(lastStateId, wmSetId);
        lastStateId = wmSetId;
      }
    }

    // 9. Process Static Members
    lastStateId = this.processStaticMembers(
      transpiledMembers,
      className,
      lastStateId,
    );

    // 10. Process Instance Members (Prototype)
    const tempProtoVar = this.ir.createTempVar();
    const getProtoStateId = this.ir.addState({
      type: "MEMBER_ACCESS",
      to: tempProtoVar.name,
      object: className,
      property: "prototype",
    });
    this.ir.linkStates(lastStateId, getProtoStateId);
    lastStateId = getProtoStateId;

    lastStateId = this.processInstanceMembers(
      transpiledMembers,
      tempProtoVar.name,
      lastStateId,
      className,
    );

    return {
      start: startStateId,
      end: lastStateId,
      resultVar: t.identifier(className),
    };
  }

  /**
   * Identifies private fields (#prop) and allocates a WeakMap for each.
   */
  scanForPrivateMembers(classPath) {
    const bodyPaths = classPath.get("body").get("body");
    for (const memberPath of bodyPaths) {
      if (
        memberPath.isClassPrivateProperty() ||
        memberPath.isClassPrivateMethod()
      ) {
        const privateName = memberPath.node.key.id.name;
        if (!this.privateMembers.has(privateName)) {
          const weakMapVar = this.ir.createTempVar(`_private_${privateName}`);
          this.privateMembers.set(privateName, weakMapVar.name);
          const idx = this.ir.memoryMap.get(weakMapVar.name);
          this.ir.globalIds.add(idx);
        }
      }
    }
  }

  /**
   * Generates states to instantiate WeakMaps for private storage.
   */
  createWeakMapStates() {
    let start = null,
    end = null;
    for (const weakMapVarName of this.privateMembers.values()) {
      const newInstance = t.newExpression(t.identifier("WeakMap"), []);
      const tempVar = this.ir.createTempVar();
      const createState = this.ir.addState({
        type: "ASSIGN_LITERAL_DIRECT",
        to: tempVar.name,
        value: newInstance,
      });
      const assignState = this.ir.addState({
        type: "ASSIGN",
        to: weakMapVarName,
        from: tempVar.name,
      });
      this.ir.linkStates(createState, assignState);
      if (!start) start = createState;
      if (end) this.ir.linkStates(end, createState);
      end = assignState;
    }
    return start ? { start, end } : null;
  }

  /**
   * Rewrites class members to support private fields (WeakMap.get/set)
   * and prepares initialization logic.
   */
  transpileClassBody(classPath, superVarName) {
    const constructorInitializers = [];
    const staticPrivateInit = [];
    const bodyPaths = classPath.get("body").get("body");

    for (const memberPath of bodyPaths) {
      if (memberPath.isClassPrivateProperty()) {
        const { key, value, static: isStatic } = memberPath.node;
        const weakMapVarName = this.privateMembers.get(key.id.name);
        if (isStatic) {
          if (value)
            staticPrivateInit.push({ value, weakMapVar: weakMapVarName });
        } else {
          if (value) {
            const initializer = t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier(weakMapVarName),
                                   t.identifier("set"),
                ),
                [t.thisExpression(), value],
              ),
            );
            constructorInitializers.push(initializer);
          }
        }
      } else if (memberPath.isClassPrivateMethod()) {
        const {
          key,
          params,
          body,
          generator,
          async,
          static: isStatic,
        } = memberPath.node;
        const weakMapVarName = this.privateMembers.get(key.id.name);
        const methodFunc = t.functionExpression(
          null,
          params,
          body,
          generator,
          async,
        );
        if (isStatic) {
          staticPrivateInit.push({
            value: methodFunc,
            weakMapVar: weakMapVarName,
          });
        } else {
          const initializer = t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier(weakMapVarName),
                                 t.identifier("set"),
              ),
              [t.thisExpression(), methodFunc],
            ),
          );
          constructorInitializers.push(initializer);
        }
      } else if (memberPath.isClassProperty()) {
        if (!memberPath.node.static && memberPath.node.value) {
          const initializer = t.expressionStatement(
            t.assignmentExpression(
              "=",
              t.memberExpression(t.thisExpression(), memberPath.node.key),
                                   memberPath.node.value,
            ),
          );
          constructorInitializers.push(initializer);
        }
      }
    }

    const rootNode = classPath.isExpression()
    ? t.expressionStatement(classPath.node)
    : classPath.node;
    const tempAst = t.file(t.program([rootNode]));
    const self = this;
    const visitor = {
      PrivateName(path) {},
      "ClassPrivateProperty|ClassPrivateMethod"(path) {},
      MemberExpression(path) {
        // Rewrite this.#private -> _weakMap.get(this)
        if (t.isPrivateName(path.node.property)) {
          const privateName = path.node.property.id.name;
          const weakMapVarName = self.privateMembers.get(privateName);
          if (!weakMapVarName) return;
          const getCall = t.callExpression(
            t.memberExpression(
              t.identifier(weakMapVarName),
                               t.identifier("get"),
            ),
            [path.node.object],
          );
          path.replaceWith(getCall);
        } else if (superVarName && path.get("object").isSuper()) {
          // Rewrite super.prop -> Reflect.get(Super.prototype, 'prop', this)
          if (path.parentPath.isAssignmentExpression() && path.key === "left")
            return;
          if (path.parentPath.isCallExpression() && path.key === "callee")
            return;
          if (path.parentPath.isUpdateExpression() && path.key === "argument")
            return;
          const property = path.node.property;
          const computed = path.node.computed;
          const superProto = t.memberExpression(
            t.identifier(superVarName),
                                                t.identifier("prototype"),
          );
          const propArg = computed ? property : t.stringLiteral(property.name);
          const reflectGet = t.callExpression(
            t.memberExpression(t.identifier("Reflect"), t.identifier("get")),
                                              [superProto, propArg, t.thisExpression()],
          );
          path.replaceWith(reflectGet);
        }
      },
      CallExpression(path) {
        // Rewrite call this.#private() -> _weakMap.get(this).call(this, args)
        if (
          t.isMemberExpression(path.node.callee) &&
          t.isPrivateName(path.node.callee.property)
        ) {
          const privateName = path.node.callee.property.id.name;
          const weakMapVarName = self.privateMembers.get(privateName);
          if (!weakMapVarName) return;
          const getCall = t.callExpression(
            t.memberExpression(
              t.identifier(weakMapVarName),
                               t.identifier("get"),
            ),
            [path.node.callee.object],
          );
          path.replaceWith(
            t.callExpression(
              t.memberExpression(getCall, t.identifier("call")),
                             [path.node.callee.object, ...path.node.arguments],
            ),
          );
        } else if (superVarName && path.get("callee").isSuper()) {
          // super() handled in rewriteConstructorForInheritance
        } else if (
          superVarName &&
          path.get("callee").isMemberExpression() &&
          path.get("callee.object").isSuper()
        ) {
          // Rewrite super.method() -> Super.prototype.method.call(this, args)
          const methodProp = path.node.callee.property;
          const computed = path.node.callee.computed;
          const superProto = t.memberExpression(
            t.identifier(superVarName),
                                                t.identifier("prototype"),
          );
          const methodAccess = t.memberExpression(
            superProto,
            methodProp,
            computed,
          );
          const callMethod = t.callExpression(
            t.memberExpression(methodAccess, t.identifier("call")),
                                              [t.thisExpression(), ...path.node.arguments],
          );
          path.replaceWith(callMethod);
        }
      },
      AssignmentExpression(path) {
        // Rewrite this.#private = val -> _weakMap.set(this, val)
        if (
          t.isMemberExpression(path.node.left) &&
          t.isPrivateName(path.node.left.property)
        ) {
          const privateName = path.node.left.property.id.name;
          const weakMapVarName = self.privateMembers.get(privateName);
          if (!weakMapVarName) return;
          const setCall = t.callExpression(
            t.memberExpression(
              t.identifier(weakMapVarName),
                               t.identifier("set"),
            ),
            [path.node.left.object, path.node.right],
          );
          path.replaceWith(setCall);
        } else if (
          superVarName &&
          t.isMemberExpression(path.node.left) &&
          path.get("left.object").isSuper()
        ) {
          // Rewrite super.prop = val -> Reflect.set(Super.prototype, 'prop', val, this)
          const property = path.node.left.property;
          const computed = path.node.left.computed;
          const value = path.node.right;
          const superProto = t.memberExpression(
            t.identifier(superVarName),
                                                t.identifier("prototype"),
          );
          const propArg = computed ? property : t.stringLiteral(property.name);
          const reflectSet = t.callExpression(
            t.memberExpression(t.identifier("Reflect"), t.identifier("set")),
                                              [superProto, propArg, value, t.thisExpression()],
          );
          path.replaceWith(t.sequenceExpression([reflectSet, value]));
        }
      },
      UpdateExpression(path) {
        // Rewrite this.#private++ -> (get, +1, set, return)
        if (
          t.isMemberExpression(path.node.argument) &&
          t.isPrivateName(path.node.argument.property)
        ) {
          const privateName = path.node.argument.property.id.name;
          const weakMapVarName = self.privateMembers.get(privateName);
          if (!weakMapVarName) return;
          const operator = path.node.operator === "++" ? "+" : "-";
          const prefix = path.node.prefix;
          const obj = path.node.argument.object;
          const oldValId = self.ir.createTempVar();
          const newValId = self.ir.createTempVar();
          const body = t.blockStatement([
            t.variableDeclaration("let", [
              t.variableDeclarator(
                oldValId,
                t.callExpression(
                  t.memberExpression(
                    t.identifier(weakMapVarName),
                                     t.identifier("get"),
                  ),
                  [obj],
                ),
              ),
            ]),
            t.variableDeclaration("let", [
              t.variableDeclarator(
                newValId,
                t.binaryExpression(
                  operator,
                  t.unaryExpression("+", oldValId),
                                   t.numericLiteral(1),
                ),
              ),
            ]),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier(weakMapVarName),
                                   t.identifier("set"),
                ),
                [obj, newValId],
              ),
            ),
            t.returnStatement(prefix ? newValId : oldValId),
          ]);
          path.replaceWith(
            t.callExpression(t.arrowFunctionExpression([], body), []),
          );
        } else if (
          superVarName &&
          t.isMemberExpression(path.node.argument) &&
          path.get("argument.object").isSuper()
        ) {
          // Rewrite super.prop++ -> (Reflect.get, +1, Reflect.set)
          const property = path.node.argument.property;
          const computed = path.node.argument.computed;
          const operator = path.node.operator === "++" ? "+" : "-";
          const prefix = path.node.prefix;
          const superProto = t.memberExpression(
            t.identifier(superVarName),
                                                t.identifier("prototype"),
          );
          const propArg = computed ? property : t.stringLiteral(property.name);
          const oldValId = self.ir.createTempVar();
          const newValId = self.ir.createTempVar();
          const body = t.blockStatement([
            t.variableDeclaration("let", [
              t.variableDeclarator(
                oldValId,
                t.callExpression(
                  t.memberExpression(
                    t.identifier("Reflect"),
                                     t.identifier("get"),
                  ),
                  [superProto, propArg, t.thisExpression()],
                ),
              ),
            ]),
            t.variableDeclaration("let", [
              t.variableDeclarator(
                newValId,
                t.binaryExpression(
                  operator,
                  t.unaryExpression("+", oldValId),
                                   t.numericLiteral(1),
                ),
              ),
            ]),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier("Reflect"),
                                   t.identifier("set"),
                ),
                [superProto, propArg, newValId, t.thisExpression()],
              ),
            ),
            t.returnStatement(prefix ? newValId : oldValId),
          ]);
          path.replaceWith(
            t.callExpression(t.arrowFunctionExpression([], body), []),
          );
        }
      },
    };
    traverse(tempAst, visitor);
    let classNode = tempAst.program.body[0];
    if (t.isExpressionStatement(classNode)) {
      classNode = classNode.expression;
    }
    const transpiledMembers = classNode.body.body;
    return { transpiledMembers, staticPrivateInit, constructorInitializers };
  }

  /**
   * Ensures field initializers run *after* super() is called in the constructor.
   */
  injectInitializersAfterSuper(constructorMember, initializers) {
    let superFound = false;
    const visitor = {
      CallExpression(path) {
        if (path.get("callee").isSuper()) {
          superFound = true;
          path.insertAfter(initializers);
          path.stop();
        }
      },
    };
    const tempAst = t.file(
      t.program([
        t.functionDeclaration(t.identifier("temp"), [], constructorMember.body),
      ]),
    );
    traverse(tempAst, visitor);
    if (!superFound) {
      constructorMember.body.body.unshift(...initializers);
    }
  }

  /**
   * Converts super() calls into Reflect.construct() logic inside the constructor.
   */
  rewriteConstructorForInheritance(constructorMember, superVarName) {
    const body = constructorMember.body;
    const thisVar = this.ir.createTempVar();
    const visitor = {
      CallExpression(path) {
        if (path.get("callee").isSuper()) {
          const args = path.node.arguments;
          const construct = t.assignmentExpression(
            "=",
            thisVar,
            t.callExpression(
              t.memberExpression(
                t.identifier("Reflect"),
                                 t.identifier("construct"),
              ),
              [
                t.identifier(superVarName),
                             t.arrayExpression(
                               args.map((a) =>
                               t.isSpreadElement(a) ? t.spreadElement(a.argument) : a,
                               ),
                             ),
                             t.metaProperty(t.identifier("new"), t.identifier("target")),
              ],
            ),
          );
          path.replaceWith(t.expressionStatement(construct));
        }
      },
      ThisExpression(path) {
        path.replaceWith(thisVar);
      },
    };
    const tempAst = t.file(
      t.program([t.functionDeclaration(t.identifier("temp"), [], body)]),
    );
    traverse(tempAst, visitor);
    body.body.unshift(
      t.variableDeclaration("let", [t.variableDeclarator(thisVar)]),
    );
    body.body.push(t.returnStatement(thisVar));
  }

  /**
   * Virtualizes static methods and properties.
   */
  processStaticMembers(body, className, lastStateId) {
    for (const member of body) {
      if (!member.static) continue;
      if (
        member.type === "ClassPrivateProperty" ||
        member.type === "ClassPrivateMethod"
      )
        continue;

        if (member.type === "ClassMethod") {
          const methodFuncExpr = t.functionExpression(
            null,
            member.params,
            member.body,
            member.generator,
            member.async,
          );
          const funcVarName = this._virtualizeMethod(
            methodFuncExpr,
            `${className}_static_${member.key.name || "method"}`,
          );
          const tempVar = this.ir.createTempVar();
          const stateId = this.ir.addState({
            type: "ASSIGN",
            to: tempVar.name,
            from: funcVarName,
          });
          this.ir.linkStates(lastStateId, stateId);
          lastStateId = stateId;

          if (member.kind === "get" || member.kind === "set") {
            const descVar = this.ir.createTempVar();
            const trueVar = this.ir.createTempVar();
            const trueAssign = this.ir.addState({
              type: "ASSIGN_LITERAL",
              to: trueVar.name,
              value: true,
            });
            this.ir.linkStates(lastStateId, trueAssign);
            const createDesc = this.ir.addState({
              type: "CREATE_OBJECT",
              to: descVar.name,
              properties: [
                { key: member.kind, valueVar: tempVar.name },
                { key: "configurable", valueVar: trueVar.name },
              ],
            });
            this.ir.linkStates(trueAssign, createDesc);
            const defProp = this.ir.addState({
              type: "EXTERNAL_CALL",
              to: this.ir.createTempVar().name,
                                             callee: {
                                               member_access_global: {
                                                 object: "Object",
                                                 property: "defineProperty",
                                               },
                                             },
                                             args: [
                                               className,
                                               { literal: member.key.name || member.key.value },
                                               descVar.name,
                                             ],
            });
            this.ir.linkStates(createDesc, defProp);
            lastStateId = defProp;
          } else {
            const assignStateId = this.ir.addState({
              type: "MEMBER_ASSIGN",
              object: className,
              property: member.key.name || member.key.value,
              value: tempVar.name,
            });
            this.ir.linkStates(lastStateId, assignStateId);
            lastStateId = assignStateId;
          }
        } else if (member.type === "ClassProperty" && member.value) {
          const { lastStateId: newState, resultVar } = this._compileASTNode(
            member.value,
            lastStateId,
          );
          lastStateId = newState;
          const assignStateId = this.ir.addState({
            type: "MEMBER_ASSIGN",
            object: className,
            property: member.key.name || member.key.value,
            value: resultVar.name,
          });
          this.ir.linkStates(lastStateId, assignStateId);
          lastStateId = assignStateId;
        }
    }
    return lastStateId;
  }

  /**
   * Virtualizes instance methods and adds them to the prototype.
   */
  processInstanceMembers(body, protoVarName, lastStateId, className) {
    for (const member of body) {
      if (
        member.type !== "ClassMethod" ||
        member.static ||
        member.kind === "constructor"
      )
        continue;
        if (member.type === "ClassPrivateMethod") continue;

        const methodFuncExpr = t.functionExpression(
          null,
          member.params,
          member.body,
          member.generator,
          member.async,
        );
        const funcVarName = this._virtualizeMethod(
          methodFuncExpr,
          `${className}_inst_${member.key.name || "method"}`,
        );
        const tempMethodVar = this.ir.createTempVar();
        const methodCreationStateId = this.ir.addState({
          type: "ASSIGN",
          to: tempMethodVar.name,
          from: funcVarName,
        });
        this.ir.linkStates(lastStateId, methodCreationStateId);
        lastStateId = methodCreationStateId;

        if (member.kind === "get" || member.kind === "set") {
          const descVar = this.ir.createTempVar();
          const trueVar = this.ir.createTempVar();
          const trueAssign = this.ir.addState({
            type: "ASSIGN_LITERAL",
            to: trueVar.name,
            value: true,
          });
          this.ir.linkStates(lastStateId, trueAssign);
          const createDesc = this.ir.addState({
            type: "CREATE_OBJECT",
            to: descVar.name,
            properties: [
              { key: member.kind, valueVar: tempMethodVar.name },
              { key: "configurable", valueVar: trueVar.name },
            ],
          });
          this.ir.linkStates(trueAssign, createDesc);
          const defProp = this.ir.addState({
            type: "EXTERNAL_CALL",
            to: this.ir.createTempVar().name,
                                           callee: {
                                             member_access_global: {
                                               object: "Object",
                                               property: "defineProperty",
                                             },
                                           },
                                           args: [
                                             protoVarName,
                                             { literal: member.key.name || member.key.value },
                                             descVar.name,
                                           ],
          });
          this.ir.linkStates(createDesc, defProp);
          lastStateId = defProp;
        } else {
          const assignMethodStateId = this.ir.addState({
            type: "MEMBER_ASSIGN",
            object: protoVarName,
            property: member.key.name,
            value: tempMethodVar.name,
          });
          this.ir.linkStates(lastStateId, assignMethodStateId);
          lastStateId = assignMethodStateId;
        }
    }
    return lastStateId;
  }
}

module.exports = ClassHandler;
