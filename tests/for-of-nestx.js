const stateGraph = new Map([
  [
    "INIT",
    [
      ["LOADING", ["WAITING", "PROCESSING"]],
      ["CANCELLED", []],
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

for (const [state, branches] of stateGraph) {
  for (const [nextState, subStates] of branches) {
    if (nextState === "CANCELLED") continue; // skip a branch
    for (const sub of subStates) {
      console.log(`State ${state} → ${nextState} → ${sub}`);
      if (sub === "PROCESSING") break; // exit inner loop early
    }
  }
}
