import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

// Helper to create an isolated VM
function createVMContext() {
  const context = vm.createContext({
    console,
    setTimeout,
    setInterval,
    structuredClone,
    globalThis: {},
  });

  // Hardened individual globals
  Object.freeze(context.console);
  Object.freeze(context.globalThis);

  return context;
}

// Run an ESM module inside a VM context
async function runModule(code, context) {
  const module = new vm.SourceTextModule(code, {
    context,
    initializeImportMeta(meta) {
      meta.url = `vm:module-${Math.random()}`;
    },
    importModuleDynamically: async (specifier) => {
      throw new Error(`Blocked dynamic import: ${specifier}`);
    },
  });

  await module.link(() => {}); // No imports allowed
  await module.evaluate();
  return module;
}

test("vm escape attempts + parallel async stress", async () => {
  // 1. VM escape attempt
  const escapeCode = `
  export const escape = (() => {
    try {
      return process.version || fs || Function('return this')();
    } catch(e) {
      return 'blocked';
    }
  })();
  `;

  const sandbox1 = createVMContext();
  const module1 = await runModule(escapeCode, sandbox1);

  assert.equal(module1.namespace.escape, "blocked");

  // 2. Parallel VM async stress
  const parallelCode = `
  export async function asyncTasks(id) {
    const results = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, Math.random()*10));
      results.push(\`vm-\${id}-task-\${i}\`);
    }
    return results;
  }
  `;

  const vmCount = 4;
  const vms = Array.from({ length: vmCount }, (_, i) => createVMContext());
  const modules = await Promise.all(
    vms.map((ctx) => runModule(parallelCode, ctx)),
  );

  // Execute asyncTasks in parallel
  const results = await Promise.all(
    modules.map((mod, i) => mod.namespace.asyncTasks(i)),
  );

  // Validate results
  results.forEach((res, i) => {
    assert.equal(res.length, 5);
    res.forEach((task, j) => {
      assert.equal(task, `vm-${i}-task-${j}`);
    });
  });
});
