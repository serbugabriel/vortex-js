/**
 * @file vm-state-history.js
 * @description High-level opaque predicate based on path dependency.
 * It simulates a Linear Congruential Generator (LCG) loop.
 * S_next = (A * S_curr + C) % M
 * The predicate verifies that the final state matches a pre-calculated value.
 * This forces an analyzer to symbolically execute the loop to solve the path.
 */

const t = require("@babel/types");

module.exports = {
  level: "high",
  name: "VMStateHistory",
  generate(ir) {
    const A_VAL = 1664525;
    const C_VAL = 1013904223;
    const M_VAL = 4294967296; // 2^32
    const ITERATIONS = 5;
    const SEED = Math.floor(Math.random() * 10000);

    // Calculate Expected Result upfront (Compile-time)
    let expected = SEED;
    for (let i = 0; i < ITERATIONS; i++) {
      expected = (A_VAL * expected + C_VAL) % M_VAL;
    }

    // 1. Initialize State Vars
    const stateVar = ir.createTempVar();
    const counterVar = ir.createTempVar();
    const aVar = ir.createTempVar();
    const cVar = ir.createTempVar();
    const mVar = ir.createTempVar();

    const startState = ir.addState({
      type: "ASSIGN_LITERAL",
      to: stateVar.name,
      value: SEED,
    });
    const initCounter = ir.addState({
      type: "ASSIGN_LITERAL",
      to: counterVar.name,
      value: 0,
    });
    const initA = ir.addState({
      type: "ASSIGN_LITERAL",
      to: aVar.name,
      value: A_VAL,
    });
    const initC = ir.addState({
      type: "ASSIGN_LITERAL",
      to: cVar.name,
      value: C_VAL,
    });
    const initM = ir.addState({
      type: "ASSIGN_LITERAL",
      to: mVar.name,
      value: M_VAL,
    });

    ir.linkStates(startState, initCounter);
    ir.linkStates(initCounter, initA);
    ir.linkStates(initA, initC);
    ir.linkStates(initC, initM);

    // 2. Loop Condition Check
    const loopCheckState = ir.addState({ type: "NOOP" }); // Anchor
    const iterVal = ir.createTempVar();
    const iterLimit = ir.addState({
      type: "ASSIGN_LITERAL",
      to: iterVal.name,
      value: ITERATIONS,
    });
    const loopCondVar = ir.createTempVar();
    const loopCond = ir.addState({
      type: "BINARY",
      op: "<",
      to: loopCondVar.name,
      left: counterVar.name,
      right: iterVal.name,
    });

    ir.linkStates(initM, loopCheckState);
    ir.linkStates(loopCheckState, iterLimit);
    ir.linkStates(iterLimit, loopCond);

    // 3. Loop Body (Calculation)
    // state = (state * A + C) % M
    const t1 = ir.createTempVar();
    const t2 = ir.createTempVar();
    const t3 = ir.createTempVar();

    const calcMult = ir.addState({
      type: "BINARY",
      op: "*",
      to: t1.name,
      left: stateVar.name,
      right: aVar.name,
    });
    const calcAdd = ir.addState({
      type: "BINARY",
      op: "+",
      to: t2.name,
      left: t1.name,
      right: cVar.name,
    });
    const calcMod = ir.addState({
      type: "BINARY",
      op: "%",
      to: stateVar.name,
      left: t2.name,
      right: mVar.name,
    }); // Update State

    // Increment Counter
    const one = ir.createTempVar();
    const loadOne = ir.addState({
      type: "ASSIGN_LITERAL",
      to: one.name,
      value: 1,
    });
    const incCounter = ir.addState({
      type: "BINARY",
      op: "+",
      to: counterVar.name,
      left: counterVar.name,
      right: one.name,
    });

    // Link Body
    ir.linkStates(calcMult, calcAdd);
    ir.linkStates(calcAdd, calcMod);
    ir.linkStates(calcMod, loadOne);
    ir.linkStates(loadOne, incCounter);
    ir.linkStates(incCounter, loopCheckState); // Back to start

    // 4. Branching Logic
    const loopExitState = ir.addState({ type: "NOOP" });
    const loopJump = ir.addState({
      type: "COND_JUMP",
      testVar: loopCondVar.name,
      trueState: calcMult, // Enter Loop
      falseState: loopExitState, // Exit Loop
    });

    ir.linkStates(loopCond, loopJump);

    // 5. Final Verification
    const expectedVar = ir.createTempVar();
    const loadExpected = ir.addState({
      type: "ASSIGN_LITERAL",
      to: expectedVar.name,
      value: expected,
    });
    const finalTestVar = ir.createTempVar();
    const finalCompare = ir.addState({
      type: "BINARY",
      op: "===",
      to: finalTestVar.name,
      left: stateVar.name,
      right: expectedVar.name,
    });

    ir.linkStates(loopExitState, loadExpected);
    ir.linkStates(loadExpected, finalCompare);

    // 6. Opaque Jump
    const bogusTarget = ir.addState({ type: "NOOP" });
    const finalJump = ir.addState({
      type: "COND_JUMP",
      testVar: finalTestVar.name,
      trueState: null, // Filled by manager
      falseState: bogusTarget,
    });

    ir.linkStates(finalCompare, finalJump);

    return { start: startState, end: finalJump, bogusTarget };
  },
};
