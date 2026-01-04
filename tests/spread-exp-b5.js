async function fetchData() {
  await new Promise((r) => setTimeout(r, 200));
  throw new Error("Network error");
}

let state = {
  data: null,
  error: null,
  loading: true,
};

async function loadData() {
  try {
    const data = await fetchData();
    state = { ...state, data, loading: false };
  } catch (err) {
    state = {
      ...state,
      error: {
        message: err.message,
        time: Date.now(),
      },
      loading: false,
    };
  }

  console.log(state);
}

loadData();
