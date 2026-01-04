# VortexJS: Hardening, Randomization & Final Stability

> **Status:** Stable
> **Focus:** State Randomization, Opaque Predicates, Nested Closures, and Complex Expressions
> **Date:** Dec 15, 2025

This document records the engineering solutions applied to resolve conflicts between the Obfuscation layers (Randomization, Opaque Predicates) and complex runtime logic, ensuring the "Worker Pool" stress test runs successfully under maximum security settings.

---

## 1. The Challenge: The "Unknown State" Crash

When enabling `--randomize-ids`, the VM crashed immediately upon entering a nested function.
**Error:** `FATAL ERROR: Entered unknown state: 4`

### Analysis

1.  **The Wrapper:** When `workerPool` defined `runWorker`, the `StatementHandler` generated a wrapper function: `const runWorker = (...args) => VM(4, args)`. This "4" was the **raw** state ID.
2.  **The Scramble:** The `ASTGenerator` randomized all state IDs in the main switch statement (e.g., State 4 became State 850283).
3.  **The Disconnect:** The nested wrapper was treated as static literal data. The `ASTGenerator` did not know it contained a state ID that needed updating. At runtime, the wrapper called `VM(4)`, but the VM was listening for `VM(850283)`.

## 2. Implementation Steps & Fixes

### Fix 1: Recursive AST Patching for Wrappers

**Severity:** Critical (Runtime Crash)
**Solution:**
Modified `ASTGenerator.js` to inspect `ASSIGN_LITERAL_DIRECT` opcodes.
If the assigned value is a function (Arrow or FunctionExpression), it now uses `@babel/traverse` to scan the function body for calls to `V(id, ...)`.

- **Action:** It detects the numeric literal `id`, looks up its randomized mapping, and **patches the AST in-place** before code generation.

### Fix 2: The IIFE Barrier (Closure Capturing)

**Severity:** High (Patching Failure)
**Symptom:** `FATAL ERROR` persisted even after Fix 1.
**Analysis:**
The `IRGenerator` post-processing step wraps functions that capture variables in an **IIFE** (Immediately Invoked Function Expression) to inject the scope.

- **Structure:** `M[id] = ((captured) => async function wrapper(...) { ... })(captured_values)`
- **Failure:** The previous fix only checked for `isFunction`. The node was now a `CallExpression` (the IIFE). The traversal skipped it, leaving the inner wrapper unpatched.
  **Solution:**
  Broadened the check in `ASTGenerator.js` to traverse any object-type literal (including `CallExpression`). This ensures the patcher dives inside the IIFE to find the inner `V(...)` call.

### Fix 3: The Async Regression (The `.then` Crash)

**Severity:** High (Logic Regression)
**Error:** `TypeError: ...then is not a function`
**Analysis:**
During the randomization refactor, the logic for the `CALL` opcode in `ASTGenerator.js` was accidentally reverted.

- **The Bug:** It treated all calls as synchronous (`await V(...)`).
- **The Result:** Async functions were awaited fully by the VM, unwrapping the result. The original code expected a `Promise` to chain `.then()`, but received the raw value.
  **Solution:**
  Re-integrated the **Async Protocol** logic.
- **Logic:** `if (targetState.op.isAsync) { ... return VM(...).then(...) }`

### Fix 4: Member Expression Update Operators

**Severity:** Medium (Feature Gap)
**Error:** `Error: Update expressions are only supported on identifiers.`
**Scenario:** `shared.produced++` or `this.count--`.
**Analysis:**
The `ExpressionHandler` previously only supported update operators (`++`, `--`) on simple identifiers (`i++`). It lacked the logic to handle object properties.
**Solution:**
Updated `ir-expression-handler.js` to implement a **Read-Modify-Write** sequence for MemberExpressions:

1.  **Evaluate:** Object and Property (if computed).
2.  **Read:** `MEMBER_ACCESS` to a temp var.
3.  **Modify:** `BINARY` operation (add/sub 1).
4.  **Write:** `MEMBER_ASSIGN` back to the object.

---

## 3. Summary of Verified Behaviors

| Feature                 | Scenario                        | Status                |
| :---------------------- | :------------------------------ | :-------------------- |
| **State Randomization** | Nested Async Functions          | **Correctly Mapped**  |
| **Opaque Predicates**   | High Complexity / Probability   | **Stable**            |
| **Closure Capture**     | Functions wrapped in IIFEs      | **Correctly Patched** |
| **Async Protocol**      | `Call` opcode for async targets | **Returns Promise**   |
| **Complex Updates**     | `obj.prop++` / `arr[i]--`       | **Functional**        |
