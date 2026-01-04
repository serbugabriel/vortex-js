### The Diagnosis: Global Register Collision

The crash (`FATAL ERROR: Entered unknown state: undefined`) happens because the flattened state machine simulates a **Single-Threaded CPU** using global registers (`M` array) and a global instruction pointer (`S`).

When `Promise.all` triggers multiple async calls:

1.  **Call A (`fetchUser(1)`)** starts, sets global registers (e.g., `M[50]`), and hits `await`. It yields control.
2.  **Call B (`fetchUser(2)`)** starts immediately (before A resumes). It uses **the same global `M` indices** and the same `S`.
3.  **Collision:** Call B overwrites the data `Call A` stored in `M`.
4.  **Crash:** When `Call A` resolves and resumes, it reads the overwritten (garbage) data, calculates an invalid `next_state`, and crashes.

---

# Plan: The "Heap-Stack Separation" Architecture

To support concurrency (`Promise.all`), we must move from a **Static Global Register** model to a **Dynamic Stack Frame** model, while keeping the "Unified Memory" (`M`) concept for obfuscation.

## 1. The Concept: Heap vs. Stack

We will split the Unified Memory `M` into two logical regions:

1.  **Global Heap (Static):** Stores global variables, strings, and the Stack Pointer (`_SP`).
2.  **Stack Heap (Dynamic):** A region where functions dynamically allocate a "Block" of memory (a Frame) when they start.

Instead of accessing variables at hardcoded indices (e.g., `M[50]`), instructions will access them **relative to a Frame Pointer** (e.g., `M[FP + 0]`).

## 2. Implementation Steps

### Step A: Redefine the Output Structure

We cannot use a top-level `while(true)` loop for the entire program anymore because `await` needs to pause _one_ thread without blocking others.

**New Structure:**
The "Dispatcher" becomes a reusable `async` function. Every time a function is called, we invoke this Dispatcher.

```javascript
// Global Memory (Heap)
const M = new Array(10000);
// Global Pointers
const _SP_IDX = 0; // Index in M where Stack Pointer is stored
M[_SP_IDX] = 1000; // Start stack at index 1000

// The "Virtual Machine" Runner
const VM = async (startState, args) => {
  // 1. ALLOCATE FRAME
  // Atomic increment of Stack Pointer to reserve space for this function's locals
  const frameSize = 50; // Calculated during compilation
  const FP = M[_SP_IDX]; // Capture current Stack Pointer as Frame Pointer
  M[_SP_IDX] += frameSize; // Bump the pointer for the next thread

  // Copy arguments into the new Frame
  // args[0] -> M[FP + 0]

  let S = startState; // Local State Pointer

  try {
    dispatcher_loop: while (true) {
      switch (S) {
        case 10: // AWAIT instruction
          // Waits without blocking other VM instances
          const promise = M[FP + 5]; // Access relative to FP
          const res = await promise;
          M[FP + 6] = res;
          S = 11;
          break;

        case 20: // CALL instruction (Async)
          // Spawns a new VM instance for the callee
          // This handles the concurrency!
          const result = await VM(targetState, [arg1, arg2]);
          M[FP + 7] = result;
          break;

        case 99: // RETURN
          return M[FP + 1];
      }
    }
  } finally {
    // 2. FREE FRAME (Simple garbage collection)
    // In a real allocator we'd free, but for obfuscation,
    // we can either let it grow or implement a bitmap allocator.
    // Ideally: M[_SP_IDX] -= frameSize; (Only safe if LIFO, strictly)
    // Since Promise.all breaks LIFO, we treat M as a linear allocator
    // that resets only on full program restart, or use a specific "Heap Manager" logic.
  }
};

// Entry Point
VM(ENTRY_STATE, []);
```

### Step B: AST & IR Transformer Updates

#### 1. Analyze Variable Scopes (`transformer.js`)

Currently, you map every variable to a static index. You must split this map:

- **Map A (Globals):** `console`, `Promise`, module-level vars -> **Static Index** in `M`.
- **Map B (Locals):** Function arguments, `_temp` vars, local `let/const` -> **Relative Offset** (0, 1, 2...).

#### 2. Rewrite IR Generation (`ir-generator.js`)

When generating IR for a function, track the number of local variables to calculate `frameSize`.

Change IR Opcodes to support addressing modes:

- `ASSIGN` currently: `M[50] = M[51]`
- `ASSIGN` new: `M[FP + 0] = M[FP + 1]`

#### 3. Rewrite AST Generator (`ast-generator.js`)

The `ASTGenerator` needs the biggest overhaul.

- **Instruction Compilation:**
  - Identify if a variable is Global or Local.
  - If Local: Generate `t.memberExpression(M, t.binaryExpression("+", FP, t.numericLiteral(offset)))`.
  - If Global: Generate `t.memberExpression(M, t.numericLiteral(staticIndex))`.
- **The Dispatcher Wrapper:**
  - Wrap the `switch(S)` block inside an `async function runVM(S, FP) { ... }`.
  - Inject the Frame Allocation logic at the start of `runVM`.

### Step C: Handling `await` and `CALL`

This is the "Clever" part. We treat `CALL` differently based on context.

1.  **Async Call (The Fix):**
    When State A calls Function B:
    - Instead of `S = FunctionB_Start`, we generate:
      ```javascript
      // Pass M (shared) implicitly
      const retVal = await runVM(FunctionB_Start, [args...]);
      M[FP + dest] = retVal;
      ```
    - This forces the JS engine to handle the context switching between the two "threads".

2.  **Synchronous Optimization:**
    If you detect the function is _not_ async, you _could_ technically jump `S` directly (flattening it), but you would still need to manually shift `FP` (Frame Pointer) to prevent variable collision.
    _Recommendation:_ For stability, treat ALL function calls as `await runVM(...)` initially. It ensures `Promise.all` works perfectly because every function gets a distinct slice of `M`.

## 3. The Detailed Plan (Checklist)

1.  **Modify `Transformer` Context:**
    - Add `localMemoryMap` to `functionContext`.
    - Reset `localMemoryMap` when entering a `FunctionDeclaration`.
    - Store `maxFrameSize` for each function.

2.  **Update `ExpressionHandler` / `StatementHandler`:**
    - When processing identifiers, check if they are in `localMemoryMap`.
    - If yes, tag the IR operand as `{ type: 'LOCAL', offset: x }`.
    - If no (it's global), tag as `{ type: 'GLOBAL', index: y }`.

3.  **Refactor `ASTGenerator`:**
    - **Structure:** Create the `async function runner(S, args)` template.
    - **Preamble:** Inject `const FP = M[0]; M[0] += LOCAL_SIZE;` at the start of the runner.
    - **Argument Loading:** Generate code to copy `args` array into `M[FP + 0]`, `M[FP + 1]`, etc.
    - **Operand Resolver:** Create a helper `getMemoryAccess(operand)`:
      - Returns `M[operand.index]` if global.
      - Returns `M[FP + operand.offset]` if local.
    - **Call Handling:**
      - Compile `CALL` opcodes to `await runner(calleeState, [args])`.

4.  **Memory Management (The "Unified" Trick):**
    - Since `Promise.all` runs things out of order, you cannot simply decrement `_SP` (Stack Pointer) when a function returns (the "Stack" is now a "Tree").
    - **Solution:** Use a simple **Bump Allocator**. Just keep increasing `M[0]`.
    - **Cleanup:** To prevent `M` form exploding in infinite loops, implement a circular buffer logic or, strictly for obfuscation purposes, just allocate a very large `M` (e.g., 1MB) which acts as the heap.

## 4. Why This Works

- **Concurrency:** `Promise.all` spawns 3 native JS Promises. Each Promise triggers `runVM`.
- **Isolation:** Each `runVM` grabs a _unique_ `FP` (e.g., 1000, 1050, 1100).
- **Unified Memory:** All threads still read/write to the single `M` array, preserving the obfuscation aesthetic and making reverse engineering hard (pointers are dynamic).
- **State Machine:** The control flow within a function is still flattened into `switch(S)`, masking the logic.

### Pseudo-Code Comparison

**Current (Buggy):**

```javascript
// Shared State
let S = 0;
let M = [0, 0, 0];

// Promise.all triggers 2 of these concurrently
async function main() {
  while (true) {
    // Thread A writes M[1]
    // Thread B writes M[1] (COLLISION!)
  }
}
```

**New (Safe):**

```javascript
let M = [0, 0, ...]; // Heap
let HeapPtr = 0;

async function VM(S, args) {
   // Unique workspace for this call
   let FP = HeapPtr; HeapPtr += 50;

   while(true) {
      // Thread A writes M[FP_A + 1] (M[1])
      // Thread B writes M[FP_B + 1] (M[51])
      // NO COLLISION.
   }
}
```

### Advice for Moving Forward (IF I want an easier life)

If I want to finish this without losing my mind:

1.  **Compromise on "Monolithic":**
    The "Global Heap Collision" happens because _everything_ shares one `M` array.
    - **Alternative:** Instead of one global `M`, let every call to the dispatcher create its _own_ `local_M`.
    - `const VM = async (S, M = []) => { ... }`
    - Pass `M` down to synchronous calls. Create a _new_ `M` (copy or fresh) for async calls. This relies on JS garbage collection and closures to handle the memory isolation, sparing you from writing a Memory Allocator.
