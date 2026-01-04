/**
 * @file math-congruence.js
 * @description Medium-level opaque predicate based on modular arithmetic identities.
 * Uses the identity: (a * b) % n === ((a % n) * (b % n)) % n
 * This is always true for positive integers, providing a reliable True branch.
 */

const t = require("@babel/types");

module.exports = {
  level: "medium",
  name: "MathCongruence",
  generate(ir) {
    // 1. Setup random inputs
    const a = ir.createTempVar();
    const b = ir.createTempVar();
    const n = ir.createTempVar();
    const aVal = Math.floor(Math.random() * 100) + 1;
    const bVal = Math.floor(Math.random() * 100) + 1;
    const nVal = Math.floor(Math.random() * 50) + 2;

    const startState = ir.addState({
      type: "ASSIGN_LITERAL",
      to: a.name,
      value: aVal,
    });
    const assignB = ir.addState({
      type: "ASSIGN_LITERAL",
      to: b.name,
      value: bVal,
    });
    const assignN = ir.addState({
      type: "ASSIGN_LITERAL",
      to: n.name,
      value: nVal,
    });

    ir.linkStates(startState, assignB);
    ir.linkStates(assignB, assignN);

    // 2. LHS: (a * b) % n
    const ab = ir.createTempVar();
    const lhs = ir.createTempVar();

    const multAB = ir.addState({
      type: "BINARY",
      op: "*",
      to: ab.name,
      left: a.name,
      right: b.name,
    });
    const modLHS = ir.addState({
      type: "BINARY",
      op: "%",
      to: lhs.name,
      left: ab.name,
      right: n.name,
    });

    ir.linkStates(assignN, multAB);
    ir.linkStates(multAB, modLHS);

    // 3. RHS: ((a % n) * (b % n)) % n
    const aMod = ir.createTempVar();
    const bMod = ir.createTempVar();
    const multMod = ir.createTempVar();
    const rhs = ir.createTempVar();

    const calcAMod = ir.addState({
      type: "BINARY",
      op: "%",
      to: aMod.name,
      left: a.name,
      right: n.name,
    });
    const calcBMod = ir.addState({
      type: "BINARY",
      op: "%",
      to: bMod.name,
      left: b.name,
      right: n.name,
    });
    const calcMultMod = ir.addState({
      type: "BINARY",
      op: "*",
      to: multMod.name,
      left: aMod.name,
      right: bMod.name,
    });
    const calcRHS = ir.addState({
      type: "BINARY",
      op: "%",
      to: rhs.name,
      left: multMod.name,
      right: n.name,
    });

    ir.linkStates(modLHS, calcAMod);
    ir.linkStates(calcAMod, calcBMod);
    ir.linkStates(calcBMod, calcMultMod);
    ir.linkStates(calcMultMod, calcRHS);

    // 4. Comparison
    const testVar = ir.createTempVar();
    const compare = ir.addState({
      type: "BINARY",
      op: "===",
      to: testVar.name,
      left: lhs.name,
      right: rhs.name,
    });

    ir.linkStates(calcRHS, compare);

    // 5. Jump
    // Note: We leave trueState/falseState/bogusTarget to be linked by the Manager
    const bogusTarget = ir.addState({ type: "NOOP" });
    const jumpState = ir.addState({
      type: "COND_JUMP",
      testVar: testVar.name,
      trueState: null, // To be filled by injector
      falseState: bogusTarget,
    });

    ir.linkStates(compare, jumpState);

    return { start: startState, end: jumpState, bogusTarget };
  },
};
