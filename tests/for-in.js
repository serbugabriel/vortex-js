const users = {
  user1: {
    name: "Seuriin",
    skills: { coding: "Advanced", reversing: "Expert" },
  },
  user2: {
    name: "Aria",
    skills: { design: "Intermediate", writing: "Advanced" },
  },
};

for (const userKey in users) {
  console.log(`User: ${userKey}`);

  const user = users[userKey];
  for (const detailKey in user) {
    // Check if this property is another object
    if (typeof user[detailKey] === "object") {
      console.log(`  ${detailKey}:`);
      for (const subKey in user[detailKey]) {
        console.log(`    ${subKey}: ${user[detailKey][subKey]}`);
      }
    } else {
      console.log(`  ${detailKey}: ${user[detailKey]}`);
    }
  }
}
