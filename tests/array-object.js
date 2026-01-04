/**
 * Test script for array and object support.
 *
 * This test covers:
 * - Array and object literal creation.
 * - Member access (dot notation and computed).
 * - Member assignment (dot notation and computed).
 * - Using these values in expressions.
 */

function processData() {
  // 1. Create an array and an object
  let arr = [10, 20, 30];
  let obj = {
    a: 5,
    b: 15,
    c: {
      nested: true,
    },
  };
  let key = "b";
  let result = 0;

  // 2. Read values and perform calculations
  // result = arr[0] + obj.a; // Should be 10 + 5 = 15
  result = result + arr[0];
  result = result + obj.a;
  console.log("Initial calculation:", result); // Expected: 15

  // 3. Modify values using member assignment
  arr[0] = 100;
  obj.a = 50;

  // 4. Read modified values and computed properties
  // result = arr[0] + obj['a'] + obj[key]; // Should be 100 + 50 + 15 = 165
  let temp1 = arr[0];
  let temp2 = obj["a"];
  let temp3 = obj[key];
  result = temp1 + temp2 + temp3;

  console.log("Final calculation:", result); // Expected: 165

  // 5. Test nested object access
  if (obj.c.nested) {
    console.log("Nested access works!");
  } else {
    console.log("Nested access failed.");
  }

  // 6. Return one of the modified structures
  return arr;
}

let finalArray = processData();

// We expect finalArray to be [100, 20, 30]
console.log("Final array value:", finalArray[0], finalArray[1], finalArray[2]);
