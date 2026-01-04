async function getMultiple() {
  try {
    // Predefined deterministic jokes
    const joke1 = {
      setup: "Why did the chicken cross the road?",
      punchline: "To get to the other side!",
    };
    const joke2 = {
      setup: "Why don't scientists trust atoms?",
      punchline: "Because they make up everything!",
    };

    // Simulate async fetch with Promise.resolve
    const [j1, j2] = await Promise.all([
      Promise.resolve(joke1),
      Promise.resolve(joke2),
    ]);

    console.log("😂 Here are your jokes:");
    console.log(`1️⃣ ${j1.setup} — ${j1.punchline}`);
    console.log(`2️⃣ ${j2.setup} — ${j2.punchline}`);
  } catch (error) {
    console.error("😅 Something went wrong fetching jokes:", error);
  }
}

getMultiple();
