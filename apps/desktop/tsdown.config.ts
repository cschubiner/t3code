import { defineConfig } from "tsdown";

const shared = {
  outDir: "dist-electron",
  sourcemap: true,
};

export default defineConfig([
  {
    ...shared,
    format: "esm",
    outExtensions: () => ({ js: ".mjs" }),
    entry: ["src/main.ts"],
    clean: true,
    noExternal: (id) => id.startsWith("@t3tools/"),
  },
  {
    ...shared,
    format: "cjs",
    outExtensions: () => ({ js: ".js" }),
    entry: ["src/preload.ts"],
  },
]);
