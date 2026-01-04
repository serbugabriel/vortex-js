// Simulate an async task that resolves after a delay
function wait(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Nested async functions
async function fetchUser(userId) {
  console.log(`Fetching user ${userId}...`);
  const user = await wait(1000, { id: userId, name: `User${userId}` });
  return user;
}

async function fetchPosts(user) {
  console.log(`Fetching posts for ${user.name}...`);
  const posts = await wait(1500, [
    { id: 1, title: `Post1 by ${user.name}` },
    { id: 2, title: `Post2 by ${user.name}` },
  ]);
  return posts;
}

// Main async function with Promise.all
async function main() {
  const userIds = [1, 2, 3];

  // Fetch users in parallel
  const users = await Promise.all(userIds.map((id) => fetchUser(id)));
  console.log("Users fetched:", users);

  // For each user, fetch their posts in parallel
  const allPosts = await Promise.all(users.map((user) => fetchPosts(user)));
  console.log("All posts:", allPosts);
}

main();
