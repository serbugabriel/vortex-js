const stateMap = new Map([
  ["INIT", ["LOADING", "WAITING"]],
  ["LOADING", ["SUCCESS", "ERROR"]],
  ["SUCCESS", ["DONE"]],
]);

for (const [state, nextStates] of stateMap) {
  for (const next of nextStates) {
    console.log(`State ${state} → ${next}`);
  }
}
