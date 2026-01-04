# VortexJS: The Inheritance Implementation Chronicle

> **Feature:** ES6 Class Inheritance (`extends`)
> **Status:** Stable (Standard classes and Built-ins like `Array` are functional)
> **Date:** Dec 14, 2025

This document records the engineering challenges and incremental fixes applied while implementing class inheritance in the Recursive Virtual Machine (RVM).

---

## 1. The Challenge: Flattening Hierarchy

Standard JavaScript classes are syntax sugar over prototype chains. To virtualize them, VortexJS strips the `class` keyword and rebuilds the constructor and prototype logic using raw instruction states (`ASSIGN`, `EXTERNAL_CALL`).

**Requirement:**

- Support `class Child extends Parent`.
- Support `super()` calls in constructors.
- Support `super.method()` calls.
- Support proper `this` binding in accessors.

## 2. Implementation Steps & Fixes

### Fix 8: Prototype Chain Wiring

**Initial Approach:**
Simply creating a function for the child class.
**Problem:** `Child` instances were not instances of `Parent`. `instanceof` checks failed.
**Solution:**
Injected IR states immediately after class creation to manually wire the prototypes:

1.  **Static Inheritance:** `Object.setPrototypeOf(Child, Parent)` (Allows `Child.staticMethod`).
2.  **Instance Inheritance:** `Child.prototype = Object.create(Parent.prototype)`.
3.  **Constructor Fix:** `Child.prototype.constructor = Child`.

### Fix 9: Accessor Descriptors

**Problem:**
Getters and Setters (`get info() {...}`) were being assigned as standard value properties (`Child.prototype.info = function...`).
**Result:** Accessing `inst.info` returned the function definition string instead of executing the getter logic.
**Solution:**
Updated `ir-class-handler.js` to inspect `method.kind`. If it is `get` or `set`, the compiler now generates a `Object.defineProperty` call instead of a simple assignment.

### Fix 10: The `super` Context (Reflect API)

**Problem:**
Calls to `super.getValue()` returned `undefined` when `getValue` tried to access `this._privateProp`.
**Analysis:**
`super.getValue` looks up the method on `Parent.prototype`. When invoked directly (`Parent.prototype.getValue()`), `this` refers to the prototype object, not the instance. The instance data (`_privateProp`) was missing from the prototype.
**Solution:**
Replaced direct super access with `Reflect` API to explicitly set the receiver (`this`):

- `super.prop` -> `Reflect.get(Parent.prototype, "prop", this)`
- `super.prop = val` -> `Reflect.set(Parent.prototype, "prop", val, this)`

### Fix 11: The Built-in Subclassing Problem (Array)

**Problem:**
Subclassing `Array` (`class MyArr extends Array`) resulted in objects that looked like arrays but behaved like generic objects (length 0, map/reduce failing).
**Analysis:**
VortexJS was simulating constructors via `Parent.call(this, ...)` (ES5 style). Built-in constructors like `Array` **ignore** the `this` passed to `call()` and internally create a new "exotic" object slot. Since we weren't using the returned object from `Array.call`, our instance remained a basic object.
**Solution (Attempted):**
Switched to the ES6 `Reflect.construct` pattern.

### Fix 12: Synthetic Constructor Injection (The "Empty Array" Fix)

**Problem:**
While Fix 11 worked for manual constructors, classes without explicit constructors (using the default synthetic one) were broken. The AST visitor responsible for rewriting `super()` calls could not find the synthetic nodes generated on the fly, leaving `_this` undefined.
**Solution:**
Refactored `ir-class-handler.js` to bypass the visitor pattern for synthetic constructors.

- **Direct Injection:** Instead of generating a `super()` call and trying to find/replace it later, we now directly generate the `Reflect.construct` AST nodes when creating the default constructor.
- **Logic:**
  ```javascript
  // VortexJS Generated Default Constructor
  constructor(...args) {
     let _this;
     _this = Reflect.construct(Super, args, new.target);
     return _this;
  }
  ```
- **Result:** `class ExtendedArray extends Array {}` now correctly initializes the internal array slots.

## 3. Summary of Known Issues

| ID         | Issue                                  | Symptom                                                                                                                 | Status                                                     |
| :--------- | :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| **ERR-01** | **Synthetic Constructor Detection**    | `ClassHandler` generates a default constructor for derived classes, but the subsequent pass fails to rewrite `super()`. | **Fixed** (Fix 12)                                         |
| **ERR-02** | **Lexical `super` in Arrow Functions** | Arrow functions inside class methods.                                                                                   | **Resolved** (Handled via AST rewriting + Native Wrappers) |
