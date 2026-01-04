# Plan: Opaque Predicate Injection Framework

## 1. Goal & Philosophy

The objective is to introduce a new, optional obfuscation layer that injects **opaque predicates** into the Intermediate Representation (IR). This will create deceptive control flow paths (bogus branches) that are computationally expensive for static analyzers to solve but trivial for the runtime to evaluate.

The framework will be:

- **Modular:** Each predicate will be a self-contained unit, allowing for easy addition of new techniques.
- **Controllable:** The entire feature can be enabled/disabled, and its intensity can be controlled via CLI flags (`--opaque-level`).
- **Integrated:** The system will hook into the existing `IRGenerator` pipeline, treating predicates as small, injectable IR graphs.

## 2. Architectural Design

We will introduce a new directory `src/obfuscation` to house the predicate logic, ensuring it remains decoupled from the core transformation pipeline.

### New File Structure

```
src/
├── obfuscation/
│   ├── opaque-predicate-manager.js   # The main controller class
│   └── predicates/
│       ├── I-predicate.js            # (Interface/Base Class - optional)
│       ├── math-congruence.js        # Predicate 1
│       ├── array-alias.js            # Predicate 2
│       └── vm-state-history.js         # Predicate 3 (Extreme)
├── ir-gen/
│   └── ir-generator.js               # (Minor modifications needed)
└── transformer.js                    # (Minor modifications needed)
index.js                              # (CLI flag handling)
```

### Core Components

#### `OpaquePredicateManager` (`opaque-predicate-manager.js`)

This class will be the central hub for managing and injecting predicates.

- **`constructor(level, probability)`:**
  - `level`: 'low', 'medium', or 'high'.
  - `probability`: A number between 0 and 1 determining the chance of injection at any given opportunity.
- **`loadPredicates()`:** Scans the `predicates/` directory and registers all available predicates, filtering them by their declared level.
- **`shouldInject()`:** A simple method that returns `true` or `false` based on the configured probability (`Math.random() < this.probability`).
- **`getPredicateIR(irGeneratorContext)`:**
  - Selects a random, suitable predicate from the loaded library based on the current `level`.
  - Calls the predicate's `generate(irGeneratorContext)` method.
  - Returns a small, self-contained IR graph: `{ start: number, end: number }`.

#### Predicate Modules (`predicates/*.js`)

Each file will export a class or object that defines a single opaque predicate.

- **`level`**: A property indicating the difficulty ('low', 'medium', 'high').
- **`name`**: A descriptive name for debugging.
- **`generate(ir)`**: A method that takes the `IRGenerator` instance as an argument. It uses the `ir.addState()` and `ir.createTempVar()` helpers to build the necessary IR states for its setup and conditional jump. It must return an object `{ start: number, end: number, bogusTarget: number }` where `bogusTarget` is the entry point to the dead code path.

## 3. Implementation Phases

### Phase 1: CLI and Transformer Integration

The first step is to plumb the configuration from the user command down to the `IRGenerator`.

1.  **`index.js` (CLI):**
    - Add new command flags using a library like `yargs` or manual parsing:
      - `--opaque-predicates`: A boolean flag to enable/disable the feature. Defaults to `false`.
      - `--opaque-level <level>`: A string ('low', 'medium', 'high'). Defaults to 'medium'.
      - `--opaque-prob <float>`: A float (0.0 to 1.0). Defaults to `0.2` (20% chance).
    - Pass these options to the `StateMachineTransformer` constructor.

2.  **`transformer.js` (`StateMachineTransformer`):**
    - In the constructor, accept the new options.
    - If `opaque-predicates` is enabled, instantiate the `OpaquePredicateManager` with the specified level and probability.
    - Add the `opaquePredicateManager` instance to the `context` object that is passed to the `IRGenerator`. If disabled, pass `null`.

### Phase 2: Building the Predicate Library

This involves creating the individual predicate modules.

1.  **`predicates/math-congruence.js` (Level: Medium)**
    - **Concept:** `(a * b) % n === ((a % n) * (b % n)) % n`
    - **`generate(ir)` method will:**
      1.  Create 5 temp vars: `a`, `b`, `n`, `res1`, `res2`.
      2.  Add `ASSIGN_LITERAL` states to populate `a`, `b`, `n` with random-ish numbers.
      3.  Add IR states for the left-hand side calculation, storing the result in `res1`.
      4.  Add IR states for the right-hand side calculation, storing the result in `res2`.
      5.  Add a `BINARY` state (`===`) comparing `res1` and `res2`, storing the result in a final `testVar`.
      6.  Create a `NOOP` state for the bogus branch (`bogusTarget`).
      7.  Create a `COND_JUMP` state: `testVar ? next_real_code : bogusTarget`. This state is the `end` of the returned graph.
      8.  Return `{ start, end, bogusTarget }`.

2.  **`predicates/array-alias.js` (Level: Medium)**
    - **Concept:** Mutating an array via an alias affects the original reference.
    - **`generate(ir)` method will:**
      1.  Create temp vars: `arr1`, `arr2`, `testVar`.
      2.  Add `CREATE_ARRAY` state -> `arr1`.
      3.  Add `ASSIGN` state -> `arr2 = arr1`.
      4.  Add `MEMBER_ASSIGN` state -> `arr2[0] = 99`.
      5.  Add `MEMBER_ACCESS` state -> `temp = arr1[0]`.
      6.  Add `BINARY` state (`===`) comparing `temp` and `99` -> `testVar`.
      7.  Create `bogusTarget` and `COND_JUMP` as above.
      8.  Return the IR graph.

3.  **`predicates/vm-state-history.js` (Level: High)**
    - **This is more complex and requires modifying the `IRGenerator` itself.** We will defer this to an "advanced" implementation step, but the plan is:
      - The `OpaquePredicateManager` will have a method like `registerPath(pathId)`.
      - The `StatementHandler` (e.g., in `handleIfStatement`) will call `manager.registerPath(1)` in the `true` branch and `manager.registerPath(2)` in the `false` branch.
      - The `generate` method for this predicate will then check this registered state.

### Phase 3: IR Injection Logic

This is where we hook the predicate framework into the main pipeline.

1.  **`ir-generator.js` (`IRGenerator`):**
    - Ensure the `opaquePredicateManager` is received from the `context`.
    - Create a new helper method: `injectOpaquePredicateIfEnabled(lastStateId)`.

2.  **`ir-statement-handler.js` (`StatementHandler`):**
    - Identify "injection points." Good candidates are at the end of `if`, `while`, and `for` blocks, or before `return` statements.
    - **Example in `handleIfStatement`:**

      ```javascript
      // ... existing logic to create endIfStateId ...

      // NEW: Injection Logic
      let injectionPoint = endIfStateId;
      if (this.ir.opaquePredicateManager?.shouldInject()) {
        const predicateGraph = this.ir.opaquePredicateManager.getPredicateIR(
          this.ir,
        );

        // Link the end of the original 'if' to the start of the predicate
        this.ir.linkStates(endIfStateId, predicateGraph.start);

        // The new convergence point is the end of the predicate graph
        injectionPoint = predicateGraph.end;

        // We now have a bogus path to handle. For now, we can just let it be a dead end.
        // Later, we can generate garbage code and link it to the bogusTarget.
      }

      // Return the *new* end state
      return { start: condInfo.start, end: injectionPoint };
      ```

    - This logic will be repeated at various injection points.

### Phase 4: Generating Bogus Code

An opaque predicate isn't very useful if its bogus branch is empty.

1.  **`OpaquePredicateManager`:**
    - Add a new method: `getBogusCodeIR(ir)`.
    - This method will generate a small, random IR graph of useless computations (e.g., `temp = 1+2`, `temp2 = temp * 3`). It should terminate in a `HALT` or an infinite loop (`GOTO` to self) to ensure it's a dead end.

2.  **`ir-statement-handler.js`:**
    - When injecting a predicate:
      ```javascript
      // ... after getting predicateGraph ...
      const bogusGraph = this.ir.opaquePredicateManager.getBogusCodeIR(this.ir);
      this.ir.linkStates(predicateGraph.bogusTarget, bogusGraph.start);
      ```

---

## 4. Summary of Changes & Action Items

| File                                      | Module        | Action Items                                                                                                                                                                       |
| :---------------------------------------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`                                | CLI           | 1. Add `--opaque-predicates`, `--opaque-level`, `--opaque-prob` flags. <br> 2. Pass options to `StateMachineTransformer`.                                                          |
| `transformer.js`                          | Core          | 1. Initialize `OpaquePredicateManager` based on options. <br> 2. Add manager instance to the `context` object for the IR Generator.                                                |
| `obfuscation/opaque-predicate-manager.js` | **New**       | 1. Implement `constructor`, `loadPredicates`, `shouldInject`, `getPredicateIR`. <br> 2. Implement `getBogusCodeIR`.                                                                |
| `obfuscation/predicates/*.js`             | **New**       | 1. Create modules for at least 2-3 different predicates. <br> 2. Each must export `level` and a `generate(ir)` method.                                                             |
| `ir-statement-handler.js`                 | IR Generation | 1. Identify 3-4 strategic injection points (e.g., after `if`, before `return`). <br> 2. At these points, call the manager to get and stitch in the predicate IR and bogus code IR. |

This plan provides a clear, modular path to a powerful new obfuscation feature without polluting the core logic of your well-structured transformer.
