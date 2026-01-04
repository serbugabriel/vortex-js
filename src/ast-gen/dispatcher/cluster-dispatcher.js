/**
 * @file cluster-dispatcher.js
 * @description Implements the "Cluster" dispatcher strategy.
 * Groups states into buckets based on a masked ID (`S ^ SALT`), then dispatches
 * hierarchically. This reduces the size of individual switch statements and
 * breaks linear analysis patterns.
 */

const t = require("@babel/types");
const BaseDispatcher = require("./base-dispatcher");

class ClusterDispatcher extends BaseDispatcher {
  /**
   * Generates the hierarchical dispatch loop.
   * @param {Object} helpers - Context helpers.
   * @returns {Object} The LabeledStatement containing the loop.
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

    // --- CONSTANTS FOR POLYMORPHISM ---
    // A random salt effectively encrypts the Control Flow Graph (CFG) nodes in the switch cases.
    // Static analysis sees random numbers, not the actual sequential IDs.
    const DISPATCH_SALT = Math.floor(Math.random() * 0xfffffff) + 1;
    const BUCKET_COUNT = Math.max(
      3,
      Math.ceil(this.astGen.states.filter(Boolean).length / 5),
    );

    // 1. Prepare State Data
    const stateData = [];
    for (const state of this.astGen.states.filter(Boolean)) {
      const { id, op, next } = state;
      const mappedId = this._getMappedId(id);
      const nextMapped = next !== null ? this._getMappedId(next) : null;

      // Standard opcode generation from BaseDispatcher
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

      // Auto-transition logic
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

      // UPGRADE: Inject "False Dependency" checks to mess with taint analysis
      // Randomly accesses M to look like a read, but does nothing.
      if (Math.random() > 0.7) {
        body.unshift(
          t.expressionStatement(
            t.memberExpression(
              M,
              t.numericLiteral(Math.floor(Math.random() * 10)),
                               true,
            ),
          ),
        );
      }

      body.push(t.breakStatement());

      stateData.push({
        id: mappedId,
        // Pre-calculate the masked ID for the dispatcher to match against
        maskedId: mappedId ^ DISPATCH_SALT,
        body: t.blockStatement(body),
      });
    }

    // 2. Advanced Bucketing Strategy
    // Instead of linear modulo, we use the masked ID to distribute states.
    // This creates "Clusters" of states that are grouped by (MaskedID % BucketCount).
    const buckets = Array.from({ length: BUCKET_COUNT }, () => []);
    stateData.forEach((state) => {
      const bucketIndex = Math.abs(state.maskedId) % BUCKET_COUNT;
      buckets[bucketIndex].push(state);
    });

    // 3. Dispatcher Loop Construction
    const DS = t.identifier("DS"); // Dispatch State (Masked)

    // Define the masking logic: const DS = S ^ SALT;
    const dsInit = t.variableDeclaration("const", [
      t.variableDeclarator(
        DS,
        t.binaryExpression("^", S, t.numericLiteral(DISPATCH_SALT)),
      ),
    ]);

    // Build the recursive dispatcher tree
    const dispatchLogic = this.buildHierarchicalDispatcher(
      buckets,
      DS,
      BUCKET_COUNT,
      0,
    );

    // 4. Wrap in Polymorphic Loop
    // Randomly selects loop type (while / for / do-while) to vary signature.
    const loopLabel = t.identifier("cluster_dispatch");
    let loopStructure;
    const randLoop = Math.random();

    const loopBody = t.blockStatement([
      dsInit, // Re-calculate Masked State every iteration
      dispatchLogic,
    ]);

    if (randLoop < 0.33) {
      // while(true)
      loopStructure = t.whileStatement(t.booleanLiteral(true), loopBody);
    } else if (randLoop < 0.66) {
      // for(;;)
      loopStructure = t.forStatement(null, null, null, loopBody);
    } else {
      // do...while(true)
      loopStructure = t.doWhileStatement(t.booleanLiteral(true), loopBody);
    }

    return t.labeledStatement(loopLabel, loopStructure);
  }

  /**
   * Recursive function to build a tree of buckets.
   * Uses a mix of Binary Search (BST) and Linear scans for the buckets themselves.
   */
  buildHierarchicalDispatcher(buckets, DS, totalBuckets, depth) {
    // Filter empty buckets to keep code clean
    const validBuckets = buckets
    .map((b, i) => ({ i, b }))
    .filter((x) => x.b.length > 0);

    if (validBuckets.length === 0) {
      return t.blockStatement([
        t.breakStatement(t.identifier("cluster_dispatch")),
      ]);
    }

    // Helper to generate the selection logic for a specific bucket
    const generateBucketBlock = (bucketObj) => {
      const { i, b } = bucketObj;
      // Recursively build the internal logic for this bucket (Switch or BST)
      const innerLogic = this.buildBucketInternals(b, DS);

      return t.ifStatement(
        t.binaryExpression(
          "===",
          t.binaryExpression(
            "%",
            t.callExpression(
              t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                             [DS],
            ),
            t.numericLiteral(totalBuckets),
          ),
          t.numericLiteral(i),
        ),
        t.blockStatement([innerLogic]),
      );
    };

    // If few buckets, just chain them (Linear)
    if (validBuckets.length <= 3) {
      let current = t.blockStatement([
        t.breakStatement(t.identifier("cluster_dispatch")),
      ]);
      // Build bottom-up
      for (let k = validBuckets.length - 1; k >= 0; k--) {
        const block = generateBucketBlock(validBuckets[k]);
        // Daisy chain the 'else'
        block.alternate = current;
        current = block;
      }
      return current;
    }

    // If many buckets, split them (BST on the bucket index)
    const mid = Math.floor(validBuckets.length / 2);
    const leftBuckets = validBuckets.slice(0, mid);
    const rightBuckets = validBuckets.slice(mid);
    const pivotIndex = rightBuckets[0].i;

    return t.ifStatement(
      t.binaryExpression(
        "<",
        t.binaryExpression(
          "%",
          t.callExpression(
            t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                           [DS],
          ),
          t.numericLiteral(totalBuckets),
        ),
        t.numericLiteral(pivotIndex),
      ),
      this.buildBucketTreeFromList(leftBuckets, DS, totalBuckets),
                         this.buildBucketTreeFromList(rightBuckets, DS, totalBuckets),
    );
  }

  buildBucketTreeFromList(validBuckets, DS, totalBuckets) {
    if (validBuckets.length === 0) return t.blockStatement([]);
    if (validBuckets.length === 1) {
      const { i, b } = validBuckets[0];
      const inner = this.buildBucketInternals(b, DS);
      return t.ifStatement(
        t.binaryExpression(
          "===",
          t.binaryExpression(
            "%",
            t.callExpression(
              t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                             [DS],
            ),
            t.numericLiteral(totalBuckets),
          ),
          t.numericLiteral(i),
        ),
        t.blockStatement([inner]),
      );
    }

    const mid = Math.floor(validBuckets.length / 2);
    const pivot = validBuckets.slice(mid)[0].i;

    return t.ifStatement(
      t.binaryExpression(
        "<",
        t.binaryExpression(
          "%",
          t.callExpression(
            t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                           [DS],
          ),
          t.numericLiteral(totalBuckets),
        ),
        t.numericLiteral(pivot),
      ),
      this.buildBucketTreeFromList(
        validBuckets.slice(0, mid),
                                   DS,
                                   totalBuckets,
      ),
      this.buildBucketTreeFromList(validBuckets.slice(mid), DS, totalBuckets),
    );
  }

  /**
   * Builds the internal dispatch logic for a single bucket.
   * Randomly chooses between a Switch Statement (O(1)) and a BST (O(log N))
   * to prevent consistent signature recognition.
   */
  buildBucketInternals(states, DS) {
    // UPGRADE: Dynamic Ghost Branch Injection
    // 15% chance to inject a completely unreachable "Ghost State" to fluff code density
    if (Math.random() < 0.15) {
      const ghostId = Math.floor(Math.random() * 900000) + 100000;
      states.push({
        maskedId: ghostId, // This ID is likely never reachable
        body: t.blockStatement([
          t.expressionStatement(
            t.binaryExpression("+", DS, t.numericLiteral(1)),
          ), // Junk math
          t.breakStatement(t.identifier("cluster_dispatch")),
        ]),
      });
    }

    const useSwitch = Math.random() > 0.5 || states.length > 5;

    if (useSwitch) {
      const cases = states.map((state) => {
        // Notice: We switch on DS (The masked state), so cases must use maskedId
        return t.switchCase(t.numericLiteral(state.maskedId), [state.body]);
      });

      // Shuffle cases for randomness
      cases.sort(() => Math.random() - 0.5);

      // Add a default case that breaks the loop (safety)
      cases.push(
        t.switchCase(null, [
          t.breakStatement(t.identifier("cluster_dispatch")),
        ]),
      );

      return t.switchStatement(DS, cases);
    } else {
      // Use Binary Search Tree for internal dispatch
      return this.buildInternalBST(states, DS);
    }
  }

  buildInternalBST(states, DS) {
    if (states.length === 0) return t.blockStatement([]);

    // Sort by maskedId for BST construction
    states.sort((a, b) => a.maskedId - b.maskedId);

    if (states.length === 1) {
      const state = states[0];
      return t.ifStatement(
        t.binaryExpression("===", DS, t.numericLiteral(state.maskedId)),
                           state.body,
      );
    }

    const mid = Math.floor(states.length / 2);
    const left = states.slice(0, mid);
    const right = states.slice(mid);
    const pivot = right[0].maskedId;

    // Randomize the operator order ( < vs >= ) for more signature variance
    if (Math.random() > 0.5) {
      return t.ifStatement(
        t.binaryExpression("<", DS, t.numericLiteral(pivot)),
                           this.buildInternalBST(left, DS),
                           this.buildInternalBST(right, DS),
      );
    } else {
      return t.ifStatement(
        t.binaryExpression(">=", DS, t.numericLiteral(pivot)),
                           this.buildInternalBST(right, DS),
                           this.buildInternalBST(left, DS),
      );
    }
  }

  // --- Helpers ---

  _obscureLiteral(value) {
    if (Math.random() > 0.5) return t.numericLiteral(value);
    // Transform literal into a small expression: (val + diff) - diff
    const diff = Math.floor(Math.random() * 50);
    return t.binaryExpression(
      "-",
      t.numericLiteral(value + diff),
                              t.numericLiteral(diff),
    );
  }
}

module.exports = ClusterDispatcher;
