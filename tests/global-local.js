/**
 * Tests global variables, local scope, and reassignment.
 */
let globalCounter = 100;

function updateCounter(localValue) {
  let temp = 10; // Local variable that should not leak
  globalCounter = globalCounter + localValue + temp;
  return globalCounter;
}

console.log("Initial global value:", globalCounter); // Should be 100

updateCounter(5); // globalCounter becomes 100 + 5 + 10 = 115

console.log("Value after first call:", globalCounter); // Should be 115

let result = updateCounter(20); // globalCounter becomes 115 + 20 + 10 = 145

console.log(result);
