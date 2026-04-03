import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import { extractAiStudioPromptIdFromUrl, extractGeminiConversationIdFromUrl } from "./discovery";
import {
  extractAiStudioConversationFromDom,
  extractGeminiConversationFromDom,
  hydrateScrollableConversation,
} from "./dom";

async function waitForGeminiConversationReady(
  document: Document,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {},
): Promise<void> {
  const view = document.defaultView ?? window;
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const userNodes = document.querySelectorAll(".query-text.gds-body-l").length;
    const assistantNodes = document.querySelectorAll("structured-content-container").length;
    const ready = userNodes + assistantNodes > 0;
    if (ready) {
      return;
    }
    await new Promise((resolve) => view.setTimeout(resolve, delayMs));
  }
}

export const geminiAdapter: PlatformAdapter = {
  platform: "gemini",
  matches(url) {
    return /^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(url);
  },
  async extractCurrentConversation(ctx) {
    const sourceId = extractGeminiConversationIdFromUrl(ctx.location.href);
    if (!sourceId) {
      throw new Error("Current page is not a Gemini conversation URL.");
    }

    await waitForGeminiConversationReady(ctx.document, {
      attempts: 6,
      delayMs: 500,
    });

    await hydrateScrollableConversation(ctx.document, {
      stepRatio: 0.9,
      settleMs: 600,
      maxSteps: 50,
    });

    await waitForGeminiConversationReady(ctx.document, {
      attempts: 8,
      delayMs: 500,
    });

    return extractGeminiConversationFromDom(ctx.document, ctx.location.href, sourceId);
  },
};

export const aiStudioAdapter: PlatformAdapter = {
  platform: "aistudio",
  matches(url) {
    return /^https:\/\/aistudio\.google\.com\/prompts\/(?!new_chat)([^/?#]+)/.test(url);
  },
  async extractCurrentConversation(ctx) {
    const sourceId = extractAiStudioPromptIdFromUrl(ctx.location.href);
    if (!sourceId) {
      throw new Error("Current page is not an AI Studio prompt URL.");
    }

    await hydrateScrollableConversation(ctx.document, {
      stepRatio: 0.85,
      settleMs: 500,
      maxSteps: 24,
    });

    return extractAiStudioConversationFromDom(ctx.document, ctx.location.href, sourceId);
  },
};
