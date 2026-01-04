let order = [];

function boom() {
  order.push("boom");
  throw "X";
}

try {
  (order.push(1), boom(), order.push(2));
} catch {}

console.log(order);
