// test/hardcore.test.js
import test from "node:test";
import assert from "node:assert/strict";

// top-level await + dynamic import
const { default: chalk } = await import("chalk");

// async generator
async function* counter(limit) {
  for (let i = 0; i < limit; i++) {
    await new Promise((r) => setTimeout(r, 5));
    yield i;
  }
}

// class with private fields + static factory
class VMService {
  #name;
  #started = false;

  constructor(name) {
    this.#name = name;
  }

  static async create(name) {
    await new Promise((r) => setTimeout(r, 10));
    return new VMService(name);
  }

  async start() {
    if (this.#started) throw new Error("Already started");
    this.#started = true;
    return chalk.green(`[${this.#name}] started`);
  }

  async *runTasks(n) {
    for await (const i of counter(n)) {
      yield chalk.blue(`[${this.#name}] task ${i}`);
    }
  }
}

// combined async torture test
test("vm hardcore integration test", async () => {
  const service = await VMService.create("JS-VM");

  const startedMsg = await service.start();
  assert.ok(startedMsg.includes("started"));
  assert.notEqual(startedMsg, "[JS-VM] started");

  const outputs = [];
  for await (const line of service.runTasks(3)) {
    outputs.push(line);
  }

  assert.equal(outputs.length, 3);
  assert.ok(outputs[0].includes("task 0"));
});

// race conditions + microtasks
test("promise race + microtasks", async () => {
  const fast = Promise.resolve().then(() => "fast");
  const slow = new Promise((r) => setTimeout(() => r("slow"), 20));

  const winner = await Promise.race([fast, slow]);
  assert.equal(winner, "fast");
});

// failure isolation
test("intentional error handling", async () => {
  const service = new VMService("ERR");

  await service.start();
  await assert.rejects(() => service.start(), /Already started/);
});
