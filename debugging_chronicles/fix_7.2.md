# VortexJS: Modern Syntax Support (Rest/Spread & Methods)

> **Status:** Stable
> **Focus:** Rest/Spread Operators, Object Methods, and Argument Resolution
> **Date:** Dec 15, 2025

This document details the final set of fixes required to support modern JavaScript syntactic sugar, specifically regarding argument spreading, rest parameters, and shorthand object methods, which previously caused compiler crashes due to structural mismatches in the AST traversal.

---

## 1. The Challenge: Syntactic Sugar vs. Structural IR

The IR generation logic assumed a strict, older-style JavaScript structure:

1.  **Arguments:** Assumed to be a simple list of expressions. The presence of `SpreadElement` (`...args`) broke the `ExpressionHandler`.
2.  **Parameters:** Assumed 1-to-1 mapping with input arguments. `RestElement` (`...args`) requires slicing the input array, which wasn't implemented.
3.  **Objects:** Assumed all properties were `ObjectProperty` nodes with a `key` and `value`. `ObjectMethod` nodes (e.g., `query() { ... }`) lack a `value` property, causing immediate crashes during property iteration.

## 2. Implementation Steps & Fixes

### Fix 1: Spread Arguments in Calls & Arrays

**Severity:** High (Compiler Crash)
**Error:** `Error: Unsupported expression type: SpreadElement`
**Analysis:**
Calls like `fn(...args)` and arrays like `[...items]` introduce `SpreadElement` nodes. The `ExpressionHandler` did not know how to flatten these or pass the "spread" metadata to the IR.
**Solution:**

- **IR Generation:** Implemented `handleSpreadElement` to flag the result variable as a spread source.
- **State Machine:** Created a `_getArgList` helper. It flags arguments as `{ spreadVar: name }`.
- **AST Generation:** Updated `CALL`, `NEW_INSTANCE`, and `CREATE_ARRAY` handlers to check for this flag and generate `t.spreadElement()` instead of standard identifiers.

### Fix 2: Rest Parameters in Function Entries

**Severity:** Critical (Logic Error)
**Symptom:** `undefined` passed to functions using rest parameters.
**Analysis:**
For `function foo(...args)`, the VM passes arguments in a global array `X.A`. The IR generator tried to map `args` to `X.A[0]`, which is incorrect. A rest parameter at index `i` must capture `X.A.slice(i)`.
**Solution:**

- Updated `FUNC_ENTRY` logic in `ASTGenerator.js`.
- Added specific detection for `t.isRestElement(param)`.
- If detected, it generates code to slice the argument array (`A.slice(i)`) rather than accessing a single index.

### Fix 3: Object Method Definitions

**Severity:** High (Compiler Crash)
**Error:** `TypeError: Cannot read properties of undefined (reading 'type')`
**Analysis:**
In code like `{ query(sql) { ... } }`, the AST node is `ObjectMethod`. The loop inside `handleObjectExpression` attempted to access `prop.value`, which is `undefined` for methods (the body _is_ the value).
**Solution:**

- Updated `handleObjectExpression` in `ExpressionHandler`.
- Added a check for `propPath.isObjectMethod()`.
- **Transformation:** Instantly converts `ObjectMethod` nodes into standard `FunctionExpression` nodes.
- **Result:** The method is assigned to a temporary variable and treated as a standard `ASSIGN_LITERAL_DIRECT` operation, preserving the body logic while fitting into the existing "Key: Value" IR structure.

### Fix 4: Object Spread Properties

**Severity:** Medium (Compiler Crash)
**Scenario:** `const state = { ...defaults, connected: true };`
**Analysis:**
Similar to Fix 1, `SpreadElement` inside an ObjectExpression crashed the loop expecting `key`/`value` pairs.
**Solution:**

- Updated loop to check `propPath.isSpreadElement()`.
- Pushes a `{ spreadVar: ... }` object to the property list.
- Updated `CREATE_OBJECT` in `ASTGenerator` to generate `t.spreadElement()` when this flag is present.

---

## 3. Summary of Verified Behaviors

| Feature              | Scenario                             | Status                      |
| :------------------- | :----------------------------------- | :-------------------------- |
| **Spread Arguments** | `fn(...args)` / `new Class(...args)` | **Correctly Spreads**       |
| **Rest Parameters**  | `function(...args)`                  | **Correctly Sliced**        |
| **Object Methods**   | `{ run() { ... } }`                  | **Converted & Virtualized** |
| **Object Spread**    | `{ ...state, newProp: 1 }`           | **Correctly Merged**        |
| **Array Spread**     | `[...arr, item]`                     | **Correctly Flattened**     |
