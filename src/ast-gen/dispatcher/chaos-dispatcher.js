/**
 * @file chaos-dispatcher.js
 * @description Implements the "Chaos" dispatcher strategy.
 * This is the most aggressive obfuscation level. It employs:
 * 1. Control Flow Graph Expansion (Aliasing, Trampolines).
 * 2. State Variable Splitting ("Horcrux" variables K1, K2, K3).
 * 3. Polymorphic Dispatch Trees (Bitwise, Modulo, Opaque Predicates).
 * 4. Anti-Tamper "Honey Pots".
 */

const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const BaseDispatcher = require("./base-dispatcher");

class ChaosDispatcher extends BaseDispatcher {
  /**
   * Generates the chaotic dispatch loop.
   * @param {Object} helpers - Context helpers.
   * @returns {Object} The BlockStatement containing the full dispatcher logic.
   */
  generate(helpers) {
    const { M, S, GlobalM, RET_IDX, Ctx } = helpers;

    // --- CHAOS CONFIGURATION ---
    const CHAOS_SALT = Math.floor(Math.random() * 0xfffffff) + 1;
    const TRAMPOLINE_CHANCE = 0.25; // Chance to insert useless hops
    const ALIAS_CHANCE = 0.2; // Chance to duplicate a state's entry point
    const SPLIT_VARS_COUNT = 3; // The "Horcrux" count (splitting S into 3 vars)

    // 1. Initialize Graph & Virtual States
    const originalStates = this.astGen.states.filter(Boolean);
    const activeStates = [];
    const targetMap = new Map(); // Maps OriginalID -> [Original, Alias1, Alias2...]

    const generateSafeId = () => {
      let id;
      do {
        id = Math.floor(Math.random() * 2000000) + 100000;
      } while (this.astGen.stateMapping.has(id));
      return id;
    };

    // Phase 1: Expansion (Aliasing & Trampolines)
    // Inflates the number of states to confuse CFG analysis tools.
    originalStates.forEach((state) => {
      if (!targetMap.has(state.id)) targetMap.set(state.id, [state.id]);
      activeStates.push(state);

      // TRAMPOLINE: Inject an intermediate no-op state that just jumps to the real target.
      if (state.next !== null && Math.random() < TRAMPOLINE_CHANCE) {
        const trampolineId = generateSafeId();
        const originalNext = state.next;

        const trampolineState = {
          id: trampolineId,
          op: { type: "NOOP" },
          next: originalNext,
          isTrampoline: true,
        };
        activeStates.push(trampolineState);
        // Hijack the current state to point to the trampoline
        state._forceNext = trampolineId;
      }

      // ALIAS: Clone the node to create multiple entry points to the same logic.
      if (Math.random() < ALIAS_CHANCE) {
        const aliasId = generateSafeId();
        const aliasState = { ...state, id: aliasId, isAlias: true };
        activeStates.push(aliasState);
        targetMap.get(state.id).push(aliasId);
      }
    });

    // 2. State Mapping & Logic Generation
    const stateData = [];

    // "Horcrux" Variables: K1, K2, K3
    // S is never used directly in the final dispatch check. It is reconstructed from K1^K2^K3.
    const K_VARS = Array.from({ length: SPLIT_VARS_COUNT }, (_, i) =>
    t.identifier(`_K${i}`),
    );

    for (const state of activeStates) {
      const { id, op } = state;

      // Resolve Next State (Handling Trampolines/Aliases)
      let rawNext =
      state._forceNext !== undefined ? state._forceNext : state.next;

      // Randomly pick one of the available aliases for the target
      if (rawNext !== null && targetMap.has(rawNext)) {
        const options = targetMap.get(rawNext);
        rawNext = options[Math.floor(Math.random() * options.length)];
      }

      // Map IDs (Virtual IDs bypass mapping, standard IDs get mapped)
      const isVirtual = state.isTrampoline || state.isAlias;
      const currentMappedId = isVirtual ? id : this._getMappedId(id);
      const nextMappedId =
      rawNext !== null
      ? rawNext > 99999
      ? rawNext // Virtual ID (already safe)
      : this._getMappedId(rawNext) // Standard ID
      : null;

      // Helpers (Context-Aware)
      const getMem = (varName, ctx) =>
      this._getMemOrFail(varName, `State ${id}: ${ctx}`);
      const mem = (varName, ctx) => {
        const idx = getMem(varName, ctx);
        const targetArray = this.astGen.globalIds.has(idx) ? GlobalM : M;
        return t.memberExpression(targetArray, t.numericLiteral(idx), true);
      };
      const assign = (left, right) =>
      t.expressionStatement(t.assignmentExpression("=", left, right));
      const resolveArgs = (argList) =>
      argList.map((arg) => {
        if (typeof arg === "object" && arg.spreadVar)
          return t.spreadElement(mem(arg.spreadVar, "spread"));
        if (typeof arg === "object" && arg.literal !== undefined)
          return typeof arg.literal === "string"
          ? this._createStringAccess(arg.literal)
          : t.valueToNode(arg.literal);
        return mem(arg, "arg");
      });

      const opHelpers = {
        ...helpers,
        nextMapped: nextMappedId,
        resolveArgs,
        assign,
        mem,
        num: (v) => t.numericLiteral(v),
        t,
        _RET_IDX: RET_IDX,
      };

      const bodyStmts = this.generateOpCode(op, opHelpers);

      // Handle Auto-Transitions (fallthrough)
      const isControlFlowOp = [
        "COND_JUMP",
        "RETURN",
        "THROW",
        "HALT",
        "YIELD",
        "AWAIT",
        "FINALLY_DISPATCH",
      ].includes(op.type);
      const lastOp = op.type === "SEQUENCE" ? op.ops[op.ops.length - 1] : op;
      let needsAutoTrans = !isControlFlowOp && nextMappedId !== null;

      if (lastOp.type === "CALL") {
        const targetStateId = this._getFuncStateOrFail(
          lastOp.callee,
          "jump check",
        );
        const targetState = this.astGen.states[targetStateId];
        if (!targetState.op.isGenerator && !targetState.op.isAsync) {
          needsAutoTrans = false; // Standard calls handle their own flow
        }
      }

      if (needsAutoTrans) {
        bodyStmts.push(assign(S, t.numericLiteral(nextMappedId)));
      }

      // --- PHASE 3: HORCRUX INJECTION ---
      // Transform all assignments to S into chaotic updates of K1, K2, K3
      // We rewrite the generated bodyStmts to intercept S updates.
      const wrappedBody = t.blockStatement(bodyStmts);

      // We use a manual visitor here to find S assignments
      const newBody = [];
      const processNode = (node) => {
        if (
          t.isExpressionStatement(node) &&
          t.isAssignmentExpression(node.expression) &&
          t.isIdentifier(node.expression.left) &&
          node.expression.left.name === S.name
        ) {
          // Found "S = X" or "S ^= X"
          const operator = node.expression.operator;
          const right = node.expression.right;

          // If standard assignment "S = val"
          if (operator === "=") {
            // Generate split update:
            // K1 = rand1;
            // K2 = rand2;
            // K3 = val ^ K1 ^ K2;
            // S = val; (Keep S synced for VM compatibility with CALL/RET)
            const rand1 = Math.floor(Math.random() * 0xfffffff);
            const rand2 = Math.floor(Math.random() * 0xfffffff);

            const k1Update = t.expressionStatement(
              t.assignmentExpression("=", K_VARS[0], t.numericLiteral(rand1)),
            );
            const k2Update = t.expressionStatement(
              t.assignmentExpression("=", K_VARS[1], t.numericLiteral(rand2)),
            );

            const k3Val = t.binaryExpression(
              "^",
              t.binaryExpression("^", right, t.numericLiteral(rand1)),
                                             t.numericLiteral(rand2),
            );
            const k3Update = t.expressionStatement(
              t.assignmentExpression("=", K_VARS[2], k3Val),
            );

            const sSync = t.expressionStatement(
              t.assignmentExpression("=", S, right),
            );

            newBody.push(k1Update, k2Update, k3Update, sSync);
          }
          // If delta assignment "S ^= val" (from relative jumps)
          else if (operator === "^=") {
            // Logic: S is changing by Delta.
            // We just update ONE random K variable by Delta.
            // S ^= Delta  <=>  (K1^K2^K3) ^= Delta  <=>  K1 ^= Delta
            const kIdx = Math.floor(Math.random() * SPLIT_VARS_COUNT);
            const kUpdate = t.expressionStatement(
              t.assignmentExpression("^=", K_VARS[kIdx], right),
            );
            const sUpdate = node; // S ^= val

            // Order: Update K, then Update S
            newBody.push(kUpdate, sUpdate);
          } else {
            newBody.push(node);
          }
        } else if (t.isIfStatement(node)) {
          // Recurse for If blocks (simple recursion for flat lists)
          // Note: Shallow replacement for demonstration.
          // In production, a full traversal would be needed.
          newBody.push(node);
        } else {
          newBody.push(node);
        }
      };

      // Traverse logic is simpler if we just iterate standard blocks
      wrappedBody.body.forEach(processNode);

      // Append Break
      newBody.push(t.breakStatement());

      stateData.push({
        maskedId: currentMappedId ^ CHAOS_SALT, // Pre-salt the ID for the dispatcher
        body: t.blockStatement(newBody),
      });
    }

    // 4. Build the Loop Structure
    // K_VARS Declarations (Top of VM or Loop)
    const kVarsDecl = t.variableDeclaration(
      "let",
      K_VARS.map((k) => t.variableDeclarator(k, t.numericLiteral(0))),
    );

    // Initial Split Logic (Runs once before loop, splits S into K1/K2/K3)
    // K1 = rand, K2 = rand, K3 = S ^ K1 ^ K2
    const initRand1 = Math.floor(Math.random() * 0xfffffff);
    const initRand2 = Math.floor(Math.random() * 0xfffffff);

    const initSplit = [
      t.expressionStatement(
        t.assignmentExpression("=", K_VARS[0], t.numericLiteral(initRand1)),
      ),
      t.expressionStatement(
        t.assignmentExpression("=", K_VARS[1], t.numericLiteral(initRand2)),
      ),
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          K_VARS[2],
          t.binaryExpression(
            "^",
            t.binaryExpression("^", S, t.numericLiteral(initRand1)),
                             t.numericLiteral(initRand2),
          ),
        ),
      ),
    ];

    // Loop Start: Re-sync (Case of yield/await resume where S is restored but Ks are 0)
    // If (K1^K2^K3 !== S) { Re-Split }
    const combinedK = t.binaryExpression(
      "^",
      t.binaryExpression("^", K_VARS[0], K_VARS[1]),
                                         K_VARS[2],
    );

    const resyncLogic = t.ifStatement(
      t.binaryExpression("!==", combinedK, S),
                                      t.blockStatement([
                                        t.expressionStatement(
                                          t.assignmentExpression("=", K_VARS[0], t.numericLiteral(initRand1)),
                                        ),
                                        t.expressionStatement(
                                          t.assignmentExpression("=", K_VARS[1], t.numericLiteral(initRand2)),
                                        ),
                                        t.expressionStatement(
                                          t.assignmentExpression(
                                            "=",
                                            K_VARS[2],
                                            t.binaryExpression(
                                              "^",
                                              t.binaryExpression("^", S, t.numericLiteral(initRand1)),
                                                               t.numericLiteral(initRand2),
                                            ),
                                          ),
                                        ),
                                      ]),
    );

    // Dispatcher Calculation: Current = (K1 ^ K2 ^ K3) ^ SALT
    const CurrentState = t.identifier("CS");
    const csInit = t.variableDeclaration("const", [
      t.variableDeclarator(
        CurrentState,
        t.binaryExpression("^", combinedK, t.numericLiteral(CHAOS_SALT)),
      ),
    ]);

    // Build the Tree
    const dispatchTree = this.buildEvilTree(stateData, CurrentState, M);

    const loopBody = t.blockStatement([resyncLogic, csInit, dispatchTree]);

    const loopLabel = t.identifier("chaos_loop");

    return t.blockStatement([
      kVarsDecl,
      ...initSplit,
      t.labeledStatement(
        loopLabel,
        t.whileStatement(t.booleanLiteral(true), loopBody),
      ),
    ]);
  }

  /**
   * The Evil Tree Builder.
   * Constructs a polymorphic decision tree using Opaque Predicates,
   * Modulo Bucketing, and Bitwise Partitioning to hide the control flow.
   */
  buildEvilTree(states, CS, M) {
    if (states.length === 0) return t.blockStatement([]);

    // 1. OPAQUE PREDICATE MINEFIELD (15% Chance)
    // Injects a fake branch that looks reachable but isn't.
    // The 'fakeBlock' contains malicious code (e.g., infinite loop or memory corruption).
    if (Math.random() < 0.15 && states.length > 3) {
      const fakeBlock = this.generateHoneyPot(M);
      const predicate = this.generateOpaquePredicate();
      return t.ifStatement(
        predicate,
        fakeBlock,
        this.buildEvilTree(states, CS, M),
      );
    }

    if (states.length === 1) {
      const state = states[0];
      return t.ifStatement(
        t.binaryExpression("===", CS, t.numericLiteral(state.maskedId)),
                           state.body,
      );
    }

    // Sort for partitioning
    states.sort((a, b) => a.maskedId - b.maskedId);
    const count = states.length;
    const strategy = Math.random();

    // Strategy A: Bitwise Partition (Split by specific bit on/off)
    // Checks if (CS & mask) !== 0
    if (count > 6 && strategy > 0.6) {
      for (let bit = 0; bit < 31; bit++) {
        const mask = 1 << bit;
        const on = states.filter((s) => (s.maskedId & mask) !== 0);
        const off = states.filter((s) => (s.maskedId & mask) === 0);

        // Only use if split is somewhat balanced
        if (on.length > count * 0.2 && off.length > count * 0.2) {
          return t.ifStatement(
            t.binaryExpression(
              "!==",
              t.binaryExpression("&", CS, t.numericLiteral(mask)),
                               t.numericLiteral(0),
            ),
            this.buildEvilTree(on, CS, M),
                               this.buildEvilTree(off, CS, M),
          );
        }
      }
    }

    // Strategy B: Modulo Grouping (Islands of numbers)
    // Checks (abs(CS) % mod) === i
    if (count > 4 && strategy > 0.3) {
      const mod = 3 + Math.floor(Math.random() * 3);
      const buckets = Array.from({ length: mod }, () => []);
      states.forEach((s) => buckets[Math.abs(s.maskedId) % mod].push(s));

      let root = null;
      for (let i = mod - 1; i >= 0; i--) {
        if (buckets[i].length === 0) continue;

        const condition = t.binaryExpression(
          "===",
          t.binaryExpression(
            "%",
            t.callExpression(
              t.memberExpression(t.identifier("Math"), t.identifier("abs")),
                             [CS],
            ),
            t.numericLiteral(mod),
          ),
          t.numericLiteral(i),
        );

        const inner = this.buildEvilTree(buckets[i], CS, M);
        if (root === null) root = inner;
        else root = t.ifStatement(condition, inner, root);
      }
      return root || t.blockStatement([]);
    }

    // Strategy C: Binary Search (Fallback)
    const mid = Math.floor(count / 2);
    const pivot = states[mid].maskedId;

    if (Math.random() > 0.5) {
      return t.ifStatement(
        t.binaryExpression("<", CS, t.numericLiteral(pivot)),
                           this.buildEvilTree(states.slice(0, mid), CS, M),
                           this.buildEvilTree(states.slice(mid), CS, M),
      );
    } else {
      return t.ifStatement(
        t.binaryExpression(">=", CS, t.numericLiteral(pivot)),
                           this.buildEvilTree(states.slice(mid), CS, M),
                           this.buildEvilTree(states.slice(0, mid), CS, M),
      );
    }
  }

  /**
   * Generates an Opaque Predicate (Always False expression).
   */
  generateOpaquePredicate() {
    // Generates mathematically constant expressions that look dynamic
    // e.g., (x | y) - (x & y) !== (x ^ y) [Always False]
    const types = ["math_identity", "logic_identity"];
    const type = types[Math.floor(Math.random() * types.length)];

    if (type === "math_identity") {
      const A = t.numericLiteral(Math.floor(Math.random() * 100));
      const B = t.identifier("CS"); // Uses the state variable
      return t.binaryExpression(
        "!==",
        t.binaryExpression(
          "-",
          t.binaryExpression("|", A, B),
                           t.binaryExpression("&", A, B),
        ),
        t.binaryExpression("^", A, B),
      );
    }
    // 1 === 0
    return t.binaryExpression("===", t.numericLiteral(1), t.numericLiteral(0));
  }

  /**
   * Generates a "Honey Pot" block (Traps/Dead Ends).
   */
  generateHoneyPot(M) {
    // Generates a block that corrupts memory or hangs.
    const idx = Math.floor(Math.random() * 50);
    return t.blockStatement([
      t.expressionStatement(
        t.assignmentExpression(
          "+=",
          t.memberExpression(M, t.numericLiteral(idx), true),
                               t.numericLiteral(1),
        ),
      ),
      t.whileStatement(t.booleanLiteral(true), t.blockStatement([])), // Infinite Loop
                            t.breakStatement(),
    ]);
  }
}

module.exports = ChaosDispatcher;
