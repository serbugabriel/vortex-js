// Our target object
const person = {
  name: "Bob",
  age: 42,
};

// Our handler with a validation trap
const validationHandler = {
  set(target, property, value) {
    if (property === "age") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new TypeError("Age must be an integer.");
      }
      if (value < 0 || value > 150) {
        throw new RangeError("The age seems invalid.");
      }
    }

    // If validation passes, set the value on the target object
    return Reflect.set(target, property, value);
  },
};

const validatedPerson = new Proxy(person, validationHandler);

// --- Let's test it ---

try {
  validatedPerson.age = 45; // This is valid
  console.log("Age set successfully to:", validatedPerson.age); // -> 45

  validatedPerson.name = "Robert"; // This is also valid (no validation for 'name')
  console.log("Name set successfully to:", validatedPerson.name); // -> Robert

  // validatedPerson.age = "fifty"; // This will fail
  validatedPerson.age = 200; // This will also fail
} catch (error) {
  console.error("Oops!", error.message);
  // -> Oops! The age seems invalid.
}

console.log("Final person state:", person); // -> { name: 'Robert', age: 45 }
