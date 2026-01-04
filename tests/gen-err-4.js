function* child() {
  try {
    yield "child yield";
  } finally {
    console.log("Child finally runs");
  }
}

function* parent() {
  try {
    yield "parent yield";
    yield* child();
  } finally {
    console.log("Parent finally runs");
  }
}

const it = parent();
console.log(it.next().value); // parent yield
console.log(it.next().value); // child yield

// Throw error from outside – propagates inward
try {
  it.throw(new Error("External error!"));
} catch (e) {
  console.log("Caught outside:", e.message);
}

// Output:
// parent yield
// child yield
// Child finally runs
// Parent finally runs
// Caught outside: External error!
