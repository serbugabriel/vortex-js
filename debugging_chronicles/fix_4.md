# VortexJS: The Concurrency Update & Debugging Chronicle

> **Status:** Stable
> **Architecture:** Recursive Virtual Machine (RVM)
> **Focus:** Native Concurrency, Scope Isolation, and ES6+ Feature Support.

This document records the development journey from a linear, monolithic state machine to a robust, recursive architecture capable of handling modern JavaScript concurrency patterns.

## The Paradigm Shift: From Monolith to Recursion

### The Problem: Global State Collision

In the previous version, VortexJS simulated a CPU with a single global memory array (`M`) and a single instruction pointer (`S`). While this worked perfectly for synchronous code, it catostrophically failed with `async/await`.

**The Scenario:**

1.  `funcA` starts, uses memory indices `M[10..20]`, hits `await`, and yields.
2.  `funcB` (running in parallel via `Promise.all`) starts. It uses the **same** memory indices `M[10..20]`.
3.  `funcB` overwrites `funcA`'s data.
4.  `funcA` resumes, reads corrupted data, and crashes or behaves unpredictably.

### The Solution: The Recursive VM

We abandoned the "Single CPU" simulation in favor of a **Recursive Virtual Machine**. Instead of managing stack frames manually in a flat array, we leverage the JavaScript engine's own call stack.

- **Global Memory (`GM`)**: Read-only storage for constants, strings, and global built-ins (`console`, `Math`).
- **Local Memory (`M`)**: A fresh array created for _every_ function call.
- **The VM**: An `async` function that takes a Start State and Arguments. It runs its own loop, isolated from other instances.
- **Recursion**: A `CALL` opcode no longer jumps `GOTO`-style; it performs `await VM(target, args)`.

---

## The Debugging Saga

Following the architectural rewrite, several critical regressions and edge cases emerged.

### Fix 1: The "Primitive Value" Regression

**Severity:** Critical (Crash)
**Error:** `TypeError: t.valueToNode is not a function`

**Analysis:**
During the optimization phase, `ASSIGN_LITERAL` states were converted to `ASSIGN_LITERAL_DIRECT` to inject raw AST nodes into the output. However, the logic assumed `op.value` was always a Babel AST node. When the optimizer encountered a primitive `undefined` or `null`, it passed it directly to the AST generator, which choked.

**Solution:**
Restored the safety check in `ast-generator.js`. If `op.value` is not an object (AST node), it is explicitly converted using `t.valueToNode()`.

```javascript
// Fix in ast-generator.js
case "ASSIGN_LITERAL_DIRECT": {
    const valueNode = (op.value && typeof op.value === 'object' && op.value.type)
        ? op.value
        : t.valueToNode(op.value); // <--- Safety restored
    caseBody.push(assign(mem(op.to, "dest"), valueNode));
    break;
}
```

### Fix 2: The "Destructuring" Gap

**Severity:** High (Functional Failure)
**Error:** Incorrect variable initialization in function signatures.

**Analysis:**
The new VM architecture requires explicit parameter unpacking at `FUNC_ENTRY`. The initial implementation only handled simple identifiers (`function(a, b)`). Complex patterns like `function({ x }, [y = 1])` were ignored, leading to `undefined` variables inside the function body.

**Solution:**
Implemented a recursive `unpack` helper in `ast-generator.js`. It traverses `ObjectPattern` and `ArrayPattern` nodes, mapping the incoming `args` array (passed to the VM) to specific memory slots (`M`), handling default values along the way.

### Fix 3: The Scope War (Global vs. Local)

**Severity:** Critical (Logic Error)
**Error:** `TypeError: GM[10] is not a function`

**Analysis:**
This was the most complex issue. The AST Transformer splits variables into `GM` (Global Memory) and `M` (Local Memory).
However, `ir-statement-handler.js` logic for **Variable Declarations with Destructuring** (`const { resolve } = Promise.withResolvers()`) blindly assumed all targets were local.

It generated code like `M[10] = ...`, but the transformer had allocated `resolve` as a Global ID (because it matched a known global logic path or preloading strategy). Later, code tried to access it via `GM[10]`, found it empty, and crashed.

**Solution:**
Updated `handleVariableDeclarator` in `ir-statement-handler.js` to perform a scope check during pattern processing.

```javascript
// Fix in ir-statement-handler.js
const targetArray = this.ir.globalIds.has(targetMemIdx) ? GM : M; // <--- The Decision logic
const targetMemExpr = t.memberExpression(
  targetArray,
  t.numericLiteral(targetMemIdx),
  true,
);
```

### Fix 4: The Return Value Wrapper

**Severity:** Medium (Async Behavior)
**Error:** `Promise` resolving to `undefined`.

**Analysis:**
In the Recursive VM, `await VM(...)` returns the result of the function. However, `async` functions in JS automatically unwrap Promises. If the VM returned a raw value, distinguishing between "Function returned a Promise" and "Function returned a value" became ambiguous in the internal VM logic.

**Solution:**
Wrapped all return values in a container object `{ _: value }`.

1.  **RETURN Opcode**: `return { _: M[val] }`
2.  **CALL Opcode**: `(await VM(...))._`

This ensures that the VM's internal mechanics are isolated from the user-land values it is processing.

---

## Current Status

The **Recursive Virtual Machine** is now stable. It successfully passes the `async-withresolv.js` test case (which combines manual Promise resolution, timeouts, and callbacks) and the `Promise.all` concurrency tests.

**Capabilities:**

- [x] True Async Concurrency (No shared state collisions).
- [x] Scope Isolation (Globals in `GM`, Locals in `M`).
- [x] Complex Destructuring (`const {a} = b`).
- [x] Default Parameters.

**Known Limitations:**

- `YieldExpression` / Generators are not yet supported (requires a different state machine model).
