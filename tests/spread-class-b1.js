// A factory function that creates a deterministic clock
const createSeededClock = (seed) => {
  let current = seed;
  return {
    // Returns the current seed, then increments it by 1ms for the next call
    createdAt: () => current++,
  };
};

// Initialize with a seed
const timestamps = createSeededClock(1715000000000);

class Model {
  constructor(data) {
    Object.assign(this, {
      id: null,
      ...data,
      meta: { createdAt: timestamps.createdAt() },
    });
  }
}

const model1 = new Model({ id: 1 });
const model2 = new Model({ id: 2 });

console.log(model1.meta.createdAt); // 1715000000000
console.log(model2.meta.createdAt); // 1715000000001 (Always increments by 1)
