# Architecture Update: The Recursive Virtual Machine

**Status:** Critical Path Fix - Proposal [APPROVED]
**Target:** Solving Global State Collision in Async Contexts (`Promise.all` Crash)
**Strategy:** "Native Scope Isolation" (Recursive Dispatcher)

## The Diagnosis: Global Register Collision

The crash (`FATAL ERROR: Entered unknown state: undefined`) happens because the flattened state machine simulates a **Single-Threaded CPU** using global registers (`M` array) and a global instruction pointer (`S`).

When `Promise.all` triggers multiple async calls:

1.  **Call A (`fetchUser(1)`)** starts, sets global registers (e.g., `M[50]`), and hits `await`. It yields control.
2.  **Call B (`fetchUser(2)`)** starts immediately (before A resumes). It uses **the same global `M` indices** and the same `S`.
3.  **Collision:** Call B overwrites the data `Call A` stored in `M`.
4.  **Crash:** When `Call A` resolves and resumes, it reads the overwritten (garbage) data, calculates an invalid `next_state`, and crashes.

## 2. The Solution: Recursive Isolation

Instead of building a complex memory allocator (calculating stack frames, frame pointers, and offsets manually), we will use a **Recursive Dispatcher**.

We will change the VM from a global loop to a reusable `async` function. Every time the code performs a function call, we spawn a **new instance** of the VM.

### How it solves the crash:

JavaScript functions create their own scope. By making `M` a local variable inside the VM function, **Thread A and Thread B get their own completely separate `M` arrays.** They can no longer overwrite each other.

## 3. The New Architecture

### 3.1. Memory Layout

- **`GlobalM` (Static):** A read-only array containing constants, strings, and global references (like `console`, `Math`). This is created once at the top of the file.
- **`LocalM` (Dynamic):** Created fresh every time a function starts. It is initialized by copying `GlobalM`. All local writes happen here.

### 3.2. The Runtime Code Structure

The `ast-generator.js` will now output code that looks like this:

```javascript
// 1. Static Global Memory (Strings, Built-ins)
const GlobalM = [...shuffledStrings, console, Math, Object];

// 2. The Reusable VM Function
const VM = async (startState, args) => {
  // --- MEMORY ISOLATION ---
  // Create a local memory space for THIS function call.
  // We copy globals so we can access them, but writes stay local.
  let M = [...GlobalM];

  // Load arguments into specific memory slots (Parameter Mapping)
  // (The IR Generator tells us which slots params belong to)
  if (args) {
    M[10] = args[0];
    M[11] = args[1];
  }

  let S = startState;
  let _RET_VAL = undefined;

  // The Standard Dispatcher Loop
  dispatcher_loop: while (true) {
    try {
      switch (S) {
        // ... Standard Ops (Binary, Assign) use 'M' normally ...

        // --- CONCURRENCY FIX: AWAIT ---
        case 50:
          // Because 'M' is local to this specific closure,
          // pausing here is safe. Other VM instances have their own 'M'.
          M[20] = await M[19];
          S = 51;
          break;

        // --- CONCURRENCY FIX: FUNCTION CALLS ---
        case 60:
          // Instead of GOTO, we recurse.
          // This creates a NEW stack frame natively in JS.
          // We pass the target state and the arguments.
          const result = await VM(100, [M[5], M[6]]);
          M[7] = result;
          S = 61;
          break;

        // --- RETURN ---
        case 99:
          return M[1]; // Return the value to the caller VM
      }
    } catch (e) {
      // ... Exception Handling ...
    }
  }
};

// 3. Entry Point
// Start the VM at state 0 (Program Start)
VM(0, []);
```

## 4. Implementation Checklist

This approach requires significantly fewer changes than the manual stack frame approach.

### Step 1: Update `transformer.js` (Parameter Mapping)

We need to know which memory index corresponds to which function parameter so we can load `args` into `M` correctly at the start of `VM`.

- **Action:** When `allocateMemory` runs, store a mapping of `FunctionName -> [Param1_Index, Param2_Index]` in the `functionContext` or a new map.

### Step 2: Update `ir-generator.js` (The Call Opcode)

We need to change how `CALL` works. It should no longer be a jump within the same loop.

- **Current `CALL` logic:** Sets `S` to target, pushes return state to simulated stack.
- **New `CALL` logic:**
  - State Type: `RECURSIVE_CALL`.
  - Properties: `targetFuncStateId`, `argsList`, `destVar` (where to store result).
  - **No return address needed:** The `await` keyword handles the return address for us natively.

### Step 3: Update `ast-generator.js` (The Wrapper)

This is where the biggest change happens.

1.  **Remove** the global `M`, `S`, and top-level `while(true)` loop.
2.  **Create** the `GlobalM` array declaration containing preloaded values.
3.  **Generate** the `async function VM(S, args)` wrapper.
4.  **Inject** the initialization logic: `let M = [...GlobalM];` at the top of the function.
5.  **Inject** argument loading: Generate code that assigns `args[i]` to the specific memory indices collected in Step 1.
6.  **Switch Case Generation:**
    - `CALL` cases now generate: `M[dest] = await VM(target, [arg1, arg2]);`
    - `RETURN` cases now generate: `return M[val];` (instead of setting S).

## 5. Limitations & Edge Cases

1.  **Closure Mutation:**
    - If Function A modifies a variable declared in its parent (Main), this new architecture creates a copy of that variable in Function A's local `M`.
    - _Impact:_ The parent's variable won't be updated.
    - _Fix:_ The `postProcessIR` function **already handles this**! You currently convert captured variables into arguments (`func(captured_var)`). This passes the _value_. For now, this is acceptable. If mutation is strictly required, we would need to pass a reference object, but fixing the crash is priority #1.

2.  **Performance:**
    - Copying `GlobalM` (e.g., 1000 items) on every function call adds overhead.
    - _Mitigation:_ This is an obfuscator. Performance degradation is expected. It is a worthy trade-off for stability and concurrency support.

## 6. Summary

By switching to a **Recursive Dispatcher**, we offload the hard work of memory management and context switching to the JavaScript engine itself.

- **Old Way:** We simulate the CPU, the RAM, _and_ the OS Scheduler. (Too hard, buggy).
- **New Way:** We simulate the CPU and RAM, but let the JS Engine handle the Scheduling (Call Stack).
