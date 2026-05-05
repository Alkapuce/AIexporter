import { buildDiscoveryFingerprint, type MainWorldBridgeMessage, type RuntimeMessage } from "@aiexporter/adapter-sdk";
import {
  chatgptAdapter,
  extractConversationIdFromUrl,
  parseChatGptConversationResponse,
} from "@aiexporter/adapters-chatgpt";
import { normalizeConversationUrl } from "@aiexporter/core-schema";
import { createDiscoveryBatchSender } from "../src/runtime/discovery-batch";
import { createRuntimeLogger } from "../src/runtime/logger";

async function queueCurrentConversation(): Promise<void> {
  const sourceId = extractConversationIdFromUrl(window.location.href);
  if (!sourceId) return;

  const payload = {
    sourceId,
    url: window.location.href,
    title: document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim() || undefined,
    sourceUpdatedAt: undefined,
  };

  const revisionFingerprint = await buildDiscoveryFingerprint("chatgpt", payload);
  const message: RuntimeMessage = {
    type: "queue-discovery",
    event: {
      platform: "chatgpt",
      ...payload,
      revisionFingerprint,
    },
  };

  await browser.runtime.sendMessage(message);
}

function installUrlChangeMonitor(onChange: (url: string) => void): () => void {
  let lastUrl = window.location.href;
  let disposed = false;
  const notifyIfChanged = () => {
    if (disposed) return;
    const nextUrl = window.location.href;
    if (nextUrl === lastUrl) return;
    lastUrl = nextUrl;
    onChange(nextUrl);
  };

  const historyRef = window.history as History & {
    __aiexporterOriginalPushState?: History["pushState"];
    __aiexporterOriginalReplaceState?: History["replaceState"];
  };

  if (!historyRef.__aiexporterOriginalPushState) {
    historyRef.__aiexporterOriginalPushState = historyRef.pushState.bind(historyRef);
    historyRef.pushState = ((...args: Parameters<History["pushState"]>) => {
      const result = historyRef.__aiexporterOriginalPushState!(...args);
      queueMicrotask(notifyIfChanged);
      return result;
    }) as History["pushState"];
  }

  if (!historyRef.__aiexporterOriginalReplaceState) {
    historyRef.__aiexporterOriginalReplaceState = historyRef.replaceState.bind(historyRef);
    historyRef.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      const result = historyRef.__aiexporterOriginalReplaceState!(...args);
      queueMicrotask(notifyIfChanged);
      return result;
    }) as History["replaceState"];
  }

  const onPopState = () => notifyIfChanged();
  const onHashChange = () => notifyIfChanged();
  const interval = window.setInterval(notifyIfChanged, 15_000);
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);

  return () => {
    disposed = true;
    window.clearInterval(interval);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
  };
}

async function fetchChatGptConversationViaPageWorld(sourceId: string) {
  const requestId = crypto.randomUUID();
  const normalizedUrl = normalizeConversationUrl(window.location.href);

  return new Promise<ReturnType<typeof parseChatGptConversationResponse>>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("ChatGPT page-world conversation fetch timed out."));
    }, 15_000);

    const listener = (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "chatgpt-page-api-response") return;
      if (event.data.requestId !== requestId || event.data.sourceId !== sourceId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", listener);

      if (!event.data.response) {
        reject(new Error("ChatGPT page-world bridge returned an empty response."));
        return;
      }

      if (!event.data.response.ok) {
        reject(new Error(event.data.response.error));
        return;
      }

      try {
        resolve(
          parseChatGptConversationResponse(
            event.data.response.data as Record<string, unknown>,
            normalizedUrl,
            sourceId,
          ),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    window.addEventListener("message", listener);
    window.postMessage(
      {
        source: "aiexporter",
        type: "aiexporter.chatgpt.fetch-conversation",
        requestId,
        sourceId,
      },
      window.location.origin,
    );
  });
}

export default defineContentScript({
  matches: ["https://chatgpt.com/*"],
  async main() {
    const log = createRuntimeLogger("content.chatgpt");
    await log("info", "ChatGPT content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await injectScript("/chatgpt-main-world.js", {
      keepInDom: true,
    });
    await log("debug", "Injected ChatGPT main-world bridge.");

    const batchSender = createDiscoveryBatchSender({
      platform: "chatgpt",
      onFlush: async ({ events, reason }) => {
        await log("debug", "ChatGPT passive discovery batch flushed.", {
          code: "discovery.batch_flushed",
          batchSize: events.length,
          reason,
        });
      },
    });

    const onWindowMessage = async (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "chatgpt-network-discovery") return;
      if (!event.data.payload) return;

      await log("debug", "Received main-world discovery payload.", {
        payload: event.data.payload,
      });
      const revisionFingerprint = await buildDiscoveryFingerprint("chatgpt", event.data.payload);
      await batchSender.enqueue({
        platform: "chatgpt",
        ...event.data.payload,
        revisionFingerprint,
      });
    };

    window.addEventListener("message", onWindowMessage);

    browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      if (message.type === "worker-ready-ping") {
        sendResponse({
          ok: true,
          title: document.title,
          url: window.location.href,
        });
        return undefined;
      }

      if (message.type !== "extract-current-conversation") {
        return undefined;
      }

      void log("debug", "Received extract-current-conversation request.", {
        url: window.location.href,
      });
      const sourceId = extractConversationIdFromUrl(window.location.href);
      void (async () => {
        if (!sourceId) {
          throw new Error("Current page is not a ChatGPT conversation URL.");
        }

        try {
          await log("debug", "Attempting ChatGPT page-world API extraction.", {
            code: "extract.page_world_request_started",
            sourceId,
            url: window.location.href,
          });
          const bundle = await fetchChatGptConversationViaPageWorld(sourceId);
          await log("info", "Extracted current ChatGPT conversation via page-world API.", {
            code: "extract.page_world_success",
            sourceId: bundle.sourceId,
            messageCount: bundle.messages.length,
          });
          sendResponse(bundle);
          return;
        } catch (error) {
          await log("warn", "ChatGPT page-world API extraction failed, falling back to DOM.", {
            code: "extract.api_failed",
            sourceId,
            error: error instanceof Error ? error.message : "ChatGPT page-world API extraction failed",
          });
        }

        const bundle = await chatgptAdapter.extractCurrentConversation({
          document,
          window,
          location,
        });
        await log("warn", "Extracted current ChatGPT conversation via DOM fallback.", {
          code: "extract.dom_fallback_used",
          sourceId: bundle.sourceId,
          messageCount: bundle.messages.length,
        });
        sendResponse(bundle);
      })().catch((error) => {
        void log("error", "Failed to extract current ChatGPT conversation.", {
          error: error instanceof Error ? error.message : "Failed to extract current conversation",
        });
        sendResponse({
          __aiexporterError: error instanceof Error ? error.message : "Failed to extract current conversation",
        });
      });

      return true;
    });

    await queueCurrentConversation();
    await log("debug", "Queued current conversation from initial page load.", {
      url: window.location.href,
    });

    installUrlChangeMonitor((nextUrl) => {
      void log("debug", "Detected ChatGPT URL change.", {
        url: nextUrl,
      });
      void queueCurrentConversation();
    });
  },
});
