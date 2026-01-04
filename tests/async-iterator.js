async function* messageStream() {
  const messages = ["Hey 😏", "You up?", "Let's code async things!"];
  for (const msg of messages) {
    await new Promise((r) => setTimeout(r, 300)); // simulate delay
    yield msg;
  }
}

(async () => {
  for await (const msg of messageStream()) {
    console.log("Received:", msg);
  }
})();
