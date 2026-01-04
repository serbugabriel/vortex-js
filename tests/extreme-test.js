class ResourceLog extends Array {
  async addAsync(msg) {
    await Promise.resolve();
    this.push(msg);
  }
}

async function* inner(log) {
  try {
    yield "inner-1";
    yield "inner-2";
  } finally {
    await log.addAsync("inner-finally");
  }
}

async function* outer(log) {
  try {
    yield "outer-1";
    yield* inner(log);
    yield "outer-2";
  } catch (e) {
    log.push("outer-catch:" + e);
  } finally {
    await log.addAsync("outer-finally");
  }
}

async function runTest() {
  const log = new ResourceLog();
  const seen = [];

  await Promise.all([
    (async () => {
      for await (const v of outer(log)) {
        seen.push(v);
        if (v === "inner-1") break; // early exit
      }
    })(),
    (async () => {
      await Promise.resolve(); // concurrency noise
      log.push("parallel-task");
    })(),
  ]);

  return { seen, log };
}

runTest().then(({ seen, log }) => {
  console.log("SEEN:", seen.join(", "));
  console.log("LOG:", log.join(", "));
});
