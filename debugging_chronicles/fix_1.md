# Hyper-Flattener: Debugging and Fixes Chronicle

> Changed to VortexJS in later stages

This document details the iterative debugging process used to bring the `hyper-flattener.js` script from a non-functional state to a correct and robust program transformer. Each section outlines a specific error, its root cause analysis, and the implemented solution.

## Fix 1: Crashing on `t.numericLiteral(undefined)`

### Error Details

- **Symptom:** The script crashed during the final AST generation phase (Phase 3).
- **Error Message:** `TypeError: AST Generation Error: t.numericLiteral received a non-number value: "undefined" (type: undefined).`
- **Context:** `State 1 (FUNC_ENTRY): setting next state`
- **Log Trace:** `[GEN] Processing state ID=1, type=FUNC_ENTRY, next=undefined`

### Root Cause Analysis

The `buildFinalAST` function iterates through all generated states. For each state, it generates code to set the next state (`S = nextStateId`). The crash occurred because it was trying to generate `S = undefined`, which is invalid.

The `next` property of a `FUNC_ENTRY` state was `undefined` because the `linkStates` function, which was supposed to connect the function entry to its body, was failing to update the state object correctly. The original `getState` method used `Array.prototype.find()`, which was less reliable and efficient than direct index access for our sequentially generated state IDs.

### The Solution

1.  **Refactored `getState`:** The `getState` method was changed to use direct array indexing (`return this.states[id]`). Since state IDs are sequential integers, this is a more performant and reliable way to retrieve state objects. The states array was also changed from `push` to direct index assignment (`this.states[stateId] = ...`) to prevent a sparse array from causing issues.
2.  **Added Guard to `linkStates`:** A guard was added to `linkStates` to throw a clear, early error if the `fromState` could not be found, preventing the error from propagating to a more cryptic location.

---

## Fix 2: State Linking Error on `undefined` ID

### Error Details

- **Symptom:** The script crashed during the state machine IR generation phase (Phase 2).
- **Error Message:** `Error: State Linking Error: Could not find 'from' state with ID undefined.`
- **Call Stack:** The error originated in `processStatements` when calling `this.linkStates(lastStateId, result.start)`.

### Root Cause Analysis

The new guard in `linkStates` caught a logic error in `processStatements`. The loop in this function was designed to link the `end` of the previous statement to the `start` of the current one.

The bug occurred when the loop processed a statement that did not generate any states (e.g., an `EmptyStatement` or an unhandled node type). The `processStatement` function would return a falsy value, and the loop would `continue`. However, the `lastStateId` variable was not reset, carrying over the ID from the last _valid_ statement. This could lead to incorrect linking (skipping statements) or, as seen in the error, attempting to link from an uninitialized `lastStateId`.

### The Solution

The logic in `processStatements` was rewritten to be more robust:

1.  Instead of tracking just the last state ID, it now tracks the entire `result` object (`{ start, end }`) of the last valid statement processed.
2.  The loop now follows this logic: - Process the current statement. - If it's invalid, skip it. - If it's the first valid statement, store its result. - If there was a _previous_ valid statement, link the `end` of the previous one to the `start` of the current one. - Update the "last valid statement" tracker to the current one.
    This ensures that linking only ever occurs between two consecutively processed, valid statements.

---

## Fix 3: Inconsistent Data Structure Shape

### Error Details

- **Symptom:** The script crashed again during IR generation (Phase 2).
- **Error Message:** `Error: State Linking Error: Invalid state IDs provided. From: undefined, To: 7`
- **Call Stack:** The error again originated in `processStatements` at the line: `this.linkStates(lastResult.end, currentResult.start);`.

### Root Cause Analysis

The `fromStateId` was `undefined`, meaning `lastResult.end` was `undefined`. The investigation revealed an inconsistency in the data structures returned by the processing functions:

- `processStatement` was designed to return objects with the shape `{ start: number, end: number }`.
- However, for `ExpressionStatement` nodes, it delegated directly to `processExpression`.
- `processExpression` returned objects with a _different_ shape: `{ startState: number, endState: number, resultVar: ... }`.

When `processStatements` received this differently shaped object, it stored it in `lastResult`. In the next loop iteration, it attempted to access `lastResult.end`, which did not exist, resulting in `undefined`.

### The Solution

A strict data structure convention was enforced: **any function that processes a node and generates a sequence of states must return an object with `start` and `end` properties.**

1.  The `processExpression` function was refactored to rename `startState` to `start` and `endState` to `end` in all its return statements.
2.  The `processStatement` function was updated to correctly access `exprInfo.start` and `exprInfo.end` when calling `processExpression`.
    This standardization eliminated the bug by ensuring data compatibility between the different parts of the transformer.

---

## Fix 4: Mishandling of Global Identifiers

### Error Details

- **Symptom:** The script passed IR generation but crashed during the final AST generation (Phase 3).
- **Error Message:** `Error: AST Generation Error: Attempted to get memory address for unallocated variable "console".`
- **Context:** Occurred while generating code for an `ASSIGN` state.

### Root Cause Analysis

This error revealed a fundamental flaw in the transformer's understanding of JavaScript scope. The logic for handling identifiers in `processExpression` assumed that _every_ identifier was a user-declared variable that should be managed within the simulated memory array `M`.

It encountered `console.log`, processed the `Identifier` `console`, and generated a state to copy the value from `M[<address_of_console>]`. This failed because `console` is a global object provided by the runtime environment, not a variable declared in the source code, so it was never allocated an address in our `memoryMap`.

### The Solution

The transformer was taught to distinguish between internal variables and external global objects.

1.  **Modified `processExpression`:** The handler for `Identifier` was updated. It now checks if the identifier's name exists in the `memoryMap`.
    - If **yes**, it's an internal variable, and the original `ASSIGN` state is created.
    - If **no**, it's assumed to be a global. A new state type, `ASSIGN_GLOBAL`, is created, which stores the name of the global (e.g., `'console'`).
2.  **Updated `buildFinalAST`:** A new `case` was added to the `switch` statement in the final code generator to handle the `ASSIGN_GLOBAL` state type. This case generates code that accesses the global directly from the environment, for example: `M[temp_var_address] = console;`.

This final fix allowed the transformer to correctly interact with the surrounding JavaScript environment, leading to the first successful and complete transformation of the source code.
