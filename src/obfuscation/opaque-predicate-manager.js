/**
 * @file opaque-predicate-manager.js
 * @description Manages the selection and generation of Opaque Predicates.
 * An opaque predicate is a condition that is always true (or always false) at runtime,
 * but this fact is difficult for a static analyzer to determine.
 * These are used to inject "impossible" branches into the control flow, confusing decompilers.
 */

const MathCongruence = require("./predicates/math-congruence");
const ArrayAlias = require("./predicates/array-alias");
const VMStateHistory = require("./predicates/vm-state-history");
const AntiDebug = require("./predicates/anti-debug");

/**
 * Orchestrates the insertion of control flow hardening structures.
 */
class OpaquePredicateManager {
  /**
   * @param {string} level - Complexity level ('low', 'medium', 'high').
   * @param {number} probability - Chance (0-1) to inject a predicate at any valid injection point.
   */
  constructor(level = "medium", probability = 0.2) {
    this.level = level;
    this.probability = probability;
    this.predicates = [];
    this.loadPredicates();
  }

  /**
   * Selects available predicates based on the requested security level.
   */
  loadPredicates() {
    const all = [MathCongruence, ArrayAlias, VMStateHistory, AntiDebug];

    const levels = { low: 1, medium: 2, high: 3 };
    const currentWeight = levels[this.level] || 2;

    this.predicates = all.filter((p) => {
      const pWeight = levels[p.level] || 2;
      return pWeight <= currentWeight;
    });
  }

  shouldInject() {
    return Math.random() < this.probability;
  }

  /**
   * Generates the IR states for a randomly selected opaque predicate.
   * @param {Object} irGenerator - The IR generator instance.
   * @returns {Object|null} The predicate graph { start, end, bogusTarget }.
   */
  getPredicateIR(irGenerator) {
    if (this.predicates.length === 0) return null;

    let pool = this.predicates;

    // CUSTOM LOGIC: High Security Enforcement
    // If level is 'high', we exclusively use the strongest predicates (AntiDebug & VMStateHistory).
    // This ensures they are "always there" and split evenly ("balanced").
    if (this.level === "high") {
      const highTier = this.predicates.filter(
        (p) => p.name === "VMStateHistory" || p.name === "AntiDebug",
      );

      if (highTier.length > 0) {
        pool = highTier;
      }
    }

    // Pick a random predicate from the selected pool
    const randomIdx = Math.floor(Math.random() * pool.length);
    const predicate = pool[randomIdx];
    return predicate.generate(irGenerator);
  }

  /**
   * Generates a block of "junk" code (dead code) that serves as the
   * destination for the false branch of the opaque predicate.
   * This code is never executed but must look valid to static analysis tools.
   */
  getBogusCodeIR(irGenerator) {
    // The "Punishment" code if a predicate fails (e.g. debugger detected)
    const t1 = irGenerator.createTempVar();
    const t2 = irGenerator.createTempVar();

    const start = irGenerator.addState({
      type: "ASSIGN_LITERAL",
      to: t1.name,
      value: Math.floor(Math.random() * 1000),
    });

    // Meaningless bitwise operation
    const op2 = irGenerator.addState({
      type: "BINARY",
      op: ">>",
      to: t2.name,
      left: t1.name,
      right: t1.name,
    });

    irGenerator.linkStates(start, op2);

    // Hard crash (HALT) to stop execution if somehow reached
    const halt = irGenerator.addState({ type: "HALT" });
    irGenerator.linkStates(op2, halt);

    return { start, end: halt };
  }
}

module.exports = OpaquePredicateManager;
