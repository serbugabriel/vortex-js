async function fetchUser() {
  // mock API delay
  await new Promise((r) => setTimeout(r, 300));

  return {
    id: 1,
    profile: {
      name: "Alex",
      address: {
        city: "Berlin",
      },
    },
  };
}

const state = {
  user: {
    profile: {
      name: "",
      address: {
        city: "",
        country: "DE",
      },
    },
    loading: true,
  },
};

async function loadUser() {
  const data = await fetchUser();

  const newState = {
    ...state,
    user: {
      ...state.user,
      ...data,
      profile: {
        ...state.user.profile,
        ...data.profile,
        address: {
          ...state.user.profile.address,
          ...data.profile.address,
        },
      },
      loading: false,
    },
  };

  console.log(newState);
}

loadUser();
