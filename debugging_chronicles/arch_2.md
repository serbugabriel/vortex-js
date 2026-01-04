# VortexJS: Migration to Stackless Architecture (SVM)

> **Status:** Draft
> **Target:** Fix `RangeError: Maximum call stack size exceeded`
> **Architecture:** Iterative Loop with Shadow Stack (Trampoline)

This document outlines the refactoring plan to transition the VortexJS execution engine from a host-recursive model (where guest calls = host calls) to a stackless model (where guest calls = array pushes). This change allows the obfuscated code to support virtually infinite recursion depth and prevents stack overflow errors.

---

## 1. The Core Problem: Host Stack Coupling

In the current "RVM" architecture:

- **Guest Logic:** Function `A` calls Function `B`.
- **Host Reality:** The VM function `V()` recursively calls itself `await V()`.
- **Consequence:** The JavaScript engine's call stack grows with every guest function call. A deep recursion (e.g., >10,000 frames) or heavily nested logic crashes the runtime.

## 2. The Solution: Stackless VM (Trampoline)

We will decouple the guest stack from the host stack.

- **Single Host Frame:** The VM will run inside a single `while(true)` loop.
- **Shadow Stack:** A JavaScript Array (`CS`) will act as the call stack, storing the state (`M`, `S`, `Args`) of suspended frames.
- **Control Flow:** "Calling" a function simply means pushing the current state to `CS` and jumping to the new function's entry state. "Returning" means popping a state from `CS`.

---

## 3. Implementation Plan

### Phase 1: IR Generation Updates (`ir-generator.js`)

The intermediate representation must support explicit stack operations rather than implicit recursive calls.

- **Action:** No major changes to `ir-generator.js` logic are strictly required _if_ we handle the translation in `ASTGenerator`. However, we must ensure `FUNC_ENTRY` states explicitly define parameter unpacking logic that reads from a centralized `Args` register rather than function arguments.

### Phase 2: AST Generator Overhaul (`ast-generator.js`)

This is where the bulk of the logic changes. The `buildFinalAST` method needs a complete rewrite.

#### 2.1. VM Signature & Loop Structure

- **Old:** `const V = async (X, I, IsErr) => { ... }` (Recursive)
- **New:** `const V = async (EntryState, EntryArgs) => { ... }` (Iterative)
- **Registers:**
  - `M`: Memory (Current Frame)
  - `S`: State Pointer (Current instruction)
  - `A`: Arguments Register (Current function inputs)
  - `CS`: Call Stack (Array of frames: `{ M, S }`)

#### 2.2. Opcode Translation Logic

We need to change how specific opcodes are compiled into JavaScript:

| Opcode           | Old Behavior (Recursive) | New Behavior (Stackless)                                                                                                           |
| :--------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **`CALL`**       | `await V(target, args)`  | 1. `CS.push({ M, S: next })`<br>2. `A = args`<br>3. `M = new Memory()`<br>4. `S = target`<br>5. `break` (Loop continues)           |
| **`RETURN`**     | `return val`             | 1. `if (CS.empty) return val`<br>2. `frame = CS.pop()`<br>3. `M = frame.M`<br>4. `S = frame.S`<br>5. `M[_RET] = val`<br>6. `break` |
| **`FUNC_ENTRY`** | Unpack from `Ctx`        | Unpack from `A` (Arguments Register)                                                                                               |

#### 2.3. Exception Handling (Manual Unwinding)

Since we are in a single loop, `throw` will exit the interpreter entirely if not caught. We must implement a "soft" stack unwind.

- **Logic:** Wrap the main switch in a `try/catch`.
- **Handler:**
  1.  Check current `M[_EHP]` (Exception Handler Pointer).
  2.  If handler exists: Update `S` to handler state, write error to `_EXV`.
  3.  If no handler: `CS.pop()` (restore previous frame).
  4.  Repeat until handler found or `CS` is empty (then re-throw to host).

### Phase 3: Wrapper Virtualization

External calls to the obfuscated code (e.g., from HTML `onclick` or other modules) must interface with the new VM structure.

- **Generator Wrappers:** Need to be adapted to maintain their own `CS` instance if they are to be stackless, or remain as simple wrappers calling into the VM loop.
- **Async Wrappers:** Simply call `await VM(entry, args)` and return the result.

---

## 4. Execution Flow Diagram

```mermaid
graph TD
    Start[External Call] --> Init[Init VM Registers (M, S, CS=[])]
    Init --> Loop{Dispatcher Loop}

    Loop -->|Switch S| State[Execute State Op]

    State -->|CALL| PushStack[Push {M, S} to CS]
    PushStack --> NewFrame[Init New M, A=Args]
    NewFrame --> UpdateS[S = Target Func]
    UpdateS --> Loop

    State -->|RETURN| CheckCS{CS Empty?}
    CheckCS -->|Yes| Exit[Return Value to Host]
    CheckCS -->|No| PopStack[Pop {M, S} from CS]
    PopStack --> Restore[Restore M, S]
    Restore --> Loop

    State -->|THROW| Catch[Catch Block]
    Catch --> CheckHandler{Handler in M?}
    CheckHandler -->|Yes| JumpHandler[S = HandlerAddr]
    JumpHandler --> Loop
    CheckHandler -->|No| StackUnwind{CS Empty?}
    StackUnwind -->|No| PopFrame[Pop Frame]
    PopFrame --> CheckHandler
    StackUnwind -->|Yes| Crash[Throw to Host]
```

---

## 5\. Verification Steps

1.  **Recursion Test:**
    - Input: A recursive Fibonacci function `fib(n)`.
    - Test: Run `fib(10000)`.
    - Pass Condition: No `RangeError`. Correct result.
2.  **Cross-Frame Error Handling:**
    - Input: Func `A` calls `B`. `B` throws. `A` catches.
    - Test: Verify `A`'s catch block receives the error from `B` despite them sharing the same host stack frame.
3.  **Argument Passing:**
    - Input: `sum(a, b, ...rest)`.
    - Test: Verify `A` register correctly populates parameters, including Rest parameters.
