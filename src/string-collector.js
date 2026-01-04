/**
 * @fileoverview String Collector and Aggregator.
 * Responsible for identifying, extracting, and mapping all string-like entities
 * within a Babel AST for centralized management and encryption.
 */

const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

/**
 * StringCollector identifies all strings that need protection and maps them
 * to unique IDs. It also handles the injection of internal JS property names
 * to ensure the obfuscated VM can interact with the environment.
 */
class StringCollector {
  /**
   * @param {StringConcealer} stringConcealer The encryption engine.
   * @param {boolean} [noEncryption=false] If true, strings are stored in plaintext.
   */
  constructor(stringConcealer, noEncryption = false) {
    this.stringConcealer = stringConcealer;
    this.noEncryption = noEncryption;
    this.uniqueStrings = new Set();

    /**
     * Internal JS property names required for VM-to-Native interoperability.
     * These are added to the string pool to prevent leaking intent via property access.
     */
    this.internalStrings = {
      OBJECT_DEFINE_PROPERTY: [
        "get",
        "set",
        "value",
        "configurable",
        "enumerable",
        "writable",
        "defineProperty",
      ],
      OBJECT_MANIPULATION: [
        "create",
        "setPrototypeOf",
        "keys",
        "getPrototypeOf",
      ],
      PROTOTYPE: ["prototype", "constructor", "construct"],
      FUNCTION: ["call", "apply", "bind"],
      ITERATOR: [
        "iterator",
        "asyncIterator",
        "next",
        "done",
        "return",
        "throw",
      ],
      COMMON: ["length", "toString", "value"],
      ANTI_DEBUG: ["Date", "now", "Math", "Array"],
      TYPEOF: [
        "function",
        "object",
        "undefined",
        "boolean",
        "number",
        "string",
        "symbol",
        "bigint",
      ],
    };

    this.stringMap = new Map();
    this.finalArray = [];
    // Generate a unique identifier for the string pool variable
    this.arrayVariableName = `_S${Math.random().toString(36).slice(7)}`;
  }

  /**
   * Performs a full traversal of the AST to collect strings.
   * @param {t.Node} ast The Babel AST to scan.
   */
  collect(ast) {
    traverse(ast, {
      Program: () => {
        this.addRequired(this.internalStrings.ANTI_DEBUG);
        this.addRequired(this.internalStrings.TYPEOF);
      },

      StringLiteral: (path) => {
        // Skip strings used in imports/exports/JSX as they are usually non-virtualizable
        const p = path.parent;
        if (
          !t.isImportDeclaration(p) &&
          !t.isExportNamedDeclaration(p) &&
          !t.isExportAllDeclaration(p) &&
          !t.isJSXAttribute(p)
        ) {
          this.uniqueStrings.add(path.node.value);
        }
      },

      TemplateElement: (path) => {
        // Collect cooked values to preserve escape sequences correctly
        if (path.node.value.cooked) {
          this.uniqueStrings.add(path.node.value.cooked);
        }
      },

      "ObjectProperty|ObjectMethod": (path) => {
        // Collect non-computed keys (e.g., { key: value })
        if (!path.node.computed && t.isIdentifier(path.node.key)) {
          this.uniqueStrings.add(path.node.key.name);
        }
        if (t.isNumericLiteral(path.node.key)) {
          this.uniqueStrings.add(String(path.node.key.value));
        }
      },

      "ClassProperty|ClassMethod|ClassPrivateProperty|ClassPrivateMethod": (
        path,
      ) => {
        if (!path.node.computed && t.isIdentifier(path.node.key)) {
          this.uniqueStrings.add(path.node.key.name);
        }
        if (t.isNumericLiteral(path.node.key)) {
          this.uniqueStrings.add(String(path.node.key.value));
        }
      },

      "MemberExpression|OptionalMemberExpression": (path) => {
        // Convert static property access (obj.prop) into virtualizable strings
        if (!path.node.computed && t.isIdentifier(path.node.property)) {
          this.uniqueStrings.add(path.node.property.name);
        }
      },

      ArrayPattern: (path) => {
        // Collect indices for destructuring
        path.node.elements.forEach((elem, index) => {
          if (elem) this.uniqueStrings.add(String(index));
        });
      },

      MemberExpression: (path) => {
        if (path.node.computed && t.isNumericLiteral(path.node.property)) {
          this.uniqueStrings.add(String(path.node.property.value));
        }
      },

      "AssignmentExpression|ObjectExpression": () => {
        this.addRequired(this.internalStrings.OBJECT_DEFINE_PROPERTY);
        this.addRequired(this.internalStrings.COMMON);
      },

      "ClassDeclaration|ClassExpression": () => {
        this.addRequired(this.internalStrings.PROTOTYPE);
        this.addRequired(this.internalStrings.OBJECT_MANIPULATION);
        this.addRequired(this.internalStrings.OBJECT_DEFINE_PROPERTY);
      },

      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression": (
        path,
      ) => {
        if (path.node.generator || path.node.async) {
          this.addRequired(this.internalStrings.ITERATOR);
          this.addRequired(this.internalStrings.COMMON);
        }
      },

      ForOfStatement: () => {
        this.addRequired(this.internalStrings.ITERATOR);
        this.addRequired(this.internalStrings.COMMON);
      },

      ForInStatement: () => {
        this.addRequired(this.internalStrings.OBJECT_MANIPULATION);
        this.addRequired(this.internalStrings.COMMON);
      },

      CallExpression: (path) => {
        this.addRequired(this.internalStrings.FUNCTION);
        const callee = path.get("callee");
        if (
          callee.isMemberExpression() &&
          callee.get("object").isIdentifier({ name: "Object" })
        ) {
          const propName = callee.get("property").node.name;
          if (["create", "setPrototypeOf"].includes(propName)) {
            this.addRequired(this.internalStrings.OBJECT_MANIPULATION);
          }
        }
      },
    });
  }

  /** Helper to add a batch of strings to the pool. */
  addRequired(strings) {
    for (const str of strings) this.uniqueStrings.add(str);
  }

  /**
   * Shuffles strings, maps IDs, and encrypts the content.
   */
  finalize() {
    let strings = Array.from(this.uniqueStrings);

    // Fisher-Yates Shuffle to prevent order-based analysis
    for (let i = strings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [strings[i], strings[j]] = [strings[j], strings[i]];
    }

    // Assign IDs
    strings.forEach((str, idx) => this.stringMap.set(str, idx));

    // Conceal/Encrypt
    this.finalArray = this.noEncryption
      ? strings
      : strings.map((s) => this.stringConcealer.conceal(s));
  }

  /**
   * Gets the ID of a string for use in the virtualized code.
   * @throws Error if string was not collected during the 'collect' phase.
   */
  getStringId(str) {
    if (!this.stringMap.has(str)) {
      throw new Error(
        `[StringCollector] String "${str}" missing from map. Check static analysis coverage.`,
      );
    }
    return this.stringMap.get(str);
  }

  /**
   * Generates the AST for the global string pool variable.
   * @returns {t.VariableDeclaration|null}
   */
  getArrayAST() {
    if (this.finalArray.length === 0) return null;
    return t.variableDeclaration("const", [
      t.variableDeclarator(
        t.identifier(this.arrayVariableName),
        t.arrayExpression(this.finalArray.map((s) => t.stringLiteral(s))),
      ),
    ]);
  }
}

module.exports = StringCollector;
