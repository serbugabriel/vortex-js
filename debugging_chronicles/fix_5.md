# VortexJS: The Generator Protocol

> **Status:** Beta (Feature Complete & Robust)
> **Architecture:** RVM (Recursive Virtual Machine)
> **New Feature:** Generator & Async Iterator Support

This document details the extension of the Recursive Virtual Machine to support JavaScript Generators (`function*`) and the subsequent debugging of loop compatibility and error handling.

## The Challenge: Stateful Resumption

Generators fundamentally differ from standard functions. A standard function runs to completion. A generator **pauses** (`yield`), saves its entire stack and instruction pointer, and **resumes** later.

The RVM's stateless recursion (`M` created fresh on every call) was incompatible with this.

### The Solution: The Persistent Context

1.  **Context Object (`X`):** Instead of passing raw args to `V`, we pass a Context object containing `{ M, S, T }`.
    - `M`: The persistent memory array.
    - `S`: The saved instruction pointer.
    - `T`: The target register to inject the `.next(value)` result into.
2.  **Wrapper:** A special helper in Global Memory (`GM`) initializes this context and returns an object conforming to the **Async Iterator Protocol**.
3.  **Yield Opcode:** Does not "call" anything. It simply saves `S` (next state) into the Context and returns `{ _: 0, v: val }` to the wrapper loop.

---

## The Debugging Saga

### Fix 1: The "Primitive Value" Regression

**Severity:** Critical (Crash)
**Error:** `AST Gen Error: Expected number, got "null". Context: State 6 (YIELD): next state`

**Analysis:**
The `linkStates` function in `ir-generator.js` had a list of "terminal" opcodes (`RETURN`, `THROW`) that should not be automatically linked to the next sequential state. I erroneously added `YIELD` to this list.
In a state machine, `YIELD` is **not** terminal. It is a temporary pause. The machine _must_ know where to go when it wakes up. By preventing the link, the `next` pointer remained `null`.

**Solution:**
Removed `YIELD` from the exclusion list in `linkStates`. The compiler now correctly links the `YIELD` state to the subsequent statement in the logic flow.

### Fix 2: The Loop Protocol Mismatch

**Severity:** High (Runtime Error)
**Error:** `FATAL ERROR: Entered unknown state: undefined` (Implicit) -> `TypeError: eventGenerator is not iterable` (Actual cause masked).

**Analysis:**

- **Source:** `for (const x of gen())` (Synchronous Loop).
- **Compilation:** VortexJS compiles _all_ generators to **Async Generators** (`async function*`) because the underlying VM uses `await` for every operation.
- **Conflict:** A synchronous `for...of` loop cannot consume an Async Iterator. The runtime tried to call `Symbol.iterator`, found `undefined`, and crashed or behaved erratically.

**Solution:**
I rewrote the `ForOfStatement` visitor in `ir-generator.js`.
Instead of blindly compiling to `iterator.next()`, it now generates a hybrid compatible loop:

1.  **Detection:** It checks for `Symbol.asyncIterator` OR `Symbol.iterator`.
2.  **Await:** It wraps the `.next()` call in `await`. Since the VM is an `async` function, this effectively "upgrades" any synchronous loop to an asynchronous one if the data source requires it.

### Fix 3: Global Variable Destructuring

**Severity:** High (Crash)
**Error:** `TypeError: GM[10] is not a function`

**Analysis:**
When destructuring assignments targeted global variables (like `resolve` from `Promise.withResolvers`), the `StatementHandler` logic blindly generated assignments to Local Memory (`M`).
Since `resolve` was allocated as a Global ID (in `GM`), the code wrote to `M[10]` (local garbage) but later tried to read/call `GM[10]` (empty).

**Solution:**
Updated `handleVariableDeclarator` in `ir-statement-handler.js` to perform a scope check (`this.ir.globalIds.has(id)`) for every identifier found inside a destructuring pattern, correctly routing writes to either `M` or `GM`.

### Fix 4: The Iterator Close Protocol (Consumer Side)

**Severity:** Critical (Resource Leak / Logic Error)
**Error:** `finally` blocks inside iterators were not executing when the consuming loop used `break`.

**Analysis:**
When a user writes `break` inside a `for...of` loop, the JavaScript engine calls `iterator.return()` on the source. My IR implementation of `ForOfStatement` was a simple `while` loop that completely ignored this protocol. Consequently, the generator never received the signal to run its cleanup logic.

**Solution:**
Updated `ir-generator.js` to wrap the generated `while` loop in a `try...finally` block.

```javascript
// Generated Logic
try {
  while (!result.done) { ... }
} finally {
  if (!result.done) await iterator.return(); // Signal the generator to close
}
```

### Fix 5: The Naked Finally Shim (IR Side)

**Severity:** High (Control Flow Error)
**Error:** Exceptions or forced returns entering a `try...finally` (without a catch) were swallowed, causing execution to continue linearly instead of propagating.

**Analysis:**
In the State Machine, a `finally` block must know _why_ it was entered (Exception? Return? Break? Normal flow?) to know what to do afterwards.
When a `catch` block exists, it sets the `_FIN` (Finally Reason) register. However, for a "naked" `try...finally`, the `StatementHandler` was linking the error path directly to the `finally` block without setting the `_FIN` register to "Throw" (4).

**Solution:**
Added a "Shim State" in `ir-statement-handler.js`. If an error enters a naked finally, the Shim sets `_FIN = 4` and copies the error value to `_FIN_V` before entering the cleanup block.

### Fix 6: The Magic Token Injection (VM Side)

**Severity:** Critical (Feature Failure)
**Error:** `finally` blocks in generators were unreachable upon external `.return()`.

**Analysis:**
Even if the consumer calls `.return()`, the Vortex VM is just an async function waiting on a state. It doesn't inherently know the generator is closing.
We needed a way to wake up the VM from the outside and force it to jump to its internal `finally` logic.

**Solution:**
Updated the Generator Wrapper in `ast-generator.js`:

1.  **Injection:** Defined a magic token `@@VORTEX_RET`.
2.  **Interception:** When the native generator's `finally` triggers (due to `.return()`), we call `VM(Ctx, "@@VORTEX_RET", true)`.
3.  **Handling:** The VM treats this as an exception, triggering the bytecode's internal exception handler, running the user's `finally` block, and cleanly terminating the generator.

### Fix 7: The Async Promise Unwrapping

**Severity:** Medium (Unexpected Behavior)
**Error:** `undefined` log output when accessing `.value` immediately on a generator result.

**Analysis:**
VortexJS transpiles all generators to **Async Generators** to accommodate the async nature of the RVM.
Code like `const val = gen().next().value` fails because `gen().next()` returns a `Promise`, and `Promise.value` is undefined. The user expects synchronous behavior.

**Solution:**
Updated `ir-expression-handler.js` to detect calls to `.next()`, `.throw()`, and `.return()`.
The compiler now automatically injects an `await` instruction (`AWAIT` opcode) after these method calls. This ensures the VM transparently unwraps the Promise, returning the actual `{ value, done }` object to the virtualized code, maintaining the illusion of synchronous execution where possible.

### Fix 8: The Unified Control Stack (Break vs. Finally)

**Severity:** High (Logic Error)
**Error:** `break` inside a `switch` (or nested loop) prematurely closed the parent loop's iterator (triggered implicit `finally`).

**Analysis:**

- **The Scenario:** A `switch` statement inside a `for...of` loop. The user writes `break` to exit the `switch`.
- **The Conflict:** The `ForOf` loop is wrapped in an implicit `try...finally` (Fix 4). The `StatementHandler` used separate stacks for `try` blocks and `loops`. When processing `break`, it checked the `try` stack first. It incorrectly assumed the `break` was exiting the implicit `try`, triggering the iterator cleanup code (`iterator.return()`).
- **Result:** The generator was closed immediately after the first `yield`, regardless of the loop logic.

**Solution:**
Implemented a unified `controlStack` in `ir-generator.js`.

1.  **Unified Stack:** `LOOP`, `SWITCH`, and `TRY` contexts are pushed onto a single stack in the order they occur.
2.  **Smart Resolution:** `handleBreakStatement` walks up this stack.
3.  **Targeting:** It finds the nearest valid target (`SWITCH` or `LOOP`).
4.  **Boundary Check:** It only generates `finally` triggers (`_FIN = 2`) if it encounters a `TRY` context _between_ the current position and the break target. If the target is reachable without crossing a `finally` boundary (e.g., inside the same try block), it generates a simple `GOTO`.

---

## Current Status

**Generators are fully operational and robust.**

**Features Verified:**

- `function*` compilation to Async Generator Wrapper.
- `yield` pausing and resuming with state preservation.
- `for...of` loops seamlessly handling the transformed Async Iterators.
- Global/Local scope resolution working correctly within generators.
- **Advanced Control Flow:** `break` in loops correctly triggers `finally` blocks inside the generator (Iterator Close Protocol).
- **Nested Control Flow:** `break` in `switch` correctly exits only the switch, respecting the unified control stack.
- **Exception Propagation:** `try...finally` blocks correctly handle and re-throw errors without swallowing them.
- **Async Transparency:** Manual calls to `.next()` are automatically awaited, fixing synchronous usage patterns.
