/**
 * @fileoverview Property Name Mangler (DEPRECATED).
 * @deprecated This module is no longer part of the active VortexJS pipeline.
 * Virtualization now automatically converts MemberExpressions into numeric indices
 * within the State Machine's memory map, providing superior protection.
 */

const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

/**
 * PropertyNameMangler
 * Formerly used to rename object properties to obfuscated identifiers.
 */
class PropertyNameMangler {
  /**
   * @param {string[]} [propertiesToMangle=[]]
   */
  constructor(propertiesToMangle = []) {
    this.propertiesToMangle = new Set(propertiesToMangle);
    this.stringLiteralValues = new Set();
    this.mangledMap = new Map();
    this.mangledCounter = 0;

    /** Built-in properties that are never safe to mangle. */
    this.builtInProperties = new Set([
      "length",
      "prototype",
      "constructor",
      "message",
      "name",
      "stack",
      "toString",
      "valueOf",
      "push",
      "pop",
      "shift",
      "unshift",
      "splice",
      "slice",
      "indexOf",
      "includes",
      "forEach",
      "map",
      "filter",
      "reduce",
      "join",
      "find",
      "findIndex",
      "sort",
      "reverse",
      "log",
      "error",
      "warn",
      "info",
      "debug",
      "PI",
      "sqrt",
      "random",
      "floor",
      "ceil",
      "abs",
      "max",
      "min",
      "round",
      "pow",
      "keys",
      "values",
      "entries",
      "hasOwnProperty",
      "assign",
      "freeze",
      "seal",
      "fetch",
      "then",
      "catch",
      "finally",
      "json",
      "text",
      "blob",
      "arrayBuffer",
      "formData",
      "status",
      "statusText",
      "ok",
      "headers",
      "url",
      "body",
      "ip",
      "data",
      "result",
    ]);
  }

  /**
   * Scans for strings that might conflict with mangled properties.
   */
  collect(ast) {
    traverse(ast, {
      StringLiteral(path) {
        this.stringLiteralValues.add(path.node.value);
      },
    });
  }

  /**
   * Performs the mangling operation.
   * @param {Object} ast Babel AST.
   */
  mangle(ast) {
    if (this.propertiesToMangle.size === 0) return;

    for (const prop of this.propertiesToMangle) {
      if (
        !this.builtInProperties.has(prop) &&
        !this.stringLiteralValues.has(prop) &&
        !this.mangledMap.has(prop)
      ) {
        this.mangledMap.set(prop, `_p${this.mangledCounter++}`);
      }
    }

    if (this.mangledMap.size === 0) return;

    const knownGlobals = new Set([
      "console",
      "Math",
      "Object",
      "Array",
      "Symbol",
      "JSON",
      "Promise",
    ]);

    traverse(ast, {
      "MemberExpression|ObjectProperty|ClassProperty|ClassMethod"(path) {
        const key = path.isMemberExpression()
          ? path.node.property
          : path.node.key;
        if (path.node.computed) return;

        // Skip global methods
        if (
          path.isMemberExpression() &&
          path.get("object").isIdentifier() &&
          knownGlobals.has(path.get("object").node.name)
        )
          return;

        if (t.isIdentifier(key) && this.mangledMap.has(key.name)) {
          key.name = this.mangledMap.get(key.name);
        }
      },
    });
  }
}

module.exports = PropertyNameMangler;
