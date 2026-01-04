(async () => {
  const prng = (() => {
    let s = Date.now() & 0xffffffff;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0xffffffff;
    };
  })();

  // Deep recursion / async stress
  const asyncFib = async (n) => {
    if (n <= 1) return n;
    await new Promise((r) => setTimeout(r, 0));
    return (await asyncFib(n - 1)) + (await asyncFib(n - 2));
  };

  // Proxy stress
  const handler = {
    get: (target, prop) => {
      if (typeof prop === "string" && prop.startsWith("evil"))
        throw new Error("trap!");
      return Reflect.get(target, prop);
    },
    set: (target, prop, val) => {
      if (typeof val === "number") val *= 2;
      return Reflect.set(target, prop, val);
    },
  };

  const proxy = new Proxy({ a: 1, b: 2 }, handler);

  // TypedArray + multi-dim loop
  const size = 200;
  const buffer = new ArrayBuffer(size * size);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < size * size; i++) {
    arr[i] = (i ^ Math.floor(prng() * 255)) & 0xff;
  }

  // Dynamic function generation
  const fn = new Function("x", "y", "return x*y + Math.sin(y*0.5)");

  // Symbol + object manipulation
  const sym = Symbol("stress");
  const obj = { [sym]: 42, nested: { a: 1, b: 2 } };
  Object.freeze(obj.nested);

  // Heavy math loop
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    sum += Math.sqrt(i * i + Math.pow(prng() * 100, 3)) | 0;
  }

  // Run asyncFib without hanging VM (small n)
  const fibVal = await asyncFib(10);

  console.log({
    proxySet: ((proxy.a = 10), (proxy.b = 20), proxy),
    typedArraySample: arr.slice(0, 10),
    dynamicResult: fn(5, 7),
    symbolValue: obj[sym],
    mathSum: sum,
    fib: fibVal,
  });
})();
