const p1 = Promise.resolve("I’m done ✔️");
const p2 = Promise.reject("Oops, I messed up ❌");
const p3 = new Promise((resolve) =>
  setTimeout(() => resolve("Slow but steady 🐢"), 500),
);

Promise.allSettled([p1, p2, p3]).then((results) => {
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(`Promise ${index + 1} fulfilled with:`, result.value);
    } else {
      console.log(`Promise ${index + 1} rejected with:`, result.reason);
    }
  });
});
