import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The server package spins up real subprocesses, sockets, and sqlite-backed
    // runtimes. Under the full monorepo turbo run, the default 5s budget is too
    // tight and causes load-dependent flakes.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
