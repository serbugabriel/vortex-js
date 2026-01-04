// ---------- deterministic RNG ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shared mutable state ----------
const shared = {
  produced: 0,
  consumed: 0,
  cleanedUp: 0,
  cancelled: false,
};

// ---------- async generator ----------
async function* evilGenerator(rng) {
  try {
    for (let i = 1; i <= 10; i++) {
      await sleep(20);
      shared.produced++;

      if (rng() < 0.15) {
        throw new Error(`generator error at ${i}`);
      }

      yield i;
    }
  } finally {
    // MUST run exactly once
    shared.cleanedUp++;
    console.log("🧹 generator finally");
  }
}

// ---------- worker ----------
async function worker(id, iter, rng) {
  try {
    for await (const v of iter) {
      await sleep(30 + Math.floor(rng() * 40));
      shared.consumed++;

      if (rng() < 0.25) {
        throw new Error(`worker ${id} failed at ${v}`);
      }

      console.log(`worker ${id} processed ${v}`);
    }
  } catch (e) {
    console.log(e.message);
    shared.cancelled = true;

    // early cancellation
    await iter.return();
  }
}

// ---------- main ----------
async function main() {
  const rng = mulberry32(1337);
  const gen = evilGenerator(rng);

  console.log("⚙️ start");

  await Promise.race([worker(1, gen, rng), worker(2, gen, rng)]);

  console.log("🏁 end");

  console.log("state:", JSON.stringify(shared, null, 2));
}

main();
