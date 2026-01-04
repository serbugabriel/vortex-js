# VortexJS: Control Flow Hardening & Concurrency

> **Status:** Stable
> **Focus:** Nested Control Structures, Async Concurrency, and Exception Routing
> **Date:** Dec 14, 2025

This document records the resolution of critical logic errors involving nested loops, the `try...catch...finally` state machine, and the virtualization of concurrent operations.

---

## 1. The Concurrency Problem

### Fix 1: Serialized Execution in `Promise.all`

**Severity:** High (Performance & Behavior)
**Symptom:** Concurrent tasks passed to `Promise.all` were executing sequentially (one after another) instead of in parallel.
**Analysis:**
The RVM (Recursive Virtual Machine) treats the `CALL` opcode as a blocking operation by default (`await VM(...)`).
When VortexJS encountered an IIFE (Immediately Invoked Function Expression) marked as `async`, it failed to propagate that flag to the VM call site.

```javascript
// Generated Code (Old)
M[1] = await VM(State_IIFE, ...); // VM waits for function to finish completely!
```

This forced the main thread to wait for the first async task to resolve before even starting the second one.

**Solution:**

1.  **IR Generation:** Updated `ExpressionHandler.js` to correctly flag IIFE entry states with `isAsync: true`.
2.  **Code Generation:** Updated `ASTGenerator.js` to check the `isAsync` flag on the target function state.
3.  **Non-Blocking Calls:** If the target is async, the VM now returns a **Promise** immediately:
    ```javascript
    // Generated Code (Fixed)
    M[1] = VM(State_IIFE, ...).then(r => r.v); // Returns Promise, non-blocking
    ```

---

## 2\. The Nested Control Flow Saga

### Fix 2: The Unified Control Stack

**Severity:** Critical (Logic Error)
**Symptom:** Using `break` inside a `switch` statement that was nested inside a `for...of` loop caused the loop to terminate prematurely.
**Analysis:**
The `StatementHandler` maintained separate stacks for loops and try-blocks.
When `break` was encountered, the compiler saw the implicit `try...finally` wrapper of the `for...of` loop and assumed the `break` was exiting the loop, triggering the iterator cleanup logic (`iterator.return()`).

**Solution:**
Implemented a **Unified Control Stack** in `ir-generator.js`.

- The stack tracks `LOOP`, `SWITCH`, and `TRY` contexts in the exact order they appear.
- `handleBreakStatement` now walks up the stack. It creates a simple `GOTO` if the target (Switch) is reachable without crossing a `try` boundary. It only generates `finally` triggers (`_FIN = 2`) if a `try` block actually intervenes.

### Fix 3: The Magic Token Guard (`@@VRXT`)

**Severity:** High (Control Flow Leakage)
**Symptom:** User-defined `catch (e)` blocks were catching internal VM signals.
**Analysis:**
To support the "Iterator Close Protocol" (e.g., breaking a loop), VortexJS throws a magic exception token `@@VRXT` to wake up the generator.
If the user code had a `catch (e)` block surrounding the loop, it caught `@@VRXT` as if it were a runtime error, preventing the generator from closing correctly.

**Solution:**
Inject a **Guard Clause** at the entry of every user `catch` block in the IR:

```javascript
// Virtualized Catch Logic
if (_EXV === "@@VRXT") {
  throw _EXV; // Re-throw immediately, bypassing user logic
}
// ... User catch code ...
```

### Fix 4: Exception Routing in Catch Blocks

**Severity:** Critical (Silent Failure)
**Symptom:** The `finally` block of an outer function was skipped if an inner `catch` block re-threw an exception (or the `@@VRXT` token).
**Analysis:**
When the VM enters a `catch` block, the exception handler for that block is popped. If the `catch` block itself throws, there is no active handler to route execution to the `finally` block.

**Solution:**
Wrapped the execution of the `catch` block in an **Ephemeral Exception Handler**:

1.  **Enter Catch:** `PUSH_CATCH_HANDLER` -\> Point to `finally`.
2.  **Execute Catch:** Run user code (or Guard).
3.  **Exit Catch:** `POP_CATCH_HANDLER`.
    This ensures that even if the `catch` block throws, the VM correctly jumps to the `finally` block.

### Fix 5: The "Naked Catch" Regression (Infinite Loop)

**Severity:** Critical (Runtime Freeze)
**Symptom:** `try { ... } catch(e) { ... }` (without finally) caused an infinite loop.
**Analysis:**
A previous refactor accidentally placed the state linking logic for `POP_CATCH_HANDLER` inside a conditional block that only executed if `!catchClause`. This left the `POP` state with `next: null`.
The VM executed the instruction but didn't advance the state pointer `S`, executing `POP` forever.

**Solution:**
Restored the unconditional link in `ir-statement-handler.js`, ensuring `POP_CATCH_HANDLER` always transitions to the end of the try/catch structure.

---

## 3\. Summary of Verified Behaviors

| Feature         | Scenario                              | Status                            |
| :-------------- | :------------------------------------ | :-------------------------------- |
| **Concurrency** | `Promise.all` with async IIFEs        | **Parallel Execution Confirmed**  |
| **Nesting**     | `break` in `switch` inside `for...of` | **Correct (Exits switch only)**   |
| **Cleanup**     | `break` in `for...of`                 | **Triggers Iterator `.return()`** |
| **Guards**      | `catch(e)` wrapping a generator       | **Ignores `@@VRXT` token**        |
| **Routing**     | `catch` block throwing error          | **Routes to `finally`**           |
