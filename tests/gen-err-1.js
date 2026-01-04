async function* inner() {
  try {
    yield "inner start";
    yield "inner end";
  } catch (e) {
    yield `inner caught: ${e.message}`;
  }
}

async function* outer() {
  yield* inner();
}

(async () => {
  const gen = outer();

  console.log((await gen.next()).value);

  // Inject error into outer → forwarded to inner
  console.log((await gen.throw(new Error("stop"))).value);
})();
