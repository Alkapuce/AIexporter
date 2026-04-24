import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

const workspaceAlias = {
  "@aiexporter/adapter-sdk": fileURLToPath(
    new URL("../../packages/adapter-sdk/src/index.ts", import.meta.url),
  ),
  "@aiexporter/adapters-chatgpt": fileURLToPath(
    new URL("../../packages/adapters-chatgpt/src/index.ts", import.meta.url),
  ),
  "@aiexporter/adapters-deepseek": fileURLToPath(
    new URL("../../packages/adapters-deepseek/src/index.ts", import.meta.url),
  ),
  "@aiexporter/adapters-gemini": fileURLToPath(
    new URL("../../packages/adapters-gemini/src/index.ts", import.meta.url),
  ),
  "@aiexporter/core-markdown": fileURLToPath(
    new URL("../../packages/core-markdown/src/index.ts", import.meta.url),
  ),
  "@aiexporter/core-schema": fileURLToPath(
    new URL("../../packages/core-schema/src/index.ts", import.meta.url),
  ),
};

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    resolve: {
      alias: workspaceAlias,
    },
  }),
  manifest: {
    name: "AIexporter",
    description:
      "Auto-export ChatGPT, Gemini, AI Studio, and DeepSeek conversations to Markdown and archive them locally.",
    permissions: [
      "storage",
      "downloads",
      "downloads.ui",
      "downloads.open",
      "tabs",
      "scripting",
      "alarms",
      "nativeMessaging",
    ],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://chat.deepseek.com/*",
      "https://gemini.google.com/*",
      "https://aistudio.google.com/*",
      "https://*.googleusercontent.com/*",
      "https://*.gstatic.com/*",
      "https://*.googleapis.com/*",
      // Exported conversations can embed third-party remote assets that must be fetched
      // from the extension/background context before writing them to disk.
      "http://*/*",
      "https://*/*",
    ],
    web_accessible_resources: [
      {
        resources: [
          "chatgpt-main-world.js",
          "deepseek-main-world.js",
          "gemini-main-world.js",
        ],
        matches: [
          "https://chatgpt.com/*",
          "https://chat.deepseek.com/*",
          "https://gemini.google.com/*",
        ],
      },
    ],
  },
});
