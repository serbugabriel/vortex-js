const events = [
  { type: "ADD", value: 10 },
  { type: "SUB", value: 3 },
  { type: "ADD", value: 7 },
  { type: "MUL", value: 2 },
  { type: "SUB", value: 1 },
];

// Separate additive and multiplicative logic cleanly
const finalScore = events
  // Keep only recognized event types
  .filter((e) => ["ADD", "SUB", "MUL"].includes(e.type))
  // Partition: first handle add/sub, collect mul separately
  .reduce(
    (acc, e) => {
      if (e.type === "ADD") acc.sum += e.value;
      else if (e.type === "SUB") acc.sum -= e.value;
      else if (e.type === "MUL") acc.mul.push(e.value);
      return acc;
    },
    { sum: 0, mul: [] },
  );

// Apply all multipliers at the end
const result = finalScore.mul.reduce((acc, m) => acc * m, finalScore.sum);

console.log(result); // (10 - 3 + 7 - 1) * 2 = 26
