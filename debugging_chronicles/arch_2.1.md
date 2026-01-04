# VortexJS: The Stackless Trampoline (Final VM Architecture)

> **Status:** ✅ Stable (Passed 72/72 Tests)
> **Focus:** Infinite Recursion Support (`RangeError` Fix), Async Promise Chaining, Trampoline Execution
> **Date:** Dec 16, 2025

This document details the successful transition from the **Recursive Virtual Machine (RVM)** to the **Stackless Virtual Machine (SVM)**. This critical architectural shift allows the obfuscated code to execute deeply recursive logic without consuming the host JavaScript call stack.

---

## 1\. The Challenge: The Host Stack Limit

While the previous RVM provided excellent scope isolation, it mapped Guest Function Calls 1:1 to Host Function Calls.

- **Scenario:** A guest function `factorial(n)` calls itself 20,000 times.
- **Failure:** The JavaScript engine throws `RangeError: Maximum call stack size exceeded` because the host `V()` function recurses 20,000 times.
- **Requirement:** We needed a way to simulate recursion _iteratively_ to support arbitrary depth.

## 2\. The Solution: The Virtual Stack (Trampoline)

We implemented a **Trampoline Architecture** using a Shadow Stack (`VS`). The VM now runs inside a single, perpetual `while(true)` loop.

### 2.1. The Virtual Stack (`VS`)

Instead of using the JS engine's stack, we maintain a local array `VS` inside the VM instance to hold stack frames.

```javascript
let M,
  S,
  VS = [];
```

When a synchronous internal function is called (`CALL` opcode):

1.  **Snapshot:** A "Frame" object `{ M, S }` is created (saving current Memory and Return Address).
2.  **Push:** This frame is pushed onto `VS`.
3.  **Reset:** A fresh `M` is initialized for the callee, and `S` is updated to the entry state.
4.  **Loop:** The interpreter hits `continue`, immediately processing the next instruction without a recursive call.

### 2.2. The "Standard Internal" Logic

To ensure robustness, the compiler now identifies "Trampoline Candidates" using this logic:

- **Is Candidate:** Any function we compiled (User Code) that is **Synchronous** and **Not a Generator**.
- **Behavior:** These functions use the `VS` stack.
- **Exceptions:** `Async` functions and `Generators` still utilize the host's recursive capabilities (or hybrid wrappers) to handle their unique state requirements (Promises/Iterators).

---

## 3\. Critical Fixes & Debugging

The transition encountered specific friction points with JavaScript's native behavior.

### Fix 1: The "Eager Await" Bug (Promise Chaining)

**Severity:** Critical (Runtime Crash)
**Error:** `TypeError: M[...].then is not a function`
**Scenario:**
The test suite called `runTest().then(...)`. The `runTest` function was virtualized.

- **Old Behavior:** The `CALL` opcode generated `await V(...)`. The VM ran to completion and returned the _resolved value_ (the result object), not the Promise itself.
- **The Fix:**
  We modified the `CALL` logic for `async` functions to generate a native Promise chain:
  ```javascript
  // Generated Code
  M[dest] = V(target, args).then((r) => r.v);
  ```
  This ensures `M[dest]` receives a valid **Promise**, allowing external code to chain `.then()` or `await` correctly.

### Fix 2: Global Function Detection

**Severity:** High (Performance/Stack Limit)
**Issue:**
Top-level functions (like `factorial`) were initially misidentified as "Globals" (like `Math`), preventing them from using the Trampoline.
**The Fix:**
The compiler now checks if the callee has a known `startStateId`. If a start state exists, it is confirmed as user code and is forced into the Trampoline path, regardless of whether it resides in the Global Memory (`GM`) or Local Memory (`M`).

### Fix 3: Manual Exception Unwinding

**Severity:** Medium (Logic correctness)
**Issue:**
Since we are no longer using the native stack, a `throw` statement inside a deep function would bypass all intermediate callers and crash the VM.
**The Fix:**
We wrapped the dispatcher in a `try/catch`. When an error is caught:

1.  Check the current frame's `_EHP` (Exception Handler Pointer).
2.  If valid, jump `S` to the handler.
3.  If invalid, **pop a frame from `VS`** (restore caller's memory) and repeat.
4.  If `VS` is empty, re-throw to the host (truly unhandled error).

---

## 4\. Final Architecture Summary

```javascript
const V = async (X, ...) => {
    // 1. Setup Virtual Stack
    let M = ..., S = ..., VS = [];

    // 2. The Infinite Loop
    dispatcher_loop: while (true) {
        try {
            switch (S) {
                case CALL_OP:
                    if (isStandardInternal) {
                        // Trampoline: Save state, jump to new function
                        VS.push({ M, S: next_state });
                        M = new_memory; // Isolation
                        S = target_state;
                        continue; // Loop immediately
                    } else {
                        // Async/Generator: Use Native Recursion
                        M[dest] = await V(target, args);
                    }
                    break;

                case RETURN_OP:
                    // Restore previous state
                    if (VS.length > 0) {
                        const frame = VS.pop();
                        M = frame.M;
                        S = frame.S;
                        M[RET_REG] = return_val;
                        continue;
                    }
                    return { _: 1, v: return_val }; // Exit to host
            }
        } catch (e) {
            // Manual Stack Unwinding
            while (true) {
                if (hasHandler(M)) { S = handler; break; }
                if (VS.length === 0) throw e;
                const frame = VS.pop(); // Unwind one level
                M = frame.M;
                S = frame.S;
            }
        }
    }
}
```

## 5\. Conclusion

The **Stackless Trampoline** architecture is now verified. It successfully decouples the Guest Stack from the Host Stack, allowing for robust execution of complex, recursive, and highly concurrent JavaScript code without crashing the runtime.
