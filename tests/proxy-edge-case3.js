function add(a, b) {
  return a + b;
}

const PAdd = new Proxy(add, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args) * 2;
  },
});

console.log(PAdd(2, 3)); // 10
