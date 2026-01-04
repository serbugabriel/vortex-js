/**
 * @fileoverview Advanced Intermediate Representation (IR) Optimizer.
 * Part of the compiler pipeline responsible for lowering IR complexity and
 * improving execution efficiency through multiple optimization passes.
 */

const t = require("@babel/types");

/**
 * Advanced IR Optimizer (Level 3?).
 *
 * Implements sophisticated compiler optimization techniques including:
 * - Global Data-Flow Analysis (Dead Store Elimination)
 * - Expression Reassociation (Mathematical simplification)
 * - Control Flow Graph (CFG) Simplification (Jump threading, block merging)
 * - Local Common Subexpression Elimination (CSE)
 * - Tail Call Optimization (TCO)
 * - Transactional Integrity (Automatic rollback on invalid transformations)
 */
class IROptimizer {
  /**
   * @param {Object} context The optimization context.
   * @param {Array} context.states The flat list of IR state objects.
   * @param {Map} context.memoryMap Mapping of variable names to memory indices.
   * @param {Map} context.functionStartStates Mapping of function names to entry state IDs.
   * @param {number} [context.maxSuperblockSize=2] Maximum ops to merge into a single SEQUENCE.
   */
  constructor(context) {
    this.states = context.states;
    this.memoryMap = context.memoryMap;
    this.functionStartStates = context.functionStartStates;
    this.tempVarRegex = /^_temp\$\d+$/;

    // Configuration for Superblock merging (Basic Block coalescing)
    this.maxSuperblockSize = context.maxSuperblockSize || 2;

    // Build reverse lookup for memory analysis
    this.reverseMemoryMap = new Map();
    for (const [name, index] of this.memoryMap.entries()) {
      if (!this.reverseMemoryMap.has(index)) {
        this.reverseMemoryMap.set(index, []);
      }
      this.reverseMemoryMap.get(index).push(name);
    }

    // Performance and tracking statistics
    this.stats = {
      opsFolded: 0,
      branchesPruned: 0,
      blocksMerged: 0,
      strengthReduced: 0,
      jumpsThreaded: 0,
      cseEliminated: 0,
      mathReassociated: 0,
      globalDeadStores: 0,
      speculationsRolledBack: 0,
    };
  }

  /**
   * Executes the optimization pipeline.
   * Runs multiple passes until reaching a fixed point or the MAX_PASSES limit.
   * @returns {number} Total number of optimizations performed.
   */
  run() {
    let hasChanges;
    let passCount = 0;
    const MAX_PASSES = 25;

    // Initial cleanup of unreachable nodes
    this.removeUnreachableStates();

    do {
      hasChanges = false;
      passCount++;
      const prevTotal = this.getTotalOptimizations();

      // --- Phase 1: Local Reductions (Statement Level) ---
      this.performTransaction("Constant Folding", () =>
        this.performConstantFolding(),
      );
      this.performTransaction("Boolean Logic", () =>
        this.performBooleanLogicOptimization(),
      );
      this.performTransaction("Strength Reduction", () =>
        this.performStrengthReduction(),
      );
      this.performTransaction("Local CSE", () => this.performLocalCSE());
      this.performTransaction("Expression Reassociation", () =>
        this.performExpressionReassociation(),
      );

      // --- Phase 2: Global Data-Flow Analysis ---
      this.performTransaction("Global DCE", () =>
        this.performGlobalDeadStoreElimination(),
      );

      // --- Phase 3: Control Flow Simplification ---
      this.performTransaction("Branch Pruning", () =>
        this.removeRedundantBranches(),
      );
      this.performTransaction("Jump Threading", () =>
        this.performJumpThreading(),
      );

      // --- Phase 4: Structural Transformations ---
      this.performTransaction("TCO", () => this.performTailCallOptimization());
      this.performTransaction("Block Merging", () =>
        this.performBlockMerging(),
      );

      // Propagation and cleanup
      this.performTransaction("Copy Propagation", () => {
        const res = this.propagateAssignmentsToSuccessors();
        if (res.mergedCount > 0) {
          this.remapStateTransitions(res.redirects);
          this.removeDeadStates();
          return res.mergedCount;
        }
        return 0;
      });

      this.performTransaction("Goto Optimization", () => {
        const res = this.optimizeGotos();
        if (res.mergedCount > 0) {
          this.remapStateTransitions(res.redirects);
          this.removeDeadStates();
          return res.mergedCount;
        }
        return 0;
      });

      this.performTransaction("Cleanup", () => {
        return this.removeIdentityAssignments();
      });

      // Check if this pass resulted in any progress
      if (this.getTotalOptimizations() > prevTotal) {
        hasChanges = true;
      }
    } while (hasChanges && passCount < MAX_PASSES);

    // Final graph compaction
    this.removeUnreachableStates();
    this.removeDeadStates();

    return this.getTotalOptimizations();
  }

  /** @returns {number} Sum of all successful optimization counts. */
  getTotalOptimizations() {
    return Object.values(this.stats).reduce((a, b) => a + b, 0);
  }

  /**
   * Executes an optimization pass within a transaction.
   * If the pass violates graph integrity, it rolls back the state.
   * @param {string} name Optimization name for stats tracking.
   * @param {Function} optimizationFn Logic to execute.
   */
  performTransaction(name, optimizationFn) {
    const snapshot = JSON.stringify(this.states);
    try {
      const count = optimizationFn();
      if (count > 0) {
        // Validation: Ensure no jumps point to non-existent or DEAD states
        if (!this.verifyGraphIntegrity()) {
          throw new Error(`Graph Integrity Check Failed after ${name}`);
        }

        // Log results to stats
        this.updateStats(name, count);
        return count;
      }
    } catch (e) {
      // Rollback to previous known good state
      this.states = JSON.parse(snapshot);
      this.stats.speculationsRolledBack++;
    }
    return 0;
  }

  /** Internal helper to map pass names to statistic counters. */
  updateStats(name, count) {
    const mapping = {
      "Constant Folding": "opsFolded",
      "Boolean Logic": "opsFolded",
      "Strength Reduction": "strengthReduced",
      "Local CSE": "cseEliminated",
      "Expression Reassociation": "mathReassociated",
      "Global DCE": "globalDeadStores",
      "Branch Pruning": "branchesPruned",
      "Jump Threading": "jumpsThreaded",
      "Block Merging": "blocksMerged",
    };
    if (mapping[name]) this.stats[mapping[name]] += count;
  }

  /**
   * Validates that all state transitions (next, target, trueState, falseState)
   * point to valid, non-dead indices.
   */
  verifyGraphIntegrity() {
    const validIds = new Set(
      this.states.filter((s) => s && s.op.type !== "DEAD").map((s) => s.id),
    );
    for (const startId of this.functionStartStates.values()) {
      if (!validIds.has(startId)) return false;
    }
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      if (state.next !== null && !validIds.has(state.next)) return false;
      const op = state.op;
      const ops = op.type === "SEQUENCE" ? op.ops : [op];
      for (const subOp of ops) {
        if (subOp.type === "GOTO" && !validIds.has(subOp.target)) return false;
        if (
          subOp.type === "COND_JUMP" &&
          (!validIds.has(subOp.trueState) || !validIds.has(subOp.falseState))
        )
          return false;
        if (subOp.type === "PUSH_CATCH_HANDLER" && !validIds.has(subOp.target))
          return false;
      }
    }
    return true;
  }

  /**
   * Eliminates assignments to temporary variables that are never read.
   */
  performGlobalDeadStoreElimination() {
    const globalUsage = new Map();
    const register = (val) => {
      if (typeof val === "string" && this.tempVarRegex.test(val)) {
        globalUsage.set(val, (globalUsage.get(val) || 0) + 1);
      }
    };

    // First pass: Count all variable usages
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];

      ops.forEach((subOp) => {
        if (subOp.from) register(subOp.from);
        if (subOp.left) register(subOp.left);
        if (subOp.right) register(subOp.right);
        if (subOp.testVar) register(subOp.testVar);
        if (subOp.argument) register(subOp.argument);
        if (subOp.callee && typeof subOp.callee === "string")
          register(subOp.callee);
        if (subOp.instance) register(subOp.instance);
        if (subOp.object) register(subOp.object);
        if (
          subOp.property &&
          typeof subOp.property === "string" &&
          subOp.type.includes("COMPUTED")
        )
          register(subOp.property);
        if (subOp.value && typeof subOp.value === "string")
          register(subOp.value);
        if (subOp.valueVar) register(subOp.valueVar);
        if (subOp.promiseVar) register(subOp.promiseVar);

        if (subOp.args)
          subOp.args.forEach((a) =>
            typeof a === "string"
              ? register(a)
              : a?.spreadVar && register(a.spreadVar),
          );
        if (subOp.elements)
          subOp.elements.forEach((e) =>
            typeof e === "string"
              ? register(e)
              : e?.spreadVar && register(e.spreadVar),
          );
        if (subOp.properties)
          subOp.properties.forEach((p) => {
            if (p.keyVar) register(p.keyVar);
            if (p.valueVar) register(p.valueVar);
            if (p.spreadVar) register(p.spreadVar);
          });

        if (subOp.type === "EXECUTE_STATEMENT" && subOp.statement)
          this.scanASTForUsage(subOp.statement, globalUsage);
        if (
          subOp.type === "ASSIGN_LITERAL_DIRECT" &&
          subOp.value &&
          typeof subOp.value === "object"
        )
          this.scanASTForUsage(subOp.value, globalUsage);
      });
    }

    // Second pass: Remove assignments with 0 usage
    let removedCount = 0;
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      if (state.op.type === "SEQUENCE") {
        const newOps = [];
        let modified = false;
        for (const subOp of state.op.ops) {
          if (this.isDeadAssignment(subOp, globalUsage)) {
            newOps.push({ type: "NOOP" });
            modified = true;
            removedCount++;
          } else {
            newOps.push(subOp);
          }
        }
        if (modified) state.op.ops = newOps;
        continue;
      }

      if (this.isDeadAssignment(state.op, globalUsage)) {
        state.op =
          state.next !== null
            ? { type: "GOTO", target: state.next }
            : { type: "NOOP" };
        removedCount++;
      }
    }
    return removedCount;
  }

  /** Helper to identify if an operation is an assignment to an unused temporary. */
  isDeadAssignment(op, usageMap) {
    const safeTypes = ["ASSIGN", "ASSIGN_LITERAL", "ASSIGN_LITERAL_DIRECT"];
    if (!safeTypes.includes(op.type)) return false;
    if (!op.to || !this.tempVarRegex.test(op.to)) return false;
    return !usageMap.has(op.to);
  }

  /**
   * Reassociates linear mathematical chains to simplify constants.
   * e.g., (x + 1) + 2 => x + 3
   */
  performExpressionReassociation() {
    let count = 0;
    for (const state of this.states) {
      if (!state || state.op.type !== "SEQUENCE") continue;
      const ops = state.op.ops;
      const chains = new Map();

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.type === "BINARY" && op.to && this.tempVarRegex.test(op.to)) {
          const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);

          if (op.op === "+" && isInt(op.right)) {
            if (typeof op.left === "string" && chains.has(op.left)) {
              const prev = chains.get(op.left);
              if (prev.op === "+") {
                const newOffset = prev.offset + op.right;
                op.left = prev.base;
                op.right = newOffset;
                chains.set(op.to, {
                  base: prev.base,
                  offset: newOffset,
                  op: "+",
                });
                count++;
                continue;
              }
            } else if (typeof op.left === "string") {
              chains.set(op.to, { base: op.left, offset: op.right, op: "+" });
            }
          } else if (op.op === "-" && isInt(op.right)) {
            if (typeof op.left === "string" && chains.has(op.left)) {
              const prev = chains.get(op.left);
              if (prev.op === "-") {
                const newOffset = prev.offset + op.right;
                op.left = prev.base;
                op.right = newOffset;
                chains.set(op.to, {
                  base: prev.base,
                  offset: newOffset,
                  op: "-",
                });
                count++;
                continue;
              } else if (prev.op === "+") {
                const newOffset = prev.offset - op.right;
                op.left = prev.base;
                op.right = newOffset;
                op.op = "+";
                chains.set(op.to, {
                  base: prev.base,
                  offset: newOffset,
                  op: "+",
                });
                count++;
                continue;
              }
            } else if (typeof op.left === "string") {
              chains.set(op.to, { base: op.left, offset: op.right, op: "-" });
            }
          }
        }
      }
    }
    return count;
  }

  /**
   * Collapses chains of jumps (jumps to jumps).
   */
  performJumpThreading() {
    let count = 0;
    const resolveTarget = (startId, visited = new Set()) => {
      if (visited.has(startId)) return startId;
      visited.add(startId);
      const state = this.states[startId];
      if (!state || state.op.type === "DEAD") return startId;

      let isTrampoline = false;
      let target = null;

      if (state.op.type === "GOTO") {
        isTrampoline = true;
        target = state.op.target;
      } else if (state.op.type === "NOOP" && state.next !== null) {
        isTrampoline = true;
        target = state.next;
      } else if (state.op.type === "SEQUENCE") {
        const isAllNoop = state.op.ops.every(
          (o) => o.type === "NOOP" || o.type === "GOTO",
        );
        if (isAllNoop) {
          const lastOp = state.op.ops[state.op.ops.length - 1];
          if (lastOp?.type === "GOTO") {
            isTrampoline = true;
            target = lastOp.target;
          } else if (state.next !== null) {
            isTrampoline = true;
            target = state.next;
          }
        }
      }

      if (isTrampoline && target !== null && target !== startId) {
        return resolveTarget(target, visited);
      }
      return startId;
    };

    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      if (state.next !== null) {
        const ultimate = resolveTarget(state.next);
        if (ultimate !== state.next) {
          state.next = ultimate;
          count++;
        }
      }
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.type === "GOTO") {
          const ultimate = resolveTarget(op.target);
          if (ultimate !== op.target) {
            op.target = ultimate;
            if (state.op.type !== "SEQUENCE") state.next = ultimate;
            count++;
          }
        } else if (op.type === "COND_JUMP") {
          const trueUlt = resolveTarget(op.trueState);
          const falseUlt = resolveTarget(op.falseState);
          if (trueUlt !== op.trueState) {
            op.trueState = trueUlt;
            count++;
          }
          if (falseUlt !== op.falseState) {
            op.falseState = falseUlt;
            count++;
          }
        }
      }
    }
    return count;
  }

  /**
   * Eliminates redundant calculations within a single block (SEQUENCE).
   */
  performLocalCSE() {
    let count = 0;
    for (const state of this.states) {
      if (!state || state.op.type !== "SEQUENCE") continue;
      const ops = state.op.ops;
      const expressions = new Map(); // Map<Key, VarName>

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        // Invalidate expressions if their components are reassigned
        if (op.to) {
          const toKill = op.to;
          for (const key of expressions.keys()) {
            if (key.includes(`:${toKill}:`) || key.endsWith(`:${toKill}`)) {
              expressions.delete(key);
            }
          }
        }

        let key = null;
        if (op.type === "BINARY")
          key = `BINARY:${op.op}:${op.left}:${op.right}`;
        else if (op.type === "UNARY") key = `UNARY:${op.op}:${op.argument}`;

        if (key) {
          if (expressions.has(key)) {
            const existingVar = expressions.get(key);
            ops[i] = { type: "ASSIGN", to: op.to, from: existingVar };
            count++;
          } else if (op.to && this.tempVarRegex.test(op.to)) {
            expressions.set(key, op.to);
          }
        }
      }
    }
    return count;
  }

  /** Simplifies boolean operations with known literal inputs. */
  performBooleanLogicOptimization() {
    let count = 0;
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.type === "BINARY") {
          if (op.op === "||" && op.left === true) {
            Object.assign(op, { type: "ASSIGN_LITERAL", value: true });
            count++;
          } else if (op.op === "||" && op.left === false) {
            Object.assign(op, { type: "ASSIGN", from: op.right });
            count++;
          } else if (op.op === "&&" && op.left === true) {
            Object.assign(op, { type: "ASSIGN", from: op.right });
            count++;
          } else if (op.op === "&&" && op.left === false) {
            Object.assign(op, { type: "ASSIGN_LITERAL", value: false });
            count++;
          }
        }
      }
    }
    return count;
  }

  /**
   * Replaces expensive operations with cheaper ones (e.g., x * 1 => x).
   */
  performStrengthReduction() {
    let count = 0;
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD" || state.op.type === "SEQUENCE")
        continue;
      const op = state.op;
      if (op.type === "BINARY") {
        if (
          (op.op === "*" && (op.right === 1 || op.left === 1)) ||
          (op.op === "+" && op.right === 0) ||
          (op.op === "-" && op.right === 0) ||
          (op.op === "|" && op.right === 0)
        ) {
          state.op = {
            type: "ASSIGN",
            to: op.to,
            from: op.op === "*" && op.left === 1 ? op.right : op.left,
          };
          count++;
        } else if (
          op.op === "-" &&
          op.left === op.right &&
          typeof op.left === "string"
        ) {
          state.op = { type: "ASSIGN_LITERAL", to: op.to, value: 0 };
          count++;
        }
      } else if (
        op.type === "UNARY" &&
        op.op === "!" &&
        typeof op.argument === "boolean"
      ) {
        state.op = { type: "ASSIGN_LITERAL", to: op.to, value: !op.argument };
        count++;
      }
    }
    return count;
  }

  /**
   * Evaluates expressions at compile-time if all operands are constants.
   */
  performConstantFolding() {
    let count = 0;
    const knownValues = new Map();
    const assignmentCounts = new Map();
    const taintedVars = new Set();

    // Pass 1: Analyze variable stability
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.to && this.tempVarRegex.test(op.to)) {
          assignmentCounts.set(op.to, (assignmentCounts.get(op.to) || 0) + 1);
        }
        if (["CALL", "YIELD", "AWAIT", "EXECUTE_STATEMENT"].includes(op.type)) {
          op.args?.forEach((a) => typeof a === "string" && taintedVars.add(a));
          if (op.valueVar) taintedVars.add(op.valueVar);
        }
      }
    }

    const resolve = (val) => {
      if (typeof val === "object" && val !== null) return { known: false };
      if (taintedVars.has(val)) return { known: false };
      if (knownValues.has(val))
        return { known: true, value: knownValues.get(val) };
      return { known: false };
    };

    // Pass 2: Fold
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD" || state.op.type === "SEQUENCE")
        continue;
      const op = state.op;

      if (
        (op.type === "ASSIGN_LITERAL" || op.type === "ASSIGN_LITERAL_DIRECT") &&
        this.tempVarRegex.test(op.to)
      ) {
        if (assignmentCounts.get(op.to) === 1 && !taintedVars.has(op.to)) {
          if (op.value === null || typeof op.value !== "object")
            knownValues.set(op.to, op.value);
        }
      }

      if (op.type === "BINARY") {
        const left = resolve(op.left),
          right = resolve(op.right);
        const lVal = left.known
          ? left.value
          : typeof op.left !== "string"
            ? op.left
            : undefined;
        const rVal = right.known
          ? right.value
          : typeof op.right !== "string"
            ? op.right
            : undefined;

        if (lVal !== undefined && rVal !== undefined) {
          const res = this.evaluateBinary(op.op, lVal, rVal);
          if (res.valid) {
            state.op = { type: "ASSIGN_LITERAL", to: op.to, value: res.value };
            if (
              this.tempVarRegex.test(op.to) &&
              assignmentCounts.get(op.to) === 1
            )
              knownValues.set(op.to, res.value);
            count++;
          }
        }
      } else if (op.type === "COND_JUMP") {
        const test = resolve(op.testVar);
        const testVal = test.known
          ? test.value
          : typeof op.testVar === "boolean"
            ? op.testVar
            : undefined;
        if (testVal !== undefined) {
          const target = testVal ? op.trueState : op.falseState;
          state.op = { type: "GOTO", target };
          state.next = target;
          count++;
        }
      }
    }
    return count;
  }

  evaluateBinary(operator, left, right) {
    try {
      let result;
      switch (operator) {
        case "+":
          result = left + right;
          break;
        case "-":
          result = left - right;
          break;
        case "*":
          result = left * right;
          break;
        case "/":
          result = left / right;
          break;
        case "%":
          result = left % right;
          break;
        case "**":
          result = left ** right;
          break;
        case "&":
          result = left & right;
          break;
        case "|":
          result = left | right;
          break;
        case "^":
          result = left ^ right;
          break;
        case "<<":
          result = left << right;
          break;
        case ">>":
          result = left >> right;
          break;
        case ">>>":
          result = left >>> right;
          break;
        case "===":
          result = left === right;
          break;
        case "==":
          result = left == right;
          break;
        case "!==":
          result = left !== right;
          break;
        case "!=":
          result = left != right;
          break;
        case "<":
          result = left < right;
          break;
        case "<=":
          result = left <= right;
          break;
        case ">":
          result = left > right;
          break;
        case ">=":
          result = left >= right;
          break;
        default:
          return { valid: false };
      }
      if (typeof result === "number" && !Number.isFinite(result))
        return { valid: false };
      return { valid: true, value: result };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Merges adjacent basic blocks into Superblocks (SEQUENCE).
   */
  performBlockMerging() {
    let mergedCount = 0;
    const predecessors = this.calculatePredecessors();
    const forbiddenTargets = new Set(this.functionStartStates.values());

    for (let i = 0; i < this.states.length; i++) {
      const stateA = this.states[i];
      if (
        !stateA ||
        stateA.op.type === "DEAD" ||
        stateA.op.type === "FUNC_ENTRY"
      )
        continue;

      const stateBId = stateA.next;
      if (stateBId === null) continue;

      const stateB = this.states[stateBId];
      if (
        !stateB ||
        stateB.op.type === "DEAD" ||
        predecessors[stateBId] !== 1 ||
        forbiddenTargets.has(stateBId)
      )
        continue;

      const isSensitive = (type) =>
        [
          "COND_JUMP",
          "RETURN",
          "THROW",
          "HALT",
          "YIELD",
          "AWAIT",
          "FINALLY_DISPATCH",
          "CALL",
        ].includes(type);
      if (isSensitive(stateA.op.type)) continue;
      if (
        stateA.op.type === "SEQUENCE" &&
        isSensitive(stateA.op.ops[stateA.op.ops.length - 1].type)
      )
        continue;

      const opsA = stateA.op.type === "SEQUENCE" ? stateA.op.ops : [stateA.op];
      const opsB = stateB.op.type === "SEQUENCE" ? stateB.op.ops : [stateB.op];

      if (opsA.length + opsB.length > this.maxSuperblockSize) continue;

      stateA.op = { type: "SEQUENCE", ops: [...opsA, ...opsB] };
      stateA.next = stateB.next;
      stateB.op = { type: "DEAD" };
      stateB.next = null;
      mergedCount++;
    }
    return mergedCount;
  }

  /**
   * Identifies recursive calls in return position and converts them into jumps.
   */
  performTailCallOptimization() {
    let count = 0;
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (!state || state.op.type !== "CALL") continue;

      const callee = state.op.callee;
      if (!state.op.callerFuncName || callee !== state.op.callerFuncName)
        continue;

      // Ensure return immediately follows
      let curr = state.next !== null ? this.states[state.next] : null;
      if (curr?.op.type === "POST_CALL")
        curr = curr.next !== null ? this.states[curr.next] : null;

      let returnValVar = null;
      if (curr?.op.type === "RETRIEVE_RESULT") {
        returnValVar = curr.op.to;
        curr = curr.next !== null ? this.states[curr.next] : null;
      }

      if (
        curr?.op.type !== "RETURN" ||
        (returnValVar && curr.op.valueVar !== returnValVar)
      )
        continue;

      // Transform to jump
      const entryId = this.functionStartStates.get(callee);
      const entryState = this.states[entryId];
      if (entryState?.op.type !== "FUNC_ENTRY") continue;

      const params = entryState.op.params || [];
      const args = state.op.args || [];
      if (
        params.length !== args.length ||
        !params.every((p) => p.type === "Identifier")
      )
        continue;

      let lastState = state;
      const tcoTemps = args.map((arg, k) => {
        const tempName = `_tco_t${count}_${k}`;
        const assignOp = { type: "ASSIGN", to: tempName, from: arg };
        if (k === 0) {
          state.op = assignOp;
          state.next = null;
        } else {
          const newState = { id: this.states.length, op: assignOp, next: null };
          this.states.push(newState);
          lastState.next = newState.id;
          lastState = newState;
        }
        return tempName;
      });

      params.forEach((param, k) => {
        const assignOp = { type: "ASSIGN", to: param.name, from: tcoTemps[k] };
        const newState = { id: this.states.length, op: assignOp, next: null };
        this.states.push(newState);
        lastState.next = newState.id;
        lastState = newState;
      });

      lastState.next = entryState.next;
      count++;
    }
    return count;
  }

  /** Calculates how many incoming edges each state has. */
  calculatePredecessors() {
    const counts = new Int32Array(this.states.length + 1).fill(0);
    for (const state of this.states) {
      if (!state || state.op.type === "DEAD") continue;
      if (state.next !== null) counts[state.next]++;
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.type === "COND_JUMP") {
          counts[op.trueState]++;
          counts[op.falseState]++;
        } else if (["GOTO", "PUSH_CATCH_HANDLER"].includes(op.type))
          counts[op.target]++;
      }
    }
    return counts;
  }

  /** Converts conditional jumps with identical targets into GOTOs. */
  removeRedundantBranches() {
    let count = 0;
    for (const state of this.states) {
      if (
        state?.op.type === "COND_JUMP" &&
        state.op.trueState === state.op.falseState
      ) {
        state.op = { type: "GOTO", target: state.op.trueState };
        state.next = state.op.trueState;
        count++;
      }
    }
    return count;
  }

  /** Recursive AST walker to find temp variable usage inside embedded JS statements. */
  scanASTForUsage(node, usageCounts) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && this.tempVarRegex.test(node.name)) {
      usageCounts.set(node.name, (usageCounts.get(node.name) || 0) + 1);
    }
    // Check for memory map aliases
    if (
      node.type === "MemberExpression" &&
      ["M", "GM"].includes(node.object?.name)
    ) {
      if (node.property.type === "NumericLiteral") {
        const vars = this.reverseMemoryMap.get(node.property.value);
        vars?.forEach(
          (v) =>
            this.tempVarRegex.test(v) &&
            usageCounts.set(v, (usageCounts.get(v) || 0) + 1),
        );
      }
    }
    for (const key in node) {
      if (["loc", "start", "end"].includes(key)) continue;
      const val = node[key];
      if (Array.isArray(val))
        val.forEach((c) => this.scanASTForUsage(c, usageCounts));
      else if (typeof val === "object") this.scanASTForUsage(val, usageCounts);
    }
  }

  /** Forwards assignments to their only successor if valid. */
  propagateAssignmentsToSuccessors() {
    let mergedCount = 0;
    const redirects = new Map();
    const predecessors = this.calculatePredecessors();

    for (const state of this.states.filter((s) => s && s.op.type !== "DEAD")) {
      if (state.op.type === "SEQUENCE") continue;
      const isSrc = [
        "ASSIGN",
        "ASSIGN_LITERAL",
        "ASSIGN_GLOBAL",
        "MEMBER_ACCESS_GLOBAL",
      ].includes(state.op.type);
      if (!isSrc || !this.tempVarRegex.test(state.op.to)) continue;

      const next = this.states[state.next];
      if (
        !next ||
        next.op.type === "DEAD" ||
        next.op.type === "SEQUENCE" ||
        predecessors[next.id] > 1
      )
        continue;

      const temp = state.op.to;
      let ok = false;

      if (next.op.type === "ASSIGN" && next.op.from === temp) {
        if (state.op.type === "ASSIGN_LITERAL") {
          next.op = {
            ...next.op,
            type: "ASSIGN_LITERAL_DIRECT",
            value: state.op.value,
          };
          delete next.op.from;
          ok = true;
        } else if (state.op.type === "ASSIGN") {
          next.op.from = state.op.from;
          ok = true;
        }
      } else if (
        next.op.type === "RETURN" &&
        next.op.valueVar === temp &&
        state.op.type === "ASSIGN"
      ) {
        next.op.valueVar = state.op.from;
        ok = true;
      } else if (
        next.op.type === "COND_JUMP" &&
        next.op.testVar === temp &&
        state.op.type === "ASSIGN_LITERAL"
      ) {
        const target = !!state.op.value
          ? next.op.trueState
          : next.op.falseState;
        next.op = { type: "GOTO", target };
        next.next = target;
        ok = true;
      }

      if (ok) {
        state.op.type = "DEAD";
        redirects.set(state.id, next.id);
        mergedCount++;
      }
    }
    return { mergedCount, redirects };
  }

  /** Marks GOTO/NOOP states as dead and provides redirects for remapping. */
  optimizeGotos() {
    const redirects = new Map();
    let mergedCount = 0;
    for (const state of this.states.filter((s) => s && s.op.type !== "DEAD")) {
      if (state.id === 0 || state.op.type === "FUNC_ENTRY") continue;
      if (state.op.type === "GOTO" || state.op.type === "NOOP") {
        const targetId =
          state.op.type === "GOTO" ? state.op.target : state.next;
        if (targetId !== null && targetId !== state.id) {
          redirects.set(state.id, targetId);
          state.op.type = "DEAD";
          mergedCount++;
        }
      }
    }
    return { mergedCount, redirects };
  }

  /** Removes x = x. */
  removeIdentityAssignments() {
    let count = 0;
    for (const state of this.states.filter((s) => s && s.op.type !== "DEAD")) {
      if (
        state.op.type === "ASSIGN" &&
        state.op.to === state.op.from &&
        state.next !== null
      ) {
        state.op = { type: "GOTO", target: state.next };
        count++;
      }
    }
    return count;
  }

  /** Standard Mark-and-Sweep to find unreachable states in the CFG. */
  removeUnreachableStates() {
    const reachable = new Set([0, ...this.functionStartStates.values()]);
    const queue = Array.from(reachable);

    while (queue.length > 0) {
      const state = this.states[queue.shift()];
      if (!state) continue;
      const succ = [];
      if (state.next !== null) succ.push(state.next);
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.type === "COND_JUMP") succ.push(op.trueState, op.falseState);
        else if (["GOTO", "PUSH_CATCH_HANDLER"].includes(op.type))
          succ.push(op.target);
      }
      for (const id of succ) {
        if (this.states[id] && !reachable.has(id)) {
          reachable.add(id);
          queue.push(id);
        }
      }
    }

    let deadCount = 0;
    for (const state of this.states.filter(Boolean)) {
      if (!reachable.has(state.id)) {
        state.op.type = "DEAD";
        deadCount++;
      }
    }
    return deadCount;
  }

  /** Updates all state pointers based on a redirection map. */
  remapStateTransitions(redirects) {
    if (redirects.size === 0) return;
    for (const [fromId, toId] of redirects.entries()) {
      let finalId = toId;
      const seen = new Set([fromId]);
      while (redirects.has(finalId)) {
        if (seen.has(finalId)) break;
        seen.add(finalId);
        finalId = redirects.get(finalId);
      }
      if (finalId !== toId) redirects.set(fromId, finalId);
    }
    for (const state of this.states.filter(Boolean)) {
      if (state.next !== null && redirects.has(state.next))
        state.next = redirects.get(state.next);
      const ops = state.op.type === "SEQUENCE" ? state.op.ops : [state.op];
      for (const op of ops) {
        if (op.type === "COND_JUMP") {
          if (redirects.has(op.trueState))
            op.trueState = redirects.get(op.trueState);
          if (redirects.has(op.falseState))
            op.falseState = redirects.get(op.falseState);
        } else if (["GOTO", "PUSH_CATCH_HANDLER"].includes(op.type)) {
          if (redirects.has(op.target)) {
            op.target = redirects.get(op.target);
            if (state.op.type !== "SEQUENCE" && op.type === "GOTO")
              state.next = op.target;
          }
        } else if (
          op.type === "ASSIGN_LITERAL" &&
          op.to === "_FIN_V" &&
          redirects.has(op.value)
        ) {
          op.value = redirects.get(op.value);
        }
      }
    }
  }

  /** Physically removes states marked as DEAD from the internal array. */
  removeDeadStates() {
    for (let i = 0; i < this.states.length; i++) {
      if (this.states[i]?.op.type === "DEAD") this.states[i] = undefined;
    }
  }
}

module.exports = IROptimizer;
