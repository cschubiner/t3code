import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
