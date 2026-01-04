/**
 * @file switch-dispatcher.js
 * @description Implements the standard Switch-based instruction dispatcher.
 * Generates a flat `switch(S) { case ID: ... }` structure. This is the most
 * compatible and performant dispatcher for V8/SpiderMonkey optimization, though
 * easier to analyze statically than the BST approach.
 */

const t = require("@babel/types");
const BaseDispatcher = require("./base-dispatcher");

/**
 * Generates a flat switch statement to dispatch VM states.
 */
class SwitchDispatcher extends BaseDispatcher {
  /**
   * Generates the switch statement.
   * @param {Object} helpers - Context helpers (registers, VM constants).
   * @returns {Object} The SwitchStatement AST node.
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

    const switchCases = [];

    // Iterate over every active state in the IR
    for (const state of this.astGen.states.filter(Boolean)) {
      const { id, op, next } = state;
      const mappedId = this._getMappedId(id);
      const nextMapped = next !== null ? this._getMappedId(next) : null;

      // -- Context-Aware Helpers --
      // These wrappers ensure that if an error occurs during generation,
      // we know exactly which state ID caused it.
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

      // Resolves arguments for CALL/NEW ops, handling spreads and literals
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

      // Generate the body of the case (the actual instruction logic)
      const caseBody = this.generateOpCode(op, opHelpers);

      // -- Control Flow Analysis --
      // Determine if we need to explicitly set S = next_state.
      // If the OpCode itself modifies S (e.g., GOTO, COND_JUMP, RETURN),
      // we must NOT overwrite it with the default 'next'.
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

      if (op.type === "SEQUENCE") {
        lastOp = op.ops[op.ops.length - 1];
      }

      if (isControlFlowOp(lastOp.type)) {
        effectivelyControlFlow = true;
      } else if (lastOp.type === "CALL") {
        // Internal standard calls push to stack and modify S, so they are control flow.
        const targetStateId = this._getFuncStateOrFail(
          lastOp.callee,
          "jump check",
        );
        const targetState = this.astGen.states[targetStateId];
        const isStandardInternal =
        !targetState.op.isGenerator && !targetState.op.isAsync;
        if (isStandardInternal) effectivelyControlFlow = true;
      }

      // If instruction didn't divert flow, advance to the next state
      if (!effectivelyControlFlow && next !== null) {
        caseBody.push(assign(S, num(nextMapped, "next state")));
      }

      // Switch cases fall through by default, so we must break
      caseBody.push(t.breakStatement());

      switchCases.push(
        t.switchCase(
          this._createNumericLiteralOrFail(mappedId, "case id"),
                     caseBody,
        ),
      );
    }

    // Default case: Panic on invalid state (anti-tamper / debug)
    const errorCase = t.switchCase(null, [
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier("console"), t.identifier("error")),
                         [t.stringLiteral("FATAL ERROR: Entered unknown state:"), S],
        ),
      ),
      t.breakStatement(t.identifier("dispatcher_loop")),
    ]);
    switchCases.push(errorCase);

    // Randomize case order to prevent simple linear analysis
    switchCases.sort(() => Math.random() - 0.5);

    return t.switchStatement(S, switchCases);
  }
}

module.exports = SwitchDispatcher;
