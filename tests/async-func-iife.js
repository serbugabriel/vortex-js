// Simulate async computation with delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Step 1: transform input into some numeric seed
async function step1(input) {
  await delay(200); // simulate async work
  let seed = 0;
  for (let i = 0; i < input.length; i++) {
    seed += input.charCodeAt(i) * (i + 1);
  }
  return seed;
}

// Deterministic pseudo-random function based on a number
function deterministicRandom(seed) {
  // Simple linear congruential generator
  return (seed * 1664525 + 1013904223) & 0xffffffff;
}

// Step 2: create a deterministic "random-ish" modifier
async function step2(seed) {
  await delay(300); // async delay
  return deterministicRandom(seed) % 0xffff;
}

// Step 3: generate a final string key from number
async function step3(num) {
  await delay(150); // async delay
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "";
  for (let i = 0; i < 8; i++) {
    key += chars[(num + i * 7) % chars.length];
  }
  return `TEST-${key}`;
}

// Master async function to compute the key deterministically
async function computeMadTestKey(input) {
  const seed = await step1(input);
  const modifier = await step2(seed);

  const finalNum = seed + modifier;
  const key = await step3(finalNum);

  return key;
}

// Example usage
(async () => {
  const testKey = await computeMadTestKey("my-secret-input");
  console.log("Mad Test Key:", testKey); // Always the same for this input
})();
