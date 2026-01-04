// Create a promise with manual resolve/reject controls
const { promise, resolve, reject } = Promise.withResolvers();

function doSomethingAsync() {
  // Simulate some async event
  setTimeout(() => {
    const success = Math.random() > 0.1;
    if (success) {
      resolve("All done, darling.");
    } else {
      reject("Something exploded. Oops.");
    }
  }, 1000);

  return promise;
}

// Use it like a normal promise
doSomethingAsync()
  .then((result) => {
    console.log("Success:", result);
  })
  .catch((error) => {
    console.log("Failure:", error);
  });
