import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const browserApiPort = Number(process.env.VITEST_BROWSER_PORT ?? 63315);

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        "@pierre/diffs/react": fileURLToPath(
          new URL("./src/test/diffReact.browser-shim.tsx", import.meta.url),
        ),
        "~": srcPath,
      },
    },
    test: {
      include: ["src/components/**/*.browser.tsx"],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        headless: true,
        api: {
          port: browserApiPort,
          strictPort: true,
        },
      },
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
