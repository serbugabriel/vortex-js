async function* inner() {
  yield "A";
  throw new Error("boom");
}

async function* outer() {
  try {
    yield* inner();
  } catch (e) {
    yield `recovered from: ${e.message}`;
  }

  yield "still running";
}

(async () => {
  for await (const v of outer()) {
    console.log(v);
  }
})();
