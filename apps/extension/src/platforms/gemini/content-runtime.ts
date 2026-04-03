import { geminiAdapter, extractGeminiConversationIdFromUrl, extractGeminiPayloadsFromDocument } from "@aiexporter/adapters-gemini";
import type { DebugLogLevel } from "@aiexporter/adapter-sdk";
import { mountGoogleContentRuntime } from "../google/content-runtime";

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

async function expandGeminiHistoryBeforeDiscovery(document: Document): Promise<void> {
  const view = document.defaultView ?? window;
  const menuButton = document.querySelector<HTMLElement>('[data-test-id="side-nav-menu-button"]');
  const collapsedHistory = document.querySelector<HTMLElement>(".chat-history.collapsed");

  if (menuButton && collapsedHistory) {
    menuButton.click();
    await new Promise((resolve) => view.setTimeout(resolve, 1_200));
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

export async function mountGeminiContentRuntime(log: RuntimeLogger): Promise<void> {
  await mountGoogleContentRuntime(
    {
      platform: "gemini",
      siteName: "Gemini",
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
      historyReadyTimeoutMs: 4_000,
      historySweepMaxSteps: 40,
      historySweepSettleMs: 350,
      historySweepStableRounds: 2,
      prepareHistoryCollection: expandGeminiHistoryBeforeDiscovery,
      extractSourceId: extractGeminiConversationIdFromUrl,
      resolveTitle: (document) =>
        document.querySelector<HTMLElement>('[data-test-id="conversation-title"]')?.innerText.trim() ||
        document.querySelector<HTMLAnchorElement>('a[href*="/app/"][aria-current="page"]')?.innerText.trim() ||
        resolveGeminiPromptTitleFallback(document) ||
        document.title.replace(/\s*\|\s*Google Gemini\s*$/i, "").trim() ||
        undefined,
      collectHistoryPayloads: extractGeminiPayloadsFromDocument,
      extractCurrentConversation: () =>
        geminiAdapter.extractCurrentConversation({
          document,
          window,
          location,
        }),
    },
    log,
  );
}
