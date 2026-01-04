async function riskyOperation() {
  try {
    const result = await new Promise((_, reject) => {
      setTimeout(() => reject("💥 Network exploded!"), 1000);
    });
    console.log(result);
  } catch (err) {
    console.error("Oops:", err);
  }
}

riskyOperation();
