function Foo(x) {
  this.x = x;
}

const PFoo = new Proxy(Foo, {
  apply(target, thisArg, args) {
    return target.apply(thisArg, args) * 2;
  },
  construct(target, args) {
    return { constructed: true, value: args[0] };
  },
});

console.log(PFoo.call(null, 3)); // NaN or error (depends on VM strictness)
console.log(new PFoo(7)); // { constructed: true, value: 7 }
