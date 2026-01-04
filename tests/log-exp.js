// Example: Filter numbers based on logical conditions
const numbers = [3, 7, 12, 18, 21, 30];
const result = [];

for (let i = 0; i < numbers.length; i++) {
  const num = numbers[i];

  // Logical expression: number is even AND greater than 10
  if (num % 2 === 0 && num > 10) {
    result.push(num);
  }
}

console.log("Numbers that are even AND greater than 10:", result);
