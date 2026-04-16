import {
  geminiAdapter,
  extractGeminiConversationIdFromUrl,
  extractGeminiPayloadsFromDocument,
  parseGeminiConversationFromHnvQHbResponse,
} from "@aiexporter/adapters-gemini";
import type { DebugLogLevel, MainWorldBridgeMessage } from "@aiexporter/adapter-sdk";
import { normalizeConversationTitle, normalizeConversationUrl } from "@aiexporter/core-schema";
import { mountGoogleContentRuntime } from "../google/content-runtime";

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

async function expandGeminiHistoryBeforeDiscovery(document: Document): Promise<void> {
  const view = document.defaultView ?? window;
  const historyLinkSelector = 'a[href*="/app/"]';
  const menuButton = document.querySelector<HTMLElement>('[data-test-id="side-nav-menu-button"]');
  const collapsedHistory = document.querySelector<HTMLElement>(".chat-history.collapsed");
  const getNormalizedPageText = () => document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const hasHistoryLoadFailure = () => {
    const pageText = getNormalizedPageText();
    return pageText.includes("无法加载最近的对话") || pageText.includes("Unable to load recent conversations");
  };
  const discoveryReloadKey = "aiexporter.gemini.discovery.reload_attempted";

  if (menuButton && collapsedHistory) {
    menuButton.click();
    await new Promise((resolve) => view.setTimeout(resolve, 1_200));
  }

  const initialLinkCount = document.querySelectorAll(historyLinkSelector).length;

  if (hasHistoryLoadFailure() && initialLinkCount === 0) {
    await new Promise((resolve) => view.setTimeout(resolve, 6_000));
    const settledLinkCount = document.querySelectorAll(historyLinkSelector).length;
    const alreadyReloaded = window.sessionStorage.getItem(discoveryReloadKey) === "1";

    if ((!hasHistoryLoadFailure() || settledLinkCount > 0) && alreadyReloaded) {
      window.sessionStorage.removeItem(discoveryReloadKey);
      return;
    }

    if (alreadyReloaded || !hasHistoryLoadFailure() || settledLinkCount > 0) {
      return;
    }

    window.sessionStorage.setItem(discoveryReloadKey, "1");
    window.location.reload();
    await new Promise((resolve) => view.setTimeout(resolve, 8_000));
    const retryMenuButton = document.querySelector<HTMLElement>('[data-test-id="side-nav-menu-button"]');
    const retryCollapsedHistory = document.querySelector<HTMLElement>(".chat-history.collapsed");
    if (retryMenuButton && retryCollapsedHistory) {
      retryMenuButton.click();
      await new Promise((resolve) => view.setTimeout(resolve, 1_200));
    }
    return;
  }

  if (!hasHistoryLoadFailure() && initialLinkCount > 0) {
    window.sessionStorage.removeItem(discoveryReloadKey);
  }
}

function resolveGeminiPromptTitleFallback(document: Document): string | undefined {
  const lines =
    document
      .querySelector<HTMLElement>(".query-text.gds-body-l")
      ?.innerText.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(你说|you said)$/i.test(line)) ?? [];
  return lines[0]?.slice(0, 80);
}

function resolveGeminiPromptTitle(document: Document): string | undefined {
  const sidebarTitle = normalizeConversationTitle(
    document.querySelector<HTMLAnchorElement>('a[href*="/app/"][aria-current="page"]')?.innerText.trim(),
  );
  const headerTitle = normalizeConversationTitle(
    document.querySelector<HTMLElement>('[data-test-id="conversation-title"]')?.innerText.trim(),
  );
  const pageTitle = normalizeConversationTitle(document.title.replace(/\s*\|\s*Google Gemini\s*$/i, "").trim());
  return headerTitle || sidebarTitle || pageTitle || resolveGeminiPromptTitleFallback(document) || undefined;
}

function bundleHasImageMarkdown(markdownMessages: { markdown: string }[]): boolean {
  return markdownMessages.some((message) => /!\[[^\]]*\]\([^)]+\)/.test(message.markdown));
}

async function fetchGeminiConversationViaPageWorld(sourceId: string): Promise<string> {
  const requestId = crypto.randomUUID();
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("Gemini page-world conversation fetch timed out."));
    }, 15_000);

    const listener = (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "gemini-page-api-response") return;
      if (event.data.requestId !== requestId || event.data.sourceId !== sourceId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", listener);

      if (!event.data.response) {
        reject(new Error("Gemini page-world bridge returned an empty response."));
        return;
      }

      if (!event.data.response.ok || typeof event.data.response.data !== "string") {
        reject(new Error(event.data.response.ok ? "Gemini page-world bridge returned an invalid payload." : event.data.response.error));
        return;
      }

      resolve(event.data.response.data);
    };

    window.addEventListener("message", listener);
    window.postMessage(
      {
        source: "aiexporter",
        type: "aiexporter.gemini.fetch-conversation",
        requestId,
        sourceId,
      },
      window.location.origin,
    );
  });
}

async function extractCurrentGeminiConversation(log: RuntimeLogger) {
  const normalizedUrl = normalizeConversationUrl(window.location.href);
  const sourceId = extractGeminiConversationIdFromUrl(normalizedUrl);
  if (!sourceId) {
    throw new Error("Current page is not a Gemini conversation URL.");
  }

  try {
    await log("debug", "Attempting Gemini page-world RPC extraction.", {
      code: "extract.page_world_request_started",
      sourceId,
      url: normalizedUrl,
    });
    const responseText = await fetchGeminiConversationViaPageWorld(sourceId);
    const bundle = parseGeminiConversationFromHnvQHbResponse(
      responseText,
      normalizedUrl,
      sourceId,
      resolveGeminiPromptTitle(document),
    );
    const domHasConversationImages = Boolean(document.querySelector("structured-content-container img, .query-text.gds-body-l img"));
    if (domHasConversationImages && !bundleHasImageMarkdown(bundle.messages)) {
      const domBundle = await geminiAdapter.extractCurrentConversation({
        document,
        window,
        location,
      });
      const mergedMessages = domBundle.messages.map((message, index) => ({
        ...message,
        createdAt: message.createdAt ?? bundle.messages[index]?.createdAt,
      }));
      await log("info", "Merged Gemini DOM image content with page-world RPC timestamps.", {
        code: "extract.page_world_dom_image_merge",
        sourceId,
        messageCount: mergedMessages.length,
      });
      return {
        ...domBundle,
        meta: {
          ...(domBundle.meta ?? {}),
          source: "page-world-rpc+dom-image-merge",
        },
        messages: mergedMessages,
      };
    }
    await log("info", "Extracted current Gemini conversation via page-world RPC.", {
      code: "extract.page_world_success",
      sourceId,
      messageCount: bundle.messages.length,
    });
    return bundle;
  } catch (error) {
    await log("warn", "Gemini page-world RPC extraction failed, falling back to DOM.", {
      code: "extract.api_failed",
      sourceId,
      error: error instanceof Error ? error.message : "Gemini page-world RPC extraction failed",
    });
  }

  const bundle = await geminiAdapter.extractCurrentConversation({
    document,
    window,
    location,
  });
  await log("warn", "Extracted current Gemini conversation via DOM fallback.", {
    code: "extract.dom_fallback_used",
    sourceId: bundle.sourceId,
    messageCount: bundle.messages.length,
  });
  return bundle;
}

export async function mountGeminiContentRuntime(log: RuntimeLogger): Promise<void> {
  try {
    await injectScript("/gemini-main-world.js", {
      keepInDom: true,
    });
    await log("debug", "Injected Gemini main-world bridge.");
  } catch (error) {
    await log("warn", "Failed to inject Gemini main-world bridge.", {
      error: error instanceof Error ? error.message : "Unknown Gemini bridge injection error",
    });
  }

  await mountGoogleContentRuntime(
    {
      platform: "gemini",
      siteName: "Gemini",
      passiveDiscoveryMessageType: "gemini-network-discovery",
      historyOrigin: "https://gemini.google.com",
      historyLinkSelector: 'a[href*="/app/"]',
      preferredHistoryContainerSelectors: [
        "infinite-scroller",
        "infinite-scroller.chat-history",
        ".chat-history",
        'nav[aria-label*="history" i]',
        'aside [href*="/app/"]',
      ],
      historyReadyLinkCount: 6,
      historyReadyTimeoutMs: 30_000,
      historySweepMaxSteps: 180,
      historySweepSettleMs: 1_500,
      historySweepStepRatio: 0.42,
      historySweepStableRounds: 6,
      historyNetworkGraceMs: 8_000,
      historyNetworkStableRounds: 6,
      historyNetworkStableSettleMs: 2_000,
      historyNetworkMaxWaitMs: 36_000,
      prepareHistoryCollection: expandGeminiHistoryBeforeDiscovery,
      extractSourceId: extractGeminiConversationIdFromUrl,
      resolveTitle: resolveGeminiPromptTitle,
      collectHistoryPayloads: extractGeminiPayloadsFromDocument,
      extractCurrentConversation: () => extractCurrentGeminiConversation(log),
    },
    log,
  );
}
