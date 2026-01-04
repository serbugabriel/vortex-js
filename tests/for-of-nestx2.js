const graph = new Map([
  [
    "INIT",
    [
      ["LOADING", ["WAITING", "PROCESSING"]],
      ["SKIP", ["IGNORE", "CANCEL"]],
    ],
  ],
  [
    "LOADING",
    [
      ["SUCCESS", ["DONE"]],
      ["ERROR", []],
    ],
  ],
]);

for (const [state, branches] of graph) {
  for (const [next, subs] of branches) {
    if (next === "SKIP") continue; // mid-level continue
    for (const sub of subs) {
      try {
        console.log(`State ${state} → ${next} → ${sub}`);
        if (sub === "PROCESSING") break; // inner break
      } finally {
        // this runs even when we break or continue
        console.log(`Finalizing ${state}:${next}:${sub}`);
      }
    }
  }
}
