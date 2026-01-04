# VortexJS: Global Proxying & Static Analysis

> **Status:** Stable
> **Focus:** Global Function Proxying, String Extraction, and Modern Syntax Support
> **Date:** Dec 15, 2025

This document details the enhancements made to the VortexJS obfuscation engine to support robust hiding of global identifiers (like `setTimeout`, `console`, `Promise`) and ensure compatibility with modern JavaScript syntax. These changes increase the difficulty of reverse engineering by removing readable global references and ensuring structural stability.

---

## 1. The Challenge: Leaking Intent via Globals & Strings

Previous iterations of the obfuscator left critical clues for reverse engineers:

1.  **Direct Global Access:** Calls to `setTimeout`, `setInterval`, and `Promise` were visible as direct assignments (e.g., `M[24] = Promise`). This revealed the code's timing and asynchronous nature immediately.
2.  **Missed Strings:** Generated code (like iterator protocols `next`, `value`, `done`) and object keys (like `{ query: ... }`) introduced identifiers that were not in the string concealment map, causing runtime or compilation crashes.
3.  **Syntactic Gaps:** Modern syntax like Rest parameters (`...args`), Spread operators (`...arr`), and Object Methods (`run() {}`) caused structural crashes in the IR generator.

---

## 2. Implementation Steps & Fixes

### Feature 1: Automatic Global Proxying ("Smart Candidates")

**Severity:** Security Enhancement
**Behavior:**
Instead of accessing globals directly in the VM, the transformer now "preloads" them into the hidden Global Memory (`GM`) array at the start of the script. The IR then replaces all references to these globals with their `GM` index.
**Implementation:**

- **Candidate List:** Expanded `candidateGlobals` in `Transformer.js` to include `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Promise`, `JSON`, `Math`, etc.
- **Scope Analysis:** Updated `analyzeUsedGlobals` to use `path.scope.globals` and `isReferencedIdentifier()`. This correctly detects globals even inside complex expressions (like `new Promise(...)`) where simple AST scans previously failed.
- **Result:** `setTimeout(fn, 100)` becomes `GM[50](fn, 100)`. The string "setTimeout" appears only once in the entire file (during preload) and never in the VM logic.

### Feature 2: Robust String Collection (The "Bulletproof" Collector)

**Severity:** High (Crash Prevention)
**Error:** `Error: String "asyncIterator" was not found in map`
**Analysis:**
The obfuscator generates new code (for loops, classes, async wrappers) that uses standard strings (`next`, `value`, `prototype`) which might not exist in the user's source code. When the `ExpressionHandler` tried to obfuscate these new nodes, the `StringCollector` failed.
**Solution:**

- **Reserved Strings:** Added a `reservedStrings` list to `StringCollector.js` containing essential runtime strings (Iterators, Promises, Object methods).
- **Comprehensive Visitor:** Updated `collect()` to capture:
  - Object Property keys (`{ key: val }` → `"key"`).
  - Class Methods/Properties.
  - Member Access (`obj.prop` → `"prop"`).
- **Result:** Guarantees that _any_ identifier used as a key or member is available in the encrypted string array, preventing all "String not found" errors.

### Feature 3: Modern Syntax Support (Rest/Spread/Methods)

**Severity:** High (Compiler Crash)
**Analysis:**
The IR generation logic previously crashed on modern syntax nodes like `SpreadElement` and `ObjectMethod`.
**Solution:**

- **Spread Support:** Implemented handlers for spread arguments in calls (`fn(...args)`) and arrays (`[...arr]`).
- **Rest Parameters:** Updated function entry logic to correctly slice arguments for rest parameters (`function(...args)`).
- **Method Conversion:** Automatically converts `ObjectMethod` nodes (e.g., `query() { ... }`) into standard `FunctionExpression` nodes during IR generation.

---

## 3. Summary of Verified Behaviors

| Feature             | Input Code           | Obfuscated Output Behavior                    |
| :------------------ | :------------------- | :-------------------------------------------- |
| **Global Proxying** | `setTimeout(f, 100)` | `GM[25](f, 100)` (Hidden Identifier)          |
| **Promise Hiding**  | `new Promise(...)`   | `new GM[12](...)` (Hidden Constructor)        |
| **Member Access**   | `obj.query = 1`      | `obj[_S[42]] = 1` (Encrypted Key)             |
| **Generated Code**  | `for (const x of y)` | Uses `_S[..]` for `next`/`value` (No Crashes) |
| **Spread/Rest**     | `fn(...args)`        | Correctly spreads/slices arguments            |

---

## 4. Work In Progress (WIP)

- **Anonymous Function Virtualization:** Hiding the logic of inline functions (e.g., `(seed => ...)(val)`) by compiling them into VM states is currently under development.
