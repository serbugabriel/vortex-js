### **VortexJS: Sync/Async Adaptability & Proxy Compatibility**

> **Status:** Stable
> **Focus:** Synchronous Execution, Constructibility, Context Propagation (`this`, `new.target`), and Performance
> **Date:** Dec 23, 2025

This document details the critical fixes applied to the VortexJS obfuscation engine to support synchronous proxies, correct context binding, and meta-properties. These changes resolve runtime type errors and significant logic bugs where asynchronous wrappers broke standard JavaScript synchronous expectations.

---

## 1. The Challenge: The "Async-Everywhere" Pitfall

The previous iteration of the VM wrapped _all_ code in `async` functions to support modern `await` syntax. While robust for async code, this architecture failed for synchronous operations:

1. **The "NaN" Bug:** Synchronous Proxy traps (like `apply`) expected immediate return values. The VM returned a `Promise`, leading to math errors (e.g., `Promise * 2 = NaN`).
2. **Constructibility Error:** Wrapper functions were generated as Arrow Functions (`() => {}`), which lack a `[[Construct]]` method. Trying to instantiate them via `new Proxy(...)` threw `TypeError: ... is not a constructor`.
3. **Lost Context (`this`):** The VM did not capture or restore the execution context (`this`), causing crashes when accessing class properties inside obfuscated methods.
4. **Missing Meta-Properties:** Usage of `new.target` caused the build to fail with `Unsupported expression type: MetaProperty`.

---

## 2. Implementation Steps & Fixes

### Feature 1: Adaptive Synchronous VM (The "NaN" Fix)

**Severity:** Critical (Logic & Performance)
**Error:** `NaN` in output / Massive overhead for sync code.
**Analysis:**
The VM forced every function call into the microtask queue (Promises), even for simple math. This broke standard JS hooks like `Proxy.apply` which require synchronous return values.
**Solution:**

- **Static Analysis:** The `ASTGenerator` now pre-scans the Intermediate Representation (IR) for `AWAIT` opcodes or `async` flags.
- **Conditional Compilation:**
- **Sync Mode:** If no async features are used, the VM is generated as a standard synchronous function. Wrappers return values immediately via `.v`.
- **Async Mode:** Retains the original Promise-based architecture only when necessary.

- **Result:** Proxy traps work correctly, and synchronous code runs significantly faster by bypassing the microtask queue.

### Feature 2: Constructible Wrappers

**Severity:** High (Runtime Crash)
**Error:** `TypeError: GM[...] is not a constructor`
**Analysis:**
The obfuscator generated wrappers using Arrow Functions (`const wrapper = (args) => ...`). These cannot be instantiated with `new`.
**Solution:**

- **Function Expressions:** Changed wrapper generation to use standard `function(...args) { ... }` expressions.
- **Promise Chaining:** In async mode, these functions explicitly return the VM's promise chain.
- **Result:** Obfuscated functions (and Proxies wrapping them) can now be instantiated using `new ClassName()`.

### Feature 3: Context Propagation (`this` & `new.target`)

**Severity:** High (Logic Preservation)
**Error:** `TypeError: Cannot set properties of undefined (setting 'x')`
**Analysis:**
The VM was isolated from the caller's context. Accessing `this` inside an obfuscated function pointed to `undefined` (in strict mode) or the global object, rather than the instance. `new.target` was similarly undefined.
**Solution:**

- **Register Allocation:** Allocated dedicated registers `_THIS` and `_NEW_TARGET` in the memory map.
- **VM Signature Update:** Updated the VM to accept `this` and `new.target` as optional arguments (arguments 4 and 5).
- **Wrapper Update:** Wrappers now capture their context (`t.thisExpression()`, `t.metaProperty(...)`) and pass it into the VM during initialization.
- **Result:** Classes and prototype methods function correctly, maintaining access to their instance state.

---

## 3. Summary of Verified Behaviors

| Feature             | Input Code             | Previous Output (Bug)           | Fixed Output (Behavior)  |
| ------------------- | ---------------------- | ------------------------------- | ------------------------ |
| **Sync Proxies**    | `Proxy.apply(...) * 2` | `NaN` (Promise \* 2)            | `Number` (Correct Value) |
| **Constructors**    | `new Proxy(Func)`      | **Crash:** Not a constructor    | Instance Created         |
| **Context**         | `this.x = 5`           | **Crash:** Setting on undefined | Property Set on Instance |
| **Meta Properties** | `new.target`           | **Build Fail:** Unsupported     | Correct Target Class     |

---

## 4. Technical Debt Resolved

- **Microtask Overhead:** Synchronous code no longer incurs the penalty of Promise resolution for every instruction tick.
- **Wrapper Correctness:** Wrappers now fully adhere to the ES6 function specification regarding constructibility.
