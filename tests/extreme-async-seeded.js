// ---------- seeded PRNG ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- async generator (job producer) ----------
async function* jobGenerator(maxJobs, rng) {
  for (let i = 1; i <= maxJobs; i++) {
    await sleep(50); // deterministic arrival delay
    yield {
      id: i,
      payload: Math.floor(rng() * 100),
    };
  }
}

// ---------- worker ----------
async function processJob(job, workerId, cancelFlag, rng) {
  if (cancelFlag.cancelled) return;

  // deterministic processing time
  const processingTime = 100 + Math.floor(rng() * 300);
  await sleep(processingTime);

  // deterministic failure decision
  if (rng() < 0.2) {
    throw new Error(`Worker ${workerId} failed job ${job.id}`);
  }

  return `Worker ${workerId} processed job ${job.id}`;
}

// ---------- worker pool ----------
async function workerPool({ workers = 3, jobs, cancelFlag, rng }) {
  const results = [];
  const active = new Set();

  async function runWorker(workerId) {
    for await (const job of jobs) {
      if (cancelFlag.cancelled) break;

      const task = processJob(job, workerId, cancelFlag, rng)
        .then((res) => results.push(res))
        .catch((err) => {
          console.error(err.message);
          cancelFlag.cancelled = true;
        })
        .finally(() => active.delete(task));

      active.add(task);

      // backpressure
      if (active.size >= workers) {
        await Promise.race(active);
      }
    }
  }

  await Promise.all(
    Array.from({ length: workers }, (_, i) => runWorker(i + 1)),
  );

  await Promise.all(active);
  return results;
}

// ---------- main ----------
async function main() {
  const SEED = 123456; // 🔒 change seed → different run, same seed → same run
  const rng = mulberry32(SEED);

  const cancelFlag = { cancelled: false };
  const jobs = jobGenerator(20, rng);

  console.log("⚙️ Starting worker pool\n");

  const results = await workerPool({
    workers: 4,
    jobs,
    cancelFlag,
    rng,
  });

  console.log("\n✅ Results:");
  results.forEach((r) => console.log(r));

  console.log("\n🏁 Finished");
}

main();
