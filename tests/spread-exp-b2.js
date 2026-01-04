async function loadConfigFile() {
  await new Promise((r) => setTimeout(r, 200));
  return {
    api: { timeout: 4000 },
  };
}

async function loadEnvConfig() {
  await new Promise((r) => setTimeout(r, 100));
  return {
    api: { retries: 5 },
  };
}

async function loadConfig() {
  const [fileConfig, envConfig] = await Promise.all([
    loadConfigFile(),
    loadEnvConfig(),
  ]);

  const config = {
    api: {
      timeout: 3000,
      retries: 2,
      ...fileConfig.api,
      ...envConfig.api,
    },
  };

  console.log(config);
}

loadConfig();
