/**
 * Creates a proxy that logs get and set operations on an object.
 * @param {object} target - The object to wrap.
 * @returns {Proxy} A new proxy-wrapped object.
 */
function createLoggingProxy(target) {
  const handler = {
    // Trap for getting a property value
    get(target, property, receiver) {
      console.log(`GET property "${String(property)}"`);
      // Perform the default behavior
      return Reflect.get(target, property, receiver);
    },

    // Trap for setting a property value
    set(target, property, value, receiver) {
      console.log(
        `SET property "${String(property)}" to ${JSON.stringify(value)}`,
      );
      // Perform the default behavior
      return Reflect.set(target, property, value, receiver);
    },
  };

  return new Proxy(target, handler);
}

// --- Example Usage ---
const myData = { name: "Alice", age: 30 };
const loggedData = createLoggingProxy(myData);

console.log("--- Accessing properties ---");
loggedData.age; // Logs: GET property "age"
loggedData.name = "Bob"; // Logs: SET property "name" to "Bob"
