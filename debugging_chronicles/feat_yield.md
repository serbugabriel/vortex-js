# 🧠 Architectural Blueprint: The Persistent Context Model

We will move the responsibility of "Memory Allocation" **out** of the `VM` function and **into** a wrapper. The `VM` function transforms from an "Execution Container" into a "Step Executor."

### 1. The New Runtime Object: `GeneratorContext`

Instead of passing raw args to the VM, we pass a Context Object.

```javascript
// Conceptual Structure
const Context = {
    M: [...],       // The persistent memory stack
    S: 0,           // The instruction pointer (saved on yield)
    status: 'RUNNING' | 'SUSPENDED' | 'DEAD',
    gm: GM,         // Reference to global memory
};
```

### 2. The Interaction Flow

1.  **Initialization:** Calling `myGenerator()` does **not** run the VM. It allocates `M`, sets `S=0`, and returns an **Iterator Interface** (`{ next, throw, return }`).
2.  **`iter.next(val)`:** This invokes the VM, passing the stored `Context` and the input `val`.
3.  **VM Execution:** The VM runs until it hits a `YIELD` opcode.
4.  **Yielding:**
    - The VM saves the current `S` (next instruction) back into the `Context`.
    - The VM returns a special signal: `{ type: 'YIELD', value: ... }`.
5.  **Resuming:** The next `.next()` call re-enters the VM using the saved `M` and `S`.

---

# 📋 Implementation Plan

## Phase 1: IR Generation Updates (`src/ir-gen`)

We need to recognize generator functions and new opcodes.

### 1.1 Update `IRGenerator`

- **Flag Generators:** In `transformToStates`, detect if `FunctionDeclaration` is a generator (`path.node.generator`).
- **Context Flag:** Store `isGenerator: true` in `functionContext`.

### 1.2 Update `ExpressionHandler`

- **Handle `YieldExpression`:**
  - **Input:** `yield x`
  - **Opcode:** `YIELD`
  - **Logic:**
    1.  Evaluate `x`.
    2.  Store `x` in a temp var (to be returned).
    3.  **Crucial:** Create a variable to receive the result of the yield (what passes in via `.next(val)`).
- **Handle `YieldExpression` (Delegate):**
  - **Input:** `yield* x`
  - **Opcode:** `YIELD_STAR`
  - **Logic:** This requires a sub-loop in the IR (Get iterator -> Loop -> Yield -> Check Done -> Break).

### 1.3 Update `StatementHandler`

- **No changes needed** (Control flow remains flattened; yielding is just an expression).

---

## Phase 2: The Runtime (AST Generation)

This is the heavy lifting. We need to modify `ast-generator.js` to support the "Persistent Context."

### 2.1 The New VM Signature

Change the `VM` function signature in the generated code.

**Current:**

```javascript
const V = async (S, A) => { let M = ...; ... }
```

**Proposed:**

```javascript
const V = async (Ctx, InputVal) => {
    let M = Ctx.M; // Use persistent memory
    let S = Ctx.S; // Restore state

    // Inject InputVal (result of .next()) into the register waiting for it
    if (Ctx.yieldReg !== null) {
        M[Ctx.yieldReg] = InputVal;
        Ctx.yieldReg = null;
    }

    try {
        while(true) {
            switch(S) {
                // ... logic ...

                case 50: // YIELD Opcode
                    Ctx.S = 51; // Save Next State
                    return { status: 'YIELD', value: M[10] }; // Exit VM

                case 99: // RETURN Opcode
                    return { status: 'DONE', value: M[11] };
            }
        }
    } catch (e) { ... }
}
```

### 2.2 The Generator Wrapper

We need a helper function in the runtime (`GM` section) to construct the Iterator interface.

```javascript
GM[20] = function generatorWrapper(startState, args) {
  // 1. Allocate Memory ONCE
  const M = new Array(SIZE);
  M.set(GM); // Copy globals
  // ... unpack args into M ...

  // 2. Create Context
  const ctx = { M, S: startState, yieldReg: null };

  // 3. Return Iterator
  return {
    next: async (val) => {
      const res = await V(ctx, val);
      if (res.status === "YIELD") return { value: res.value, done: false };
      return { value: res.value, done: true };
    },
    // TODO: Implement throw() and return() similarly
  };
};
```

---

## Phase 3: Handling `yield*` (Delegation)

`yield*` is complex because it delegates control to _another_ iterator. Instead of creating a massive IR loop for every `yield*`, we implement a **Runtime Helper**.

1.  **Opcode:** `YIELD_STAR`
2.  **Operands:** `iterator` (the object to delegate to).
3.  **VM Logic (Pseudocode):**
    ```javascript
    case YIELD_STAR:
        // We cannot block the VM here with a simple loop because we need to
        // bubble 'next()' calls down to the child iterator.

        // Strategy:
        // 1. We assume 'M[iter]' holds the child iterator.
        // 2. We return a special signal to the wrapper.
        return { status: 'DELEGATE', iterator: M[iter] };
    ```
4.  **Wrapper Update:** The wrapper handles the 'DELEGATE' status by forwarding `.next()` calls to the child iterator until it's done, then resuming the VM.

---

## Phase 4: Step-by-Step Execution Plan

### Step 1: Refactor `ast-generator.js` for Context-Based VM

- Modify `buildFinalAST` to generate the new `VM(Ctx, Input)` signature.
- Update `CALL` opcodes to pass a temporary context for standard functions (Standard functions become a subset of generators that never yield).

### Step 2: Implement `YIELD` Opcode

- Add `handleYieldExpression` in `ir-expression-handler.js`.
- Add `case "YIELD"` in `ast-generator.js`.
  - Logic: Update `Ctx.S`, Return `{ type: 'YIELD', val }`.

### Step 3: Implement Generator Initialization

- In `ast-generator.js`, inside the loop that creates function wrappers:
  - Check if the function ID corresponds to a generator.
  - If yes, use the `generatorWrapper` template (creates closure with persistent `M`).
  - If no, use the `asyncWrapper` template (creates fresh `M` and awaits result).

### Step 4: Add `Symbol.iterator` Support

- Ensure the returned object from the generator wrapper has `[Symbol.iterator]`.
  ```javascript
  return {
      next: ...,
      [Symbol.iterator]: function() { return this; }
  }
  ```

---

## 🔒 Security Implications (Obfuscation)

This approach maintains high security:

1.  **State Hiding:** The "Generator State" is just an integer `S` inside a closure. It's not visible as a switch-case object on the prototype.
2.  **Memory Hiding:** The `M` array is hidden inside the closure of the returned iterator.
3.  **Control Flow:** The `yield` points look exactly like any other state transition, making it hard to statically determine where the generator pauses versus where it calculates logic.

## ⚠️ Risks & Mitigations

1.  **Async vs Sync:**
    - _Risk:_ Native JS Generators are synchronous. Our VM is `async`.
    - _Mitigation:_ We will implement **Async Generators** (`async function*`) semantics by default. If the user compiles a sync generator, it will return a Promise-based iterator. This breaks specific sync-only contracts (like `redux-saga` requiring sync generators), but is unavoidable in a recursive async VM. We must document this limitation: **"VortexJS converts all Generators to Async Generators."**

2.  **Performance:**
    - _Risk:_ `yield*` overhead.
    - _Mitigation:_ Keep the delegation logic in the static helper (`GM`) rather than generating IR instructions for it, keeping the flattened code smaller.
