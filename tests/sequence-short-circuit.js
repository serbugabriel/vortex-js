let log = [];

function f(x) {
  log.push(x);
  return x;
}

let value = (f(1), false && f(2), true || f(3), f(4));

console.log(value);
console.log(log);
