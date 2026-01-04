/**
 * @file array-alias.js
 * @description Medium-level opaque predicate based on JS memory aliasing.
 * It creates two variables pointing to the same array reference.
 * It modifies one variable and checks if the other variable reflects the change.
 * This confuses static analyzers that don't track reference identity deeply.
 */

const t = require("@babel/types");

module.exports = {
  level: "medium",
  name: "ArrayAlias",
  generate(ir) {
    // 1. Create Array: arr1 = [10]
    const arr1 = ir.createTempVar();
    const val1 = ir.createTempVar();
    const valAssign = ir.addState({
      type: "ASSIGN_LITERAL",
      to: val1.name,
      value: 10,
    });

    const createArr = ir.addState({
      type: "CREATE_ARRAY",
      to: arr1.name,
      elements: [val1.name],
    });

    ir.linkStates(valAssign, createArr);

    // 2. Create Alias: arr2 = arr1
    const arr2 = ir.createTempVar();
    const aliasAssign = ir.addState({
      type: "ASSIGN",
      to: arr2.name,
      from: arr1.name,
    });
    ir.linkStates(createArr, aliasAssign);

    // 3. Mutate Alias: arr2[0] = 99
    // Note: Using computed access to avoid string literal optimization removal
    const indexVar = ir.createTempVar();
    const indexAssign = ir.addState({
      type: "ASSIGN_LITERAL",
      to: indexVar.name,
      value: 0,
    });

    const mutateVal = ir.createTempVar();
    const mutateAssign = ir.addState({
      type: "ASSIGN_LITERAL",
      to: mutateVal.name,
      value: 99,
    });

    const memberAssign = ir.addState({
      type: "MEMBER_ASSIGN_COMPUTED",
      object: arr2.name,
      property: indexVar.name,
      value: mutateVal.name,
    });

    ir.linkStates(aliasAssign, indexAssign);
    ir.linkStates(indexAssign, mutateAssign);
    ir.linkStates(mutateAssign, memberAssign);

    // 4. Check Original: checkVal = arr1[0] (Should be 99)
    const checkVal = ir.createTempVar();
    const access = ir.addState({
      type: "MEMBER_ACCESS_COMPUTED",
      to: checkVal.name,
      object: arr1.name,
      property: indexVar.name,
    });
    ir.linkStates(memberAssign, access);

    // 5. Comparison
    const testVar = ir.createTempVar();
    const compare = ir.addState({
      type: "BINARY",
      op: "===",
      to: testVar.name,
      left: checkVal.name,
      right: mutateVal.name,
    });
    ir.linkStates(access, compare);

    // 6. Jump
    const bogusTarget = ir.addState({ type: "NOOP" });
    const jumpState = ir.addState({
      type: "COND_JUMP",
      testVar: testVar.name,
      trueState: null,
      falseState: bogusTarget,
    });
    ir.linkStates(compare, jumpState);

    return { start: valAssign, end: jumpState, bogusTarget };
  },
};
