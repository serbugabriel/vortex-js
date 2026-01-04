/**
 * @file bst-dispatcher.js
 * @description Implements the Binary Search Tree (BST) / Hybrid Tree dispatcher.
 * Instead of a flat switch, this generates a deep tree of `if/else` statements.
 * It uses multiple strategies (Modulo, Isolation, Binary Split, Ghost Branches)
 * to make the control flow graph extremely complex and resistant to decompilation.
 */

const t = require("@babel/types");
const BaseDispatcher = require("./base-dispatcher");

class BSTDispatcher extends BaseDispatcher {
  /**
   * Generates the hybrid execution tree.
   * @param {Object} helpers - Context helpers.
   * @returns {Object} The root IfStatement (or BlockStatement) of the dispatcher.
   */
  generate(helpers) {
    const {
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
    } = helpers;

    // 1. Prepare all state bodies
    // We generate the code blocks first, then arrange them into a tree structure.
    const stateData = [];

    for (const state of this.astGen.states.filter(Boolean)) {
      const { id, op, next } = state;
      const mappedId = this._getMappedId(id);
      const nextMapped = next !== null ? this._getMappedId(next) : null;

      const getMem = (varName, ctx) =>
      this._getMemOrFail(varName, `State ${id} (${op.type}): ${ctx}`);
      const num = (val, ctx) =>
      this._createNumericLiteralOrFail(
        val,
        `State ${id} (${op.type}): ${ctx}`,
      );
      const mem = (varName, ctx) => {
        const idx = getMem(varName, ctx);
        const targetArray = this.astGen.globalIds.has(idx) ? GlobalM : M;
        return t.memberExpression(targetArray, t.numericLiteral(idx), true);
      };
      const assign = (left, right) =>
      t.expressionStatement(t.assignmentExpression("=", left, right));
      const resolveArgs = (argList) => {
        return argList.map((arg) => {
          if (typeof arg === "object") {
            if (arg.spreadVar)
              return t.spreadElement(mem(arg.spreadVar, "spread arg"));
            if (arg.hasOwnProperty("literal")) {
              if (typeof arg.literal === "string")
                return this._createStringAccess(arg.literal);
              return t.valueToNode(arg.literal);
            }
          }
          return mem(arg, "arg");
        });
      };

      const opHelpers = {
        ...helpers,
        nextMapped,
        resolveArgs,
        assign,
        mem,
        num,
        t,
        _RET_IDX: RET_IDX,
      };
      const body = this.generateOpCode(op, opHelpers);

      // Determine control flow vs fallthrough
      const isControlFlowOp = (type) =>
      [
        "COND_JUMP",
        "RETURN",
        "THROW",
        "HALT",
        "YIELD",
        "AWAIT",
        "FINALLY_DISPATCH",
      ].includes(type);
      let effectivelyControlFlow = false;
      let lastOp = op;
      if (op.type === "SEQUENCE") lastOp = op.ops[op.ops.length - 1];

      if (isControlFlowOp(lastOp.type)) {
        effectivelyControlFlow = true;
      } else if (lastOp.type === "CALL") {
        const targetStateId = this._getFuncStateOrFail(
          lastOp.callee,
          "jump check",
        );
        const targetState = this.astGen.states[targetStateId];
        const isStandardInternal =
        !targetState.op.isGenerator && !targetState.op.isAsync;
        if (isStandardInternal) effectivelyControlFlow = true;
      }

      if (!effectivelyControlFlow && next !== null) {
        body.push(assign(S, num(nextMapped, "next state")));
      }

      stateData.push({
        id: mappedId,
        body: t.blockStatement(body),
      });
    }

    // 2. Start the recursive hybrid tree construction
    return this.buildHybridTree(stateData, S);
  }

  // --- Hybrid Tree Builder ---
  // Combines Binary Search, Linear Isolation, Modulo Bucketing, and Ghost branches.
  buildHybridTree(states, S) {
    if (states.length === 0) return t.blockStatement([]);

    // Leaf Node: The base case, execute the state body
    if (states.length === 1) {
      const state = states[0];
      return t.ifStatement(
        t.binaryExpression("===", S, t.numericLiteral(state.id)),
                           state.body,
      );
    }

    // DECISION MATRIX: Choose a strategy for this node
    const rand = Math.random();

    // Strategy 1: GHOST BRANCH (10% chance)
    // Only if we have enough states to hide it.
    // Creates a branch `if (S == random_fake_id)` that contains dead code.
    if (rand < 0.1 && states.length > 5) {
      const fakeId = Math.floor(Math.random() * 90000) + 100000;
      return t.ifStatement(
        t.binaryExpression("===", S, t.numericLiteral(fakeId)),
                           t.blockStatement([t.breakStatement()]), // Dead code
                           this.buildHybridTree(states, S), // Real tree in 'else'
      );
    }

    // Strategy 2: MODULO BUCKETING (20% chance)
    // Breaks linearity by grouping states by (ID % Mod).
    // Creates 'islands' of numbers rather than sequential ranges.
    if (rand < 0.3 && states.length > 4) {
      const modulus = 2 + Math.floor(Math.random() * 2); // Modulo 2 or 3
      const buckets = Array.from({ length: modulus }, () => []);

      states.forEach((state) => {
        // Handle negative IDs for modulo logic
        const key = Math.abs(state.id) % modulus;
        buckets[key].push(state);
      });

      // Filter out empty buckets
      const validBuckets = buckets
      .map((b, i) => ({ i, b }))
      .filter((o) => o.b.length > 0);

      // If mod split failed to separate states, fallback to binary split
      if (validBuckets.length < 2) return this.buildBinarySplit(states, S);

      // Construct nested if-else structure for the buckets
      // Structure: if ((abs(S) % mod) === 0) { ... } else if (...) { ... }
      const buildBucketTree = (index) => {
        if (index >= validBuckets.length) return t.blockStatement([]);

        const { i, b } = validBuckets[index];
        const isLast = index === validBuckets.length - 1;

        const condition = t.binaryExpression(
          "===",
          t.binaryExpression(
            "%",
            t.callExpression(
              t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                             [S],
            ),
            t.numericLiteral(modulus),
          ),
          t.numericLiteral(i),
        );

        if (isLast) {
          // Optimization: If it's the last bucket, just process it.
          // Implicit 'else' handles the "rest".
          return this.buildHybridTree(b, S);
        }

        return t.ifStatement(
          condition,
          this.buildHybridTree(b, S),
                             buildBucketTree(index + 1),
        );
      };

      return buildBucketTree(0);
    }

    // Strategy 3: STATE ISOLATION (20% chance)
    // Pulls one specific state out: "if (S === TARGET_ID) ... else ..."
    // Useful for breaking binary search patterns.
    if (rand < 0.5) {
      // Pick random target to isolate
      const idx = Math.floor(Math.random() * states.length);
      const target = states[idx];
      const others = [...states.slice(0, idx), ...states.slice(idx + 1)];

      return t.ifStatement(
        t.binaryExpression("===", S, t.numericLiteral(target.id)),
                           target.body,
                           this.buildHybridTree(others, S),
      );
    }

    // Strategy 4: BINARY SPLIT (Default 50%)
    // Standard divide and conquer based on ID ranges.
    return this.buildBinarySplit(states, S);
  }

  /**
   * Performs a standard binary split on the states list.
   * Sorts states, picks a pivot, and creates `if (S < PIVOT) { LEFT } else { RIGHT }`.
   */
  buildBinarySplit(states, S) {
    states.sort((a, b) => a.id - b.id);

    // Jagged Split (15% - 85%) to prevent perfectly balanced (easily predictable) trees
    const minSplit = Math.max(1, Math.floor(states.length * 0.15));
    const maxSplit = Math.max(1, Math.floor(states.length * 0.85));
    const splitIndex =
    Math.floor(Math.random() * (maxSplit - minSplit + 1)) + minSplit;
    const actualSplit = Math.max(1, Math.min(states.length - 1, splitIndex));

    const leftSlice = states.slice(0, actualSplit);
    const rightSlice = states.slice(actualSplit);
    const pivot = rightSlice[0].id;

    // Condition Flipping (Obfuscation)
    // Randomly swaps between (S < pivot) and (S >= pivot) logic
    if (Math.random() > 0.5) {
      // Standard: S < Pivot
      return t.ifStatement(
        t.binaryExpression("<", S, t.numericLiteral(pivot)),
                           this.buildHybridTree(leftSlice, S),
                           this.buildHybridTree(rightSlice, S),
      );
    } else {
      // Inverted: S >= Pivot
      return t.ifStatement(
        t.binaryExpression(">=", S, t.numericLiteral(pivot)),
                           this.buildHybridTree(rightSlice, S),
                           this.buildHybridTree(leftSlice, S),
      );
    }
  }
}

module.exports = BSTDispatcher;
