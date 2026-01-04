function makeCounter(start) {
  let x = start;

  return function () {
    return ((x += 1), (x *= 2), x - 3);
  };
}

let c1 = makeCounter(1);
let c2 = makeCounter(5);

let result =
  (c1(), // first call
  c2(), // second call
  c1(), // third call
  c2()); // final value should come from here

console.log(result);
