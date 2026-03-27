import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@aiexporter/adapter-sdk": path.resolve(__dirname, "../../packages/adapter-sdk/src/index.ts"),
      "@aiexporter/core-markdown": path.resolve(__dirname, "../../packages/core-markdown/src/index.ts"),
      "@aiexporter/core-schema": path.resolve(__dirname, "../../packages/core-schema/src/index.ts"),
    },
  },
});
