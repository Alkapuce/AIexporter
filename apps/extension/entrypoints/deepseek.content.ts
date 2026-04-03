import { createRuntimeLogger } from "../src/runtime/logger";
import { mountDeepSeekContentRuntime } from "../src/platforms/deepseek/content-runtime";

export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  async main() {
    const log = createRuntimeLogger("content.deepseek");
    await log("info", "DeepSeek content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await injectScript("/deepseek-main-world.js", {
      keepInDom: true,
    });
    await log("debug", "Injected DeepSeek main-world bridge.");
    await mountDeepSeekContentRuntime(log);
  },
});
