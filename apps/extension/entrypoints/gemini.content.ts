import { createRuntimeLogger } from "../src/runtime/logger";
import { mountGeminiContentRuntime } from "../src/platforms/gemini/content-runtime";

export default defineContentScript({
  matches: ["https://gemini.google.com/*"],
  async main() {
    const log = createRuntimeLogger("content.gemini");
    await log("info", "Gemini content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await mountGeminiContentRuntime(log);
  },
});
