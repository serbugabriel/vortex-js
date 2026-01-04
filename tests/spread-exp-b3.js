function saveTodo(todo) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ ...todo, saved: true }), 400);
  });
}

let state = {
  todos: [
    { id: 1, text: "Learn JS", saved: true },
    { id: 2, text: "Write code", saved: false },
  ],
};

async function saveTodoById(id) {
  // optimistic update
  state = {
    ...state,
    todos: state.todos.map((t) => (t.id === id ? { ...t, saving: true } : t)),
  };

  const todo = state.todos.find((t) => t.id === id);
  const savedTodo = await saveTodo(todo);

  // reconcile with server response
  state = {
    ...state,
    todos: state.todos.map((t) =>
      t.id === id ? { ...t, ...savedTodo, saving: false } : t,
    ),
  };

  console.log(state);
}

saveTodoById(2);
