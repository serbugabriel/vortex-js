# VortexJS: Nested Functions & Closure Capture

> **Status:** Stable
> **Focus:** Nested Function Declarations, Closure Scope Analysis, and Parameter Shadowing
> **Date:** Dec 15, 2025

This document details the resolution of issues discovered during the "Worker Pool" extreme stress test, which involved deeply nested async functions, closure capturing, and concurrent execution flow.

---

<br>
<details>
  <summary align="center"><strong>Code Used Here - Click to expand</strong></summary>
  
```javascript
// ---------- utils ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- async generator (job producer) ----------
async function* jobGenerator(maxJobs) {
for (let i = 1; i <= maxJobs; i++) {
await sleep(50); // simulate arrival delay
yield { id: i, payload: Math.random() * 100 };
}
}

// ---------- worker ----------
async function processJob(job, workerId, cancelFlag) {
if (cancelFlag.cancelled) return;

    await sleep(100 + Math.random() * 300);

    if (Math.random() < 0.2) {
        throw new Error(`Worker ${workerId} failed job ${job.id}`);
    }

    return `Worker ${workerId} processed job ${job.id}`;

}

// ---------- worker pool ----------
async function workerPool({
workers = 3,
jobs,
cancelFlag
}) {
const results = [];
const active = new Set();

    async function runWorker(workerId) {
        for await (const job of jobs) {
            if (cancelFlag.cancelled) break;

            const task = processJob(job, workerId, cancelFlag)
            .then(res => results.push(res))
            .catch(err => {
                console.error(err.message);
                cancelFlag.cancelled = true;
            })
            .finally(() => active.delete(task));

            active.add(task);

            // backpressure: wait if pool is full
            if (active.size >= workers) {
                await Promise.race(active);
            }
        }
    }

    await Promise.all(
        Array.from({ length: workers }, (_, i) => runWorker(i + 1))
    );

    await Promise.all(active);
    return results;

}

// ---------- main ----------
async function main() {
const cancelFlag = { cancelled: false };
const jobs = jobGenerator(20);

    console.log('⚙️ Starting worker pool\n');

    const results = await workerPool({
        workers: 4,
        jobs,
        cancelFlag
    });

    console.log('\n✅ Results:');
    results.forEach(r => console.log(r));

    console.log('\n🏁 Finished');

}

main();

```

</details>

## 1. The Challenge: Virtualizing Nested Scopes
The previous implementation assumed a relatively flat function structure. The introduction of `async function runWorker(...)` *inside* `workerPool` exposed several gaps in how the RVM handles nested function declarations and variable scoping.

## 2. The Debugging Saga

### Fix 1: The Mock Path Crash
**Severity:** High (Compiler Crash)
**Error:** `TypeError: path.isClassExpression is not a function`
**Analysis:**
When handling `return;` statements (no argument), the compiler created a mock object `{ node: t.valueToNode(undefined) }`. This mock object was not a true Babel `NodePath`, so calls to `path.isX()` failed.
**Solution:**
Refactored `ir-expression-handler.js` to use Babel's static type checkers (`t.isClassExpression(path.node)`) instead of path methods. This makes the handler robust against mock nodes.

### Fix 2: Nested Function Declarations
**Severity:** Critical (Runtime Error)
**Error:** `TypeError: runWorker is not a function`
**Analysis:**
The `StatementHandler` was ignoring `FunctionDeclaration` nodes, assuming they were handled by the initial hoisting pass. However, in the RVM, a nested function is a *value* that must be assigned to a local variable at runtime.
**Solution:**
Implemented `handleFunctionDeclaration` in `ir-statement-handler.js`.
* **Action:** It now generates an `ASSIGN_LITERAL_DIRECT` state.
* **Logic:** It creates a wrapper function (closure) that invokes the VM with the target state ID and assigns this wrapper to the variable name (`runWorker`) in the current scope.

### Fix 3: The Disconnected State Machine (Infinite Loop)
**Severity:** Critical (Runtime Freeze)
**Symptom:** Infinite loop upon starting the worker pool.
**Analysis:**
The `IRGenerator`'s main loop skips function bodies to avoid double-processing. Consequently, nested functions were never traversed, meaning their entry states existed but had no links to their body logic. The VM entered the function and hit a dead end (no `S` update), looping forever.
**Solution:**
* **Refactor:** Extracted function body processing into `IRGenerator.processFunction`.
* **Linkage:** Updated `StatementHandler` to explicitly call `this.ir.processFunction(...)` when encountering a nested declaration, ensuring the inner CFG is generated and linked.

### Fix 4: Closure Capture Shadowing
**Severity:** High (Logic Error)
**Symptom:** `Worker undefined failed job...`
**Analysis:**
The closure capture analysis was too aggressive. It scanned the nested function for identifiers and captured *everything* that existed in the parent scope.
It failed to realize that `workerId` was a **parameter** of the nested function itself. It overwrote the valid argument passed to `runWorker` with the (undefined) value of `workerId` from the parent scope.
**Solution:**
Updated `handleFunctionDeclaration` to extract the function's own parameter names and exclude them from the capture list.

---

## 3. Summary of Verified Behaviors

| Feature | Scenario | Status |
| :--- | :--- | :--- |
| **Nested Functions** | `async function inner()` inside `outer()` | **Correctly Virtualized** |
| **Closures** | Inner function accessing `cancelFlag` from outer | **Correctly Captured** |
| **Shadowing** | Inner function having param `workerId` | **Correctly Isolated** |
| **Concurrency** | `Promise.all` + `Promise.race` + `for await` | **Stable** |
```
