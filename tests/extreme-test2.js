"use strict";

/*
 *  JS VM Stress Test — Single File
 *  WARNING: CPU + memory heavy
 */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Event Loop Chaos ---------------- */

async function eventLoopStorm(rounds) {
  let count = 0;
  for (let i = 0; i < rounds; i++) {
    Promise.resolve().then(() => count++);
    setTimeout(() => count++, 0);
    queueMicrotask(() => count++);
    await delay(0);
  }
  return count;
}

/* ---------------- Generator Hell ---------------- */

function* fibGen(limit) {
  let a = 0,
    b = 1;
  while (limit-- > 0) {
    yield a;
    [a, b] = [b, a + b];
  }
}

async function* asyncMixer(n) {
  for (let i = 0; i < n; i++) {
    await delay(1);
    yield i * Math.random();
  }
}

/* ---------------- Proxy Abuse ---------------- */

function proxify(obj) {
  return new Proxy(obj, {
    get(target, prop, recv) {
      if (prop === "explode") throw new Error("💥");
      return Reflect.get(target, prop, recv);
    },
    set(target, prop, val) {
      target[prop] = typeof val === "number" ? val * 2 : val;
      return true;
    },
    has(target, prop) {
      return Math.random() > 0.3;
    },
  });
}

/* ---------------- Deep Recursion (Trampoline) ---------------- */

function trampoline(fn) {
  return function (...args) {
    let res = fn(...args);
    while (typeof res === "function") res = res();
    return res;
  };
}

const factorial = trampoline(function f(n, acc = 1) {
  if (n <= 1) return acc;
  return () => f(n - 1, acc * n);
});

/* ---------------- Memory Pressure ---------------- */

function memoryStorm(iter) {
  const weak = new WeakMap();
  let refs = [];

  for (let i = 0; i < iter; i++) {
    let buf = new ArrayBuffer(1024 * ((i % 32) + 1));
    let view = new Uint8Array(buf);
    view.fill(i % 255);
    let obj = { buf, view };
    weak.set(obj, i);
    refs.push(new WeakRef(obj));
  }

  return refs.length;
}

/* ---------------- Dynamic Code ---------------- */

function dynamicCompute(size) {
  const body = `
  let s = 0;
  for (let i = 0; i < ${size}; i++) {
    s += Math.sin(i) * Math.cos(i >> 1);
  }
  return s;
  `;
  return new Function(body)();
}

/* ---------------- Main Orchestration ---------------- */

(async function main() {
  console.log("VM stress test started");

  const proxy = proxify({ a: 1, b: 2 });
  proxy.a = 10;
  proxy.b = 5;

  let fibSum = 0;
  for (const n of fibGen(30)) fibSum += n;

  let asyncSum = 0;
  for await (const v of asyncMixer(20)) asyncSum += v;

  const loopCount = await eventLoopStorm(50);
  const fact = factorial(12);
  const mem = memoryStorm(2000);
  const dyn = dynamicCompute(50000);

  console.log({
    proxy,
    fibSum,
    asyncSum,
    loopCount,
    fact,
    mem,
    dyn,
  });

  console.log("VM stress test finished");
})();
