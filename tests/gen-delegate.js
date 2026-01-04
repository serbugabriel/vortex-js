function* innerGenerator() {
  yield 1;
  yield 2;
  return 3;
}

function* outerGenerator() {
  const result = yield* innerGenerator();
  console.log("Inner returned:", result);

  yield 4;
}

for (const value of outerGenerator()) {
  console.log(value);
}
