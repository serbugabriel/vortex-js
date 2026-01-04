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
  const buffer = new Uint8Array(dims.reduce((a, b) => a * b));
  for (let i = 0; i < buffer.length; i++) buffer[i] = (i * 17 + 13) & 0xff;

  // Deep Proxy trap chain
  const trap = {
    get(target, prop, recv) {
      if (typeof prop === "symbol") return 42;
      if (prop === "double") return (v) => v * 2;
      return Reflect.get(target, prop, recv);
    },
    set(target, prop, val) {
      return Reflect.set(
        target,
        prop,
        typeof val === "number" ? val * 2 : val,
        target,
      );
    },
    apply(target, thisArg, args) {
      let sum = 0;
      for (let a of args) sum += a;
      return sum;
    },
  };

  const fn = new Proxy(function (...a) {
    return a.reduce((x, y) => x + y, 0);
  }, trap);
  const obj = new Proxy({ a: 10, b: 20 }, trap);

  // Recursive async microtasks + dynamic functions
  const deepAsync = async (n) => {
    if (n <= 0) return 1;
    await Promise.resolve();
    return (await deepAsync(n - 1)) + n;
  };

  // Symbol & WeakRef / WeakMap
  const sym = Symbol("stress");
  const wm = new WeakMap();
  const wr = new WeakRef({ x: N });
  wm.set({ y: N }, { z: N });

  // Multi-dimensional wave transforms
  const waves = Array.from({ length: 16 }, (_, i) => ({
    offset: dims.map((d) => Math.floor(prng.next() * d)),
    freq: 0.5 + prng.next() * 5,
    amp: 1 + prng.next() * 7,
    phase: prng.next() * Math.PI * 2,
  }));

  for (let i = 0; i < buffer.length; i++) {
    let coord = [];
    let idx = i;
    for (let d of dims.reverse()) {
      coord.unshift(idx % d);
      idx = Math.floor(idx / d);
    }
    for (let w of waves) {
      let dist = coord.reduce((s, c, j) => s + (c - w.offset[j]) ** 2, 0);
      buffer[i] =
        ((buffer[i] ^ (((Math.sin(dist * w.freq + w.phase) + 1) / 2) * w.amp)) |
          0) &
        0xff;
    }
  }

  // Mega loop + dynamic code
  let dynamicSum = 0;
  for (let i = 0; i < 200; i++) {
    const code = `return ${i} + ${fn(i, i, i)} + ${obj.a} + ${obj.b} + ${sym.toString().length};`;
    dynamicSum += new Function(code)();
    await queueMicrotask(() => {}); // stress microtasks
  }

  // Deep async recursion
  const recResult = await deepAsync(20);

  console.log({
    proxyDouble: obj.double(21),
    typedArraySample: buffer.slice(0, 10),
    dynamicSum,
    symbolValue: sym.toString().length,
    recResult,
    weakRef: wr.deref(),
  });
})();
