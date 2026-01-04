const secretData = {
  apiKey: "xyz123abc",
  databaseUrl: "prod.db.server.com",
};

const readOnlyHandler = {
  get(target, property) {
    console.log(`(Read-only) Accessing '${property}'`);
    return Reflect.get(target, property);
  },
  set(target, property, value) {
    console.error(
      `Error: Cannot set property '${property}'. This object is read-only.`,
    );
    // We return true to indicate the operation was "handled",
    // but we don't actually change the data.
    // In strict mode, returning false from a 'set' trap throws a TypeError.
    return true;
  },
  deleteProperty(target, property) {
    console.error(
      `Error: Cannot delete property '${property}'. This object is read-only.`,
    );
    return true;
  },
};

const readOnlyProxy = new Proxy(secretData, readOnlyHandler);

// Reading is fine
console.log(readOnlyProxy.apiKey); // -> (Read-only) Accessing 'apiKey' -> xyz123abc

// But writing is blocked
readOnlyProxy.apiKey = "new-key-attempt"; // -> Error: Cannot set property 'apiKey'...

// The original object remains unchanged
console.log(secretData.apiKey); // -> 'xyz123abc'
