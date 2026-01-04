function* eventGenerator() {
  yield { type: "ADD", value: 5 };
  yield { type: "SUB", value: 2 };
  yield { type: "MUL", value: 3 };
}

let total = 0;

for (const event of eventGenerator()) {
  switch (event.type) {
    case "ADD":
      total += event.value;
      break;
    case "SUB":
      total -= event.value;
      break;
    case "MUL":
      total *= event.value;
      break;
  }
}

console.log("Final total:", total);
