import { aiStudioAdapter, extractAiStudioPayloadsFromDocument, extractAiStudioPromptIdFromUrl } from "@aiexporter/adapters-gemini";
import type { DebugLogLevel } from "@aiexporter/adapter-sdk";
import { mountGoogleContentRuntime } from "../google/content-runtime";

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

export async function mountAiStudioContentRuntime(log: RuntimeLogger): Promise<void> {
  await mountGoogleContentRuntime(
    {
      platform: "aistudio",
      siteName: "Google AI Studio",
      historyOrigin: "https://aistudio.google.com",
      historyLinkSelector: 'a[href*="/prompts/"]',
      preferredHistoryContainerSelectors: [
        ".lib-table-wrapper",
        ".history-list-container",
        ".history-panel",
        '.view-all-history-link[href="/library"]',
      ],
      historyReadyLinkCount: 20,
      historyReadyTimeoutMs: 8_000,
      historySweepMaxSteps: 36,
      historySweepSettleMs: 350,
      historySweepStableRounds: 2,
      extractSourceId: extractAiStudioPromptIdFromUrl,
      resolveTitle: (document) =>
        document.title.replace(/\s*\|\s*Google AI Studio\s*$/i, "").trim() || undefined,
      collectHistoryPayloads: extractAiStudioPayloadsFromDocument,
      extractCurrentConversation: () =>
        aiStudioAdapter.extractCurrentConversation({
          document,
          window,
          location,
        }),
    },
    log,
  );
}
