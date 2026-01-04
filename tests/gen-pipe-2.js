async function fetchPage(page = 1) {
  // Simulate API: returns { data: [...], nextPage: number | null }
  await new Promise((r) => setTimeout(r, 300));
  if (page > 3) return { data: [], nextPage: null };
  return { data: [`Item ${page}-1`, `Item ${page}-2`], nextPage: page + 1 };
}

async function* paginatedGenerator(startPage = 1) {
  let page = startPage;
  while (true) {
    const response = await fetchPage(page);
    if (response.data.length === 0) break;
    for (const item of response.data) {
      yield item; // Yield each item asynchronously
    }
    if (!response.nextPage) break;
    page = response.nextPage;
  }
}

async function* nestedPaginated() {
  // "Nest" by composing multiple paginated streams
  yield* paginatedGenerator(1); // First API "resource"
  yield* paginatedGenerator(4); // Another starting point (empty in sim)
  yield "Done!";
}

(async () => {
  for await (const item of nestedPaginated()) {
    console.log("Streamed:", item);
  }
})();
