let order = [];

function test() {
  try {
    return (order.push(1), thrower(), order.push(2));
  } finally {
    order.push(3);
  }
}

function thrower() {
  order.push(4);
  throw 42;
}

try {
  test();
} catch {}

console.log(order);
