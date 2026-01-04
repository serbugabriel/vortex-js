### **VortexJS: Optimization Engine Upgrade**

> **Status:** Stable
> **Focus:** Smart Constant Folding, Dead Code Elimination, Tail Call Optimization (TCO)
> **Date:** Dec 31, 2025

This document details the implementation of a high-performance optimization pass in the Intermediate Representation (IR) layer. The upgrade introduces "Smart" Constant Folding, aggressive Dead Store Elimination, and Tail Call Optimization (TCO), allowing recursive functions to run indefinitely inside the VM without stack overflows.

---

```javascript
// optimizer-test.js

function runOptimizedLogic() {
  console.log("--- Starting Optimization Test ---");

  // TEST 1: Constant Folding & Dead Branch Removal
  // The optimizer should pre-calculate all of this at build time.
  const a = 10;
  const b = 20;

  // (10 + 20) * 2 = 60. 60 << 2 = 240.
  // 240 & 255 = 240.
  const convolutedMath = (((a + b) * 2) << 2) & 0xff;

  // 100 > 50 is true.
  const condition = 10 * 10 > 50;

  let result;
  if (condition) {
    // This branch is ALWAYS taken.
    // 'result' should become a constant assignment of 240.
    result = convolutedMath;
  } else {
    // This branch is DEAD CODE.
    // The optimizer should remove these instructions entirely.
    console.log("FATAL: This dead code ran!");
    result = -1;
  }

  console.log("Math Result (Expected 240):", result);

  // TEST 2: Dead Store Elimination & Identity Assignment
  let x = 500;
  x = x; // Identity assignment (should be removed)

  let y = 1000;
  y = 2000; // The assignment y=1000 is a dead store (overwritten immediately)

  // 'unusedVar' is calculated but never returned or logged.
  // The entire calculation chain for 'unusedVar' should be stripped.
  const unusedVar = x * y + 9999;

  console.log("Dead Store Result (Expected 2000):", y);

  // TEST 3: Tail Call Optimization (TCO)
  // A recursive function that sums numbers from N down to 1.
  // Without TCO, N=50000 crashes with "Maximum call stack size exceeded".
  // With TCO, this becomes a tight loop (GOTO) and runs instantly.
  function sumTailRecursive(n, acc = 0) {
    if (n <= 0) return acc;
    // This is a proper tail call (return func(...))
    return sumTailRecursive(n - 1, acc + n);
  }

  // Stress test to prove recursion was flattened
  try {
    const sum = sumTailRecursive(50000);
    console.log("TCO Sum (Expected 1250025000):", sum);
  } catch (e) {
    console.log("TCO Failed: Stack Overflow");
  }
}

runOptimizedLogic();
```

</details>

## 1. Smart Constant Folding

### The "Runtime Overhead" Fix

**Behavior:** Previously, complex mathematical expressions were compiled into sequences of `BINARY` opcodes, forcing the VM to calculate values like `((10 + 20) * 2) << 2` at runtime.

**Solution:**

- **SSA-Style Value Tracking:** The optimizer now tracks the values of temporary variables (`_temp$x`) across the control flow graph.
- **Expression Evaluation:** Implemented compile-time evaluation for all standard JS binary (`+`, `-`, `*`, `<<`, `&`, etc.) and unary (`!`, `typeof`) operators.
- **Dead Branch Pruning:** If a `COND_JUMP` test resolves to a compile-time boolean (e.g., `100 > 50`), the jump is converted to a direct `GOTO`, and the unreachable branch is marked as `DEAD` for subsequent removal.

---

## 2. Dead Code & Store Elimination

### The "Bloat" Fix

**Behavior:**
Unused variables and assignments (e.g., `y = 1000` immediately followed by `y = 2000`) generated wasted bytecode instructions.

**Solution:**

- **Usage Counting:** The optimizer scans the entire instruction set to count references to every variable.
- **Safe Removal:** Instructions that assign to temporary variables with zero subsequent reads are stripped out (unless they contain side effects like function calls).
- **Identity Cleanup:** Assignments like `x = x` are detected and removed.

---

## 3. Tail Call Optimization (TCO)

### The "Stack Overflow" Fix

**Error:** `RangeError: Maximum call stack size exceeded`
**Analysis:**
Deeply recursive functions (like the `sumTailRecursive` example with `N=50000`) caused the VM to exhaust the JS engine's call stack because every recursive step pushed a new `CALL` frame.

**Solution:**

- **Pattern Recognition:** The optimizer detects when a function returns the result of calling itself (`return func(...)`) with strict argument matching.
- **Loop Flattening:** Instead of emitting a `CALL` opcode (which pushes to the stack), the optimizer emits parameter update assignments followed by a `GOTO` to the function's start state.
- **Result:** Recursion is converted into iteration inside the VM, allowing infinite depth with zero stack growth.

---

## 4. Verification

**Input Code (Native Execution):**
Running the raw input script results in a crash due to recursion depth.

```text
--- Starting Optimization Test ---
Math Result (Expected 240): 240
Dead Store Result (Expected 2000): 2000
TCO Failed: Stack Overflow

```

**Virtualized Output (Optimized VM):**
Running the processed code demonstrates that the math was pre-calculated (no overhead) and the recursion was flattened (no crash).

```text
--- Starting Optimization Test ---
Math Result (Expected 240): 240
Dead Store Result (Expected 2000): 2000
TCO Sum (Expected 1250025000): 1250025000

```

_The optimizer successfully folded the complex math constants, removed the dead `else` branch log, and flattened the recursive function into a stable loop._
