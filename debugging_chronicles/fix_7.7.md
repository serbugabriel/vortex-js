### **VortexJS: Scope Integrity & Virtualization Logic**

> **Status:** Stable
> **Focus:** Scope Shielding, Mathematical Precision, and AST Flattening
> **Date:** Dec 24, 2025

This document details the critical regression fix regarding `TypedArray` value corruption. The issue stemmed from aggressive virtualization of local scopes and improper handling of complex expressions during the IR generation phase.

---

<br>
<details>
  <summary align="center"><strong>Code Used Here - Click to expand</strong></summary>
  
```javascript
(async () => {
  const N = 1000;

// Helper: random seed PRNG
const P = (seed) => {
let s = seed >>> 0;
return {
next() {
s ^= s << 13;
s ^= s >>> 17;
s ^= s << 5;
return (s >>> 0) / 0xffffffff;
},
};
};

const prng = P(0xdeadbeef);

// TypedArray madness
const dims = [64, 32, 16];
const buffer = new Uint8Array(dims.reduce((a, b) => a _ b));
for (let i = 0; i < buffer.length; i++) buffer[i] = (i _ 17 + 13) & 0xff;

// Deep Proxy trap chain
const trap = {
get(target, prop, recv) {
if (typeof prop === "symbol") return 42;
if (prop === "double") return (v) => v _ 2;
return Reflect.get(target, prop, recv);
},
set(target, prop, val) {
return Reflect.set(target, prop, typeof val === "number" ? val _ 2 : val, target);
},
apply(target, thisArg, args) {
let sum = 0;
for (let a of args) sum += a;
return sum;
},
};

const fn = new Proxy(function (...a) { return a.reduce((x,y)=>x+y,0); }, trap);
const obj = new Proxy({a:10,b:20}, trap);

// Recursive async microtasks + dynamic functions
const deepAsync = async (n) => {
if (n <= 0) return 1;
await Promise.resolve();
return (await deepAsync(n-1)) + n;
};

// Symbol & WeakRef / WeakMap
const sym = Symbol("stress");
const wm = new WeakMap();
const wr = new WeakRef({x: N});
wm.set({y: N}, {z: N});

// Multi-dimensional wave transforms
const waves = Array.from({length:16}, (\_, i) => ({
offset: dims.map(d=>Math.floor(prng.next()*d)),
freq: 0.5 + prng.next()*5,
amp: 1 + prng.next()*7,
phase: prng.next()*Math.PI\*2,
}));

for (let i = 0; i < buffer.length; i++) {
let coord = [];
let idx = i;
for (let d of dims.reverse()) {
coord.unshift(idx % d);
idx = Math.floor(idx / d);
}
for (let w of waves) {
let dist = coord.reduce((s, c, j)=>s + (c - w.offset[j])\**2, 0);
buffer[i] = (buffer[i] ^ ((Math.sin(dist*w.freq + w.phase)+1)/2\* w.amp)|0) & 0xff;
}
}

// Mega loop + dynamic code
let dynamicSum = 0;
for (let i = 0; i < 200; i++) {
const code = `return ${i} + ${fn(i,i,i)} + ${obj.a} + ${obj.b} + ${sym.toString().length};`;
dynamicSum += new Function(code)();
await queueMicrotask(()=>{}); // stress microtasks
}

// Deep async recursion
const recResult = await deepAsync(20);

console.log({
proxyDouble: obj.double(21),
typedArraySample: buffer.slice(0,10),
dynamicSum,
symbolValue: sym.toString().length,
recResult,
weakRef: wr.deref(),
});
})();

````

</details>


## 1. Scope Shielding (The "TypedArray" Fix)

### The Corruption Bug

**Error:** `Output Mismatch in TypedArray`
**Analysis:**
The obfuscated code produced incorrect integer values in the `Uint8Array` buffer (e.g., `5, 6, 4...` instead of `8, 24, 43...`).
The root cause was the wave transform logic: `coord.reduce((s, c, j) => ... )`. The transformer was too aggressive; it identified the callback arguments `s` (accumulator), `c` (current), and `j` (index) as identifiers and remapped them to global memory registers `M[x]`.
However, because `reduce` invokes this function natively, the arguments are passed to the **native stack**, not the virtual memory `M`. The function body read from `M` (stale/undefined) instead of using the actual arguments passed by the JS engine.

**Solution:**

* **Scope Shielding:** Added a check `if (path.scope.hasBinding(path.node.name)) return;` in the `postProcessIR` phase. This ensures that if a variable is defined locally (like a callback parameter or local `let`), the transformer leaves it alone, preserving the native JS scope.

---

## 2. Property Access Robustness

### The "Offset" Lookup Error

**Error:** `Cannot read properties of undefined` or invalid memory lookups.
**Analysis:**
In expressions like `w.offset[j]`, the transformer incorrectly identified `offset` as a variable reference rather than a property key. It attempted to look up `offset` in the global memory map `M`, leading to corruption or runtime crashes.

**Solution:**

* **Structural Exclusion:** Tightened the exclusion checks in the `Identifier` visitor. The transformer now explicitly ignores identifiers that are keys in `ObjectProperty`, `MemberExpression`, or `ClassMethod` nodes, unless they are marked as `computed`.

---

## 3. Recursive AST Compilation

### The Static Property Bug

**Behavior:** Static class properties with complex initializers were failing to initialize correctly or losing execution order.
**Analysis:**
The `ClassHandler` previously assigned static properties as "dumb" literals. If a class had a static property defined by a complex expression (e.g., a function call or computation), it wasn't being flattened into the state machine, causing logic to drop out.

**Solution:**

* **Recursive Compilation:** Implemented `_compileASTNode` in the `ClassHandler`. This helper recursively feeds class property values back into the IR generator. This ensures that even complex class definitions are fully virtualized into granular `M[x] = ...` opcodes without losing execution order.

---

## 4. Mathematical Precision via `GM`

### The Precision Loss

**Analysis:**
During high-frequency loop iterations (like the wave transforms), accessing global objects like `Math`, `PI`, and `sin` via standard scope lookups was proving unstable or incorrect in the virtualized context.

**Solution:**

* **Global Memory (GM) Preloading:** Ensured that critical globals (`Math`, `PI`, `sin`) are pre-loaded into the `GM` array. They are now accessed via stable numeric indices, preventing the state machine from losing reference context during intensive calculations.

---

## 5. Verification

**Input Code:**

```javascript
// Wave transform logic inside TypedArray loop
let dist = coord.reduce((s, c, j)=>s + (c - w.offset[j])**2, 0);
buffer[i] = (buffer[i] ^ ((Math.sin(dist*w.freq + w.phase)+1)/2* w.amp)|0) & 0xff;

````

**Verified Output:**

```javascript
typedArraySample: Uint8Array(10)[(8, 24, 43, 65, 86, 96, 118, 135, 148, 166)];
```

_The values now match the original synchronous execution exactly, confirming that lexical scoping and mathematical operations are functioning correctly within the Async VM._
