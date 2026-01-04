/**
 * @file anti-debug.js
 * @description High-level anti-debugging predicate.
 * It measures the execution time of a tight loop using Date.now().
 * If a debugger is attached and stepping through code, the time difference
 * will be significantly larger than the threshold (50ms).
 * If detected, it branches to the bogus target.
 */

const t = require("@babel/types");

module.exports = {
  level: "high",
  name: "AntiDebug",
  generate(ir) {
    // Threshold set to 50ms. A 1500 iteration loop should take < 1ms on any modern CPU.
    // Stepping manually will take seconds.
    const THRESHOLD = 50;
    const ITERATIONS = 1500;

    // 1. Capture Start Time (Date.now())
    const startTimeVar = ir.createTempVar();
    const startState = ir.addState({
      type: "EXTERNAL_CALL",
      to: startTimeVar.name,
      callee: {
        member_access_global: { object: "Date", property: "now" },
      },
      args: [],
    });

    // 2. Dummy Loop (to create a time gap)
    const counterVar = ir.createTempVar();
    const initCounter = ir.addState({
      type: "ASSIGN_LITERAL",
      to: counterVar.name,
      value: 0,
    });
    ir.linkStates(startState, initCounter);

    const loopCheckState = ir.addState({ type: "NOOP" });
    const limitVar = ir.createTempVar();
    const loadLimit = ir.addState({
      type: "ASSIGN_LITERAL",
      to: limitVar.name,
      value: ITERATIONS,
    });
    const condVar = ir.createTempVar();
    const checkCond = ir.addState({
      type: "BINARY",
      op: "<",
      to: condVar.name,
      left: counterVar.name,
      right: limitVar.name,
    });

    ir.linkStates(initCounter, loopCheckState);
    ir.linkStates(loopCheckState, loadLimit);
    ir.linkStates(loadLimit, checkCond);

    // Loop Body: Simple Increment
    const oneVar = ir.createTempVar();
    const loadOne = ir.addState({
      type: "ASSIGN_LITERAL",
      to: oneVar.name,
      value: 1,
    });
    const incCounter = ir.addState({
      type: "BINARY",
      op: "+",
      to: counterVar.name,
      left: counterVar.name,
      right: oneVar.name,
    });

    ir.linkStates(loadOne, incCounter);
    ir.linkStates(incCounter, loopCheckState);

    // 3. Capture End Time
    const endTimeVar = ir.createTempVar();
    const endState = ir.addState({
      type: "EXTERNAL_CALL",
      to: endTimeVar.name,
      callee: {
        member_access_global: { object: "Date", property: "now" },
      },
      args: [],
    });

    // Link Loop Exit to End Time
    const loopJump = ir.addState({
      type: "COND_JUMP",
      testVar: condVar.name,
      trueState: loadOne,
      falseState: endState,
    });
    ir.linkStates(checkCond, loopJump);

    // 4. Verification Logic: (end - start) < THRESHOLD
    const diffVar = ir.createTempVar();
    const calcDiff = ir.addState({
      type: "BINARY",
      op: "-",
      to: diffVar.name,
      left: endTimeVar.name,
      right: startTimeVar.name,
    });

    const thresholdVar = ir.createTempVar();
    const loadThreshold = ir.addState({
      type: "ASSIGN_LITERAL",
      to: thresholdVar.name,
      value: THRESHOLD,
    });

    const testVar = ir.createTempVar();
    const compare = ir.addState({
      type: "BINARY",
      op: "<",
      to: testVar.name,
      left: diffVar.name,
      right: thresholdVar.name,
    });

    ir.linkStates(endState, calcDiff);
    ir.linkStates(calcDiff, loadThreshold);
    ir.linkStates(loadThreshold, compare);

    // 5. The Opaque Jump
    const bogusTarget = ir.addState({ type: "NOOP" });
    const finalJump = ir.addState({
      type: "COND_JUMP",
      testVar: testVar.name,
      trueState: null, // Filled by StatementHandler
      falseState: bogusTarget, // If detected (Time > Threshold), go to bogus code
    });

    ir.linkStates(compare, finalJump);

    return { start: startState, end: finalJump, bogusTarget };
  },
};
