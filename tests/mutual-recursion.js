/**
 * Tests mutual recursion and boolean logic.
 * isEven calls isOdd, and isOdd calls isEven.
 */

function isOdd(n) {
  if (n === 0) {
    return false;
  }
  console.log("isOdd check for:", n);
  return isEven(n - 1);
}

function isEven(n) {
  if (n === 0) {
    return true;
  }
  console.log("isEven check for:", n);
  return isOdd(n - 1);
}

let result = isEven(10); // Should be true
console.log("Is 10 even?", result);

let result2 = isOdd(7); // Should be true
console.log("Is 7 odd?", result2);
