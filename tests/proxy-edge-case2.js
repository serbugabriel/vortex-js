function Point(x, y) {
  this.x = x;
  this.y = y;
}

const PPoint = new Proxy(Point, {
  construct(target, args, newTarget) {
    return {
      sum: args[0] + args[1],
      instanceofPoint: Object.getPrototypeOf(this) === target.prototype,
    };
  },
});

const p = new PPoint(2, 3);
console.log(p); // { sum: 5, instanceofPoint: false }
