// Example: try-catch-finally with logical tests in a for loop
const values = [25, "apple", 0, 18, null, 42];

for (let i = 0; i < values.length; i++) {
  try {
    const val = values[i];

    // Logical test: must be a number AND greater than 10
    if (typeof val !== "number" || val <= 10) {
      throw new Error(`Invalid value detected: ${val}`);
    }

    console.log(`✅ Valid number found: ${val}`);
  } catch (err) {
    console.warn(`⚠️ Caught an error at index ${i}: ${err.message}`);
  } finally {
    // Always runs — no matter what happened above
    console.log(`🔍 Finished checking value at index ${i}`);
  }
}

console.log("✨ All done, master — loop and cleanup complete!");
