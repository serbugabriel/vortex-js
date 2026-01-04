const numbers = [1, 2, 3, 4, 5];

// Using a function expression
const doubled1 = numbers.map(function (num) {
  return num * 2;
});

console.log(doubled1); // [2, 4, 6, 8, 10]

// Using an arrow function (explicit return)
const doubled2 = numbers.map((num) => {
  return num * 2;
});

console.log(doubled2); // [2, 4, 6, 8, 10]

// Using an arrow function (implicit return)
const doubled3 = numbers.map((num) => num * 2);

console.log(doubled3); // [2, 4, 6, 8, 10]
