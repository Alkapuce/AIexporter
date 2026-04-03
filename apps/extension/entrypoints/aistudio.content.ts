import { createRuntimeLogger } from "../src/runtime/logger";
import { mountAiStudioContentRuntime } from "../src/platforms/aistudio/content-runtime";

export default defineContentScript({
  matches: ["https://aistudio.google.com/*"],
  async main() {
    const log = createRuntimeLogger("content.aistudio");
    await log("info", "AI Studio content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await mountAiStudioContentRuntime(log);
  },
});
