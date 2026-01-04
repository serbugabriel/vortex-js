const fruits = ["🍎", "🍌", "🍇", "🍒"];

// for...of — the elegant way
// Traditional for loop
for (let i = 0; i < fruits.length; i++) {
  console.log(`I’m eating ${fruits[i]}`);
}

console.log("Type 2");

for (const fruit of fruits) {
  console.log(`I’m eating ${fruit}`);
}
