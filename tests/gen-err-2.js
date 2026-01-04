async function* resource() {
  try {
    yield "using resource";
    yield "still using";
  } finally {
    console.log("resource cleaned up");
  }
}

(async () => {
  for await (const v of resource()) {
    console.log(v);
    break; // early exit
  }
})();
