/**
 * Tests nested if/else statements.
 */
function checkSign(num) {
  let result = "zero";

  if (num > 0) {
    if (num > 50) {
      result = "large positive";
    } else {
      result = "small positive";
    }
  } else {
    if (num < -50) {
      result = "large negative";
    } else {
      // A non-zero check to avoid testing num === 0
      if (num < 0) {
        result = "small negative";
      }
    }
  }
  return result;
}

console.log("75 is", checkSign(75));
console.log("10 is", checkSign(10));
console.log("0 is", checkSign(0));
console.log("-25 is", checkSign(-25));
let result = checkSign(-100);
