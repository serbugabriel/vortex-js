async function* source() {
  yield 1;
  yield 2;
  yield 3;
}

async function* map(gen, fn) {
  for await (const value of gen) {
    yield fn(value);
  }
}

async function* filter(gen, fn) {
  for await (const value of gen) {
    if (fn(value)) yield value;
  }
}

(async () => {
  const pipeline = filter(
    map(source(), (x) => x * 2),
    (x) => x > 2,
  );

  for await (const value of pipeline) {
    console.log(value);
  }
})();
