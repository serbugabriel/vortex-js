# Plan: Implementing State Machine Merging (Hyper-Flattening)

## 1. Goal & Concept

The objective is to create a program transformer (an obfuscator) that converts an entire JavaScript codebase into a single, massive, monolithic state machine. This process eliminates traditional function boundaries, scopes, and control flow structures (like `if`, `for`, `while`), making static and dynamic analysis exceptionally difficult.

All program logic will be contained within one dispatcher loop, controlled by a state variable. All data, including local variables, function arguments, and return values, will be stored and manipulated within a single, unified "memory" structure (e.g., a large array or object).

## 2. Ethical Disclaimer

This plan is provided for educational and research purposes only. Understanding advanced obfuscation techniques is crucial for developing better decompilers, reverse engineering tools, and security analysis software. The misuse of these techniques to create malicious software is unethical and illegal. This guide is intended to aid in defensive security research, not to facilitate malicious activities.

## 3. Core Architectural Components

Before starting, it's essential to define the building blocks of our target architecture:

- **Unified Memory Heap (`M`):** A large array or object that will store _everything_. This includes former local variables, function arguments, temporary values for calculations, and even the "return address" for function calls.
  - _Example:_ `let M = new Array(10000).fill(0);`
- **State Dispatcher Variable (`S`):** A single integer variable that dictates which block of code to execute next. This is the program counter of our virtual machine.
  - _Example:_ `let S = 0;`
- **Main Dispatcher Loop:** The core of the flattened program. A `while(true)` loop containing a `switch(S)` statement that executes the code corresponding to the current state.
- **State Blocks:** The individual `case` statements within the `switch`. Each block represents a single, atomic operation from the original code (e.g., an assignment, an arithmetic operation, a conditional check).

## 4. Implementation Phases

The transformation process is best broken down into distinct phases, similar to a compiler pipeline. This requires parsing the code into an Abstract Syntax Tree (AST) first.

**Prerequisite Tooling:**

- **AST Parser:** [Acorn](https://github.com/acornjs/acorn) or a full toolkit like [Babel](https://babeljs.io/) to parse JavaScript into an AST.
- **AST Traverser:** A library to visit nodes in the tree (Babel has `@babel/traverse`).
- **AST Generator:** A library to build new AST nodes (Babel has `@babel/generator`).

---

### **Phase 1: AST Parsing & Normalization**

The goal of this phase is to prepare the code for flattening by simplifying its structure.

1.  **Parse Source Code:** Convert the input JavaScript file(s) into an AST.
2.  **Function Hoisting:** Identify all function declarations and move them to the top level to resolve scope issues early.
3.  **Expression Simplification:** Break down complex expressions into a sequence of simple, three-address-code-like statements.
    - **Before:** `let result = (a + b) * myFunc(c);`
    - **After (conceptual):**
      `javascript
    let temp1 = a + b;
    let temp2 = myFunc(c);
    let result = temp1 * temp2;
    `
      This ensures each "State Block" in our final machine has a minimal, atomic operation.

### **Phase 2: Global Analysis & Mapping**

This phase collects all necessary information from the entire program before transformation.

1.  **Identify All Variables & Functions:** Traverse the entire AST to build a complete map of every variable, function parameter, and function name.
2.  **Create Unified Memory Map:** Assign a unique index (a "memory address") in the Unified Memory Heap (`M`) to every single variable identified.
    - `variable_map = { 'a': 100, 'b': 101, 'temp1': 102, 'result': 103, ... }`
3.  **Create State Block Map:** Assign a unique integer ID to every single simplified statement (from Phase 1). This ID will be its `case` number in the final `switch`.
    - `state_map = { 'entry_point': 0, 'statement_1': 1, 'statement_2': 2, ... }`

### **Phase 3: AST Transformation (The Core Logic)**

This is where the original AST is destroyed and the new, flattened AST is built.

1.  **Initialize the Main Structure:**
    - Create the `M` array.
    - Create the `S` variable, initialized to the state ID of the program's entry point.
    - Create the `while(true)` loop and the `switch(S)` statement.

2.  **Transform Each Statement into a State Block:**
    - Iterate through every simplified statement from the original code.
    - For each statement, create a corresponding `case` block.
    - Inside the `case` block:
      - Replace all variable references with lookups in the Unified Memory Heap. `a + b` becomes `M[100] + M[101]`.
      - The result is stored back into `M`. `result = ...` becomes `M[103] = ...`.
      - **Crucially, set the next state.** At the end of the block, update the dispatcher variable `S` to the ID of the next statement in the original program's execution flow.
      - `S = get_next_state_id(); break;`

3.  **Handling Control Flow:**
    - **`if/else` Statements:**
      - An `if` statement becomes a state block that evaluates the condition.
      - Based on the result, it sets `S` to one of two different values: the state ID for the `true` branch or the state ID for the `false` branch.
      - `case 10: S = (M[var_index] > 10) ? 11 /* true_branch */ : 20 /* false_branch */; break;`

    - **Loops (`for`, `while`):**
      - A `while` loop is transformed into a conditional jump. The block that checks the loop's condition will either set `S` to the first state of the loop's body or to the state that comes after the loop.
      - The last state in the loop's body will unconditionally set `S` back to the state that performs the condition check.

    - **Function Calls:** This is the most complex part of "merging."
      - A function call is **not** a native call anymore. It's a simulated call within the state machine.
      - To "call" a function, you:
        1.  Write the arguments to their designated spots in `M`.
        2.  **Push the "return state"** onto a simulated call stack (which is also just a part of `M`). The return state is the ID of the state that should execute _after_ the function is done.
        3.  Set `S` to the starting state ID of the function being called.
      - A `return` statement is transformed into:
        1.  Writing the return value to a designated spot in `M`.
        2.  **Popping the "return state"** from the simulated call stack.
        3.  Setting `S` to this popped state ID.

### **Phase 4: Code Generation**

1.  **Generate Final Code:** Use the AST generator to convert the newly constructed, flattened AST back into JavaScript code.
2.  **Add Final Touches (Optional but recommended):**
    - Shuffle the `case` blocks randomly. The numeric order of the `case` statements does not need to match the execution order, which adds another layer of confusion for human analysts.
    - Obfuscate integer constants (state IDs, memory indices) and string literals.

---

## 5. Example Snippet Transformation

#### Before:

```javascript
function factorial(n) {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
let result = factorial(5);
```

#### After (Conceptual Hyper-Flattened Form):

```javascript
let M = new Array(10000).fill(0); // Unified Memory
let S = 0; // State Dispatcher

// M[0] = n (arg)
// M[1] = return value
// M[2] = temp for n-1
// M[3] = temp for recursive result
// M[10-20] = Simulated Call Stack
// M[20] = Stack Pointer

while (true) {
  switch (S) {
    // --- Entry Point ---
    case 0:
      M[50] = 5; // result = ... the 5
      M[20] = 10; // Init stack pointer
      S = 1; // "call" factorial(5)
      break;

    // --- "call factorial" stub ---
    case 1:
      M[M[20]++] = 99; // Push return address (end of program state)
      M[0] = M[50]; // Move arg into place for factorial
      S = 100; // Jump to start of factorial logic
      break;

    // --- start of factorial(n) logic ---
    case 100: // if (n <= 1)
      S = M[0] <= 1 ? 101 /* true */ : 102 /* false */;
      break;

    case 101: // return 1;
      M[1] = 1;
      S = 200; // Jump to return sequence
      break;

    case 102: // n-1
      M[2] = M[0] - 1;
      S = 103;
      break;

    case 103: // recursive call: factorial(n-1)
      M[M[20]++] = 104; // Push return address (where multiplication happens)
      M[0] = M[2]; // Move arg (n-1) into place
      S = 100; // JUMP back to start of factorial logic
      break;

    case 104: // return from recursion, M[1] has the result
      M[3] = M[1]; // Store recursive result in temp
      M[1] = M[0] * M[3]; // n * result
      S = 200; // Jump to return sequence
      break;

    // --- "return" sequence ---
    case 200:
      S = M[--M[20]]; // Pop return address and jump
      break;

    // --- Program End ---
    case 99:
      M[51] = M[1]; // Store final result
      return; // or break loop: while(S !== 99)
  }
}
```
