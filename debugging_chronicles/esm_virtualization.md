# VortexJS: ESM Support & Advanced Virtualization

> **Status:** Stable
> **Focus:** ES Modules, Dynamic Imports, Concurrency, and Template Literal handling
> **Date:** Jan 04, 2026

This document records the implementation of full ECMAScript Module (ESM) support, the resolution of critical string encoding issues, and the verification of production-grade virtualization capabilities.

---

## 1. ES Module Support (ESM)

### Feature 1: Static Import/Export Preservation

**Requirement:** Browser and Node.js environments require static `import` and `export` statements to appear at the top-level of the file, outside of any logic blocks.
**Implementation:**
The `StateMachineTransformer` now performs a pre-processing pass:

1.  **Extraction:** Scans the AST for `ImportDeclaration` and `ExportDeclaration` nodes.
2.  **Hoisting:** Moves these nodes to the very top of the generated output, ensuring they exist outside the Virtual Machine's scope.
3.  **Binding:** The VM treats imported identifiers (e.g., `chalk`, `fs`) as "preloaded globals" or external references, allowing the virtualized logic to interact with dependencies seamlessly.

### Feature 2: Dynamic Import Virtualization

**Requirement:** Support for `await import('module')` within the virtualized code.
**Implementation:**
Dynamic imports are treated as runtime expressions rather than static declarations.

1.  **IR Generation:** `ir-expression-handler.js` detects `Import` nodes and generates an `EXTERNAL_CALL` opcode with the special callee marker `"import"`.
2.  **Dispatcher:** The `BaseDispatcher` recognizes this marker and emits a valid `import()` expression inside the bytecode loop, ensuring the import is evaluated at runtime while its specifier string remains encrypted.

---

## 2. Critical Fixes

### Fix 1: Template Literal Double-Escaping

**Severity:** Critical (Syntax Error in Runtime)
**Symptom:** Code generation involving Template Literals (e.g., generating code for a VM inside a VM) failed with `SyntaxError: Invalid or unexpected token`.
**Analysis:**
The `StringCollector` was previously harvesting the `.raw` value of `TemplateElement` nodes.
When Babel regenerated these strings using `t.stringLiteral`, it escaped the backslashes again. A source string like `\` `(escaped backtick) became`\\` ` in the output. When the target VM tried to evaluate this, it saw an invalid escape sequence.
**Solution:**
Updated `StringCollector`, `ir-expression-handler.js`, and `ir-generator.js` to use the `.cooked` value of template elements. This ensures that the string content is stored exactly as it should appear in memory, preventing double-escaping during AST regeneration.

---

## 3. Advanced Virtualization Capabilities

The following capabilities have been verified via the `vm escape attempts + parallel async stress` torture test.

### Capability 1: True Concurrency & State Isolation

**Verification:** Running 4 parallel VMs executing async tasks with random delays (`Promise.all`).
**Outcome:** Zero state pollution.
The VM's stack (`VS`) and memory (`M`) management correctly isolates the context of suspended functions. Even when the event loop interleaves execution between different "threads" (logical contexts) of the obfuscated code, data remains consistent.

### Capability 2: Async Generators & Iterators

**Verification:** `async *runTasks(n)` using `for await...of`.
**Outcome:** Correct pause/resume behavior.
The VM successfully handles the dual-pause nature of async generators (pausing for `await` Promises and pausing for `yield` values) without losing the instruction pointer or stack frame.

### Capability 3: Private Class Fields

**Verification:** Class `Service` using `#name`.
**Outcome:** Secure encapsulation.
The `ClassHandler` successfully virtualizes private fields by transpiring them into `WeakMap` lookups, preserving the privacy semantics even within the virtualized environment.

---

## 4. Summary of Verified Behaviors

| Feature              | Scenario                               | Status                      |
| :------------------- | :------------------------------------- | :-------------------------- |
| **Static ESM**       | `import ... from ...` at top level     | **Preserved & Working**     |
| **Dynamic ESM**      | `await import('chalk')`                | **Virtualized & Resolving** |
| **Meta-Programming** | Generating code strings with backticks | **Correctly Escaped**       |
| **Concurrency**      | Parallel VMs with `setTimeout`         | **Perfect Isolation**       |
| **Security**         | `try/catch` escape attempts            | **Blocked (Correct Scope)** |
| **Runtime**          | Node.js `vm` module compatibility      | **Fully Compatible**        |
