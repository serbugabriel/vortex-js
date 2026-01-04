const userSettings = {
  theme: "dark",
  fontSize: 14,
};

const defaultHandler = {
  get(target, property) {
    // Check if the property exists on the target
    // If it does, return it. If not, return the default value.
    return property in target ? target[property] : "Setting not found";
  },
};

const settingsProxy = new Proxy(userSettings, defaultHandler);

console.log(settingsProxy.theme); // -> 'dark' (exists)
console.log(settingsProxy.fontSize); // -> 14 (exists)
console.log(settingsProxy.language); // -> 'Setting not found' (doesn't exist)
