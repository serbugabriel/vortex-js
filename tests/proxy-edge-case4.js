function G(x) {
  this.x = x;
  this.nt = new.target;
}

const PG = new Proxy(G, {
  construct(target, args, newTarget) {
    return Reflect.construct(target, args, newTarget);
  },
});

const obj = new PG(5);
console.log(obj.x); // 5
console.log(obj.nt === PG); // true
