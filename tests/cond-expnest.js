function evaluate(input) {
  return typeof input === "number"
    ? input > 0
      ? input % 2 === 0
        ? "Positive even number"
        : "Positive odd number"
      : input < 0
        ? input % 2 === 0
          ? "Negative even number"
          : "Negative odd number"
        : "Zero"
    : typeof input === "string"
      ? input.length > 5
        ? input.includes("!")
          ? "Long, excited string"
          : "Long string"
        : input.includes("!")
          ? "Short, excited string"
          : "Short string"
      : "Unknown type";
}

// Test cases
console.log(evaluate(8)); // Positive even number
console.log(evaluate(-3)); // Negative odd number
console.log(evaluate("Hello!")); // Short, excited string
console.log(evaluate("Greetings")); // Long string
console.log(evaluate(null)); // Unknown type
