async function createRepository(config = {}) {
  const defaults = {
    timeout: 3000,
    retries: 2,
  };

  // mock async setup
  await new Promise((r) => setTimeout(r, 200));

  const state = {
    ...defaults,
    ...config,
    connected: true,
  };

  return {
    ...state,
    query(sql) {
      console.log(`Running: ${sql}`);
    },
  };
}

(async () => {
  const repo = await createRepository({ timeout: 5000 });
  repo.query("SELECT * FROM users");
})();
