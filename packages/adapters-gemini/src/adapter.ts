import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import { normalizeConversationUrl, type ConversationBundle, type Participant } from "@aiexporter/core-schema";
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

function buildParticipants(messages: ConversationBundle["messages"], assistantName: string): Participant[] {
  const participants = new Map<string, Participant>();
  messages.forEach((message) => {
    if (message.role === "user" && !participants.has("user")) {
      participants.set("user", { id: "user", role: "user", name: "User" });
    }
    if (message.role === "assistant" && !participants.has("assistant")) {
      participants.set("assistant", { id: "assistant", role: "assistant", name: assistantName });
    }
  });
  if (participants.size === 0) {
    participants.set("assistant", { id: "assistant", role: "assistant", name: assistantName });
  }
  return Array.from(participants.values());
}

function normalizeGeminiTimestamp(seconds: unknown, nanos: unknown): string | undefined {
  const secondsValue = typeof seconds === "number" ? seconds : Number(seconds);
  const nanosValue = typeof nanos === "number" ? nanos : Number(nanos ?? 0);
  if (!Number.isFinite(secondsValue)) return undefined;
  const millis = secondsValue * 1_000 + Math.floor((Number.isFinite(nanosValue) ? nanosValue : 0) / 1_000_000);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatThinkingBlock(thinking: string | undefined): string {
  const normalized = thinking?.trim();
  if (!normalized) return "";
  return `> [thinking]\n> ${normalized.replace(/\n/g, "\n> ")}`.trim();
}

function replaceGeminiMiniAppBlocks(markdown: string, conversationUrl: string): string {
  return markdown.replace(
    /```(?:json)?\s*[\s\S]*?"id"\s*:\s*"(im_[a-z0-9]+)"[\s\S]*?```/gi,
    (_match, miniAppId: string) =>
      `> [interactive] [Open Gemini visualization demo (${miniAppId})](${conversationUrl})`,
  );
}

function extractGeminiResponseText(responseEntry: unknown, conversationUrl: string): string | undefined {
  if (!Array.isArray(responseEntry)) return undefined;
  const plain = Array.isArray(responseEntry[1]) ? responseEntry[1][0] : undefined;
  if (typeof plain !== "string" || !plain.trim()) return undefined;
  return replaceGeminiMiniAppBlocks(plain.trim(), conversationUrl);
}

function extractGeminiThinkingText(responseEntry: unknown): string | undefined {
  if (!Array.isArray(responseEntry)) return undefined;
  const thinkingEntries = Array.isArray(responseEntry[37]) ? responseEntry[37] : [];
  const blocks = thinkingEntries
    .map((entry) => {
      if (!Array.isArray(entry)) return undefined;
      if (typeof entry[0] === "string") return entry[0];
      if (Array.isArray(entry[0]) && typeof entry[0][0] === "string") return entry[0][0];
      return undefined;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}

interface GeminiRpcImageAttachment {
  filename?: string;
  url: string;
  mimeType?: string;
}

interface GeminiRpcLinkedAttachment {
  title?: string;
  url: string;
  mimeType?: string;
}

function getGeminiAttachmentKey(attachment: GeminiRpcImageAttachment | GeminiRpcLinkedAttachment): string {
  const title = (attachment as GeminiRpcImageAttachment).filename ?? (attachment as GeminiRpcLinkedAttachment).title ?? "";
  return `${title.trim()}::${attachment.url.trim()}`;
}

function getGeminiTurnTimestampValue(entry: unknown): number | undefined {
  if (!Array.isArray(entry) || !Array.isArray(entry[4])) return undefined;
  const secondsValue = typeof entry[4][0] === "number" ? entry[4][0] : Number(entry[4][0]);
  const nanosValue = typeof entry[4][1] === "number" ? entry[4][1] : Number(entry[4][1] ?? 0);
  if (!Number.isFinite(secondsValue)) return undefined;
  return secondsValue * 1_000 + Math.floor((Number.isFinite(nanosValue) ? nanosValue : 0) / 1_000_000);
}

function filterInheritedGeminiAttachments<T extends GeminiRpcImageAttachment | GeminiRpcLinkedAttachment>(
  attachments: T[],
  previousAttachments: T[],
): T[] {
  if (attachments.length === 0 || previousAttachments.length === 0) {
    return attachments;
  }

  const currentKeys = new Set(attachments.map((attachment) => getGeminiAttachmentKey(attachment)));
  const previousKeys = new Set(previousAttachments.map((attachment) => getGeminiAttachmentKey(attachment)));
  const previousIsSubset = Array.from(previousKeys).every((key) => currentKeys.has(key));
  if (!previousIsSubset) {
    return attachments;
  }

  const filtered = attachments.filter((attachment) => !previousKeys.has(getGeminiAttachmentKey(attachment)));
  return filtered.length > 0 ? filtered : [];
}

function isGeminiImageAttachmentCandidate(value: unknown[]): boolean {
  return value.some((item) => typeof item === "string" && /^https:\/\/lh3\.googleusercontent\.com\/gg\//.test(item));
}

function collectGeminiImageAttachments(root: unknown, collector: GeminiRpcImageAttachment[]): void {
  if (!Array.isArray(root)) return;

  if (isGeminiImageAttachmentCandidate(root)) {
    const url = root.find((item): item is string => typeof item === "string" && /^https:\/\/lh3\.googleusercontent\.com\/gg\//.test(item));
    if (url) {
      const filename = root.find((item): item is string => typeof item === "string" && /\.(png|jpe?g|webp|gif|bmp)$/i.test(item));
      const mimeType = root.find((item): item is string => typeof item === "string" && /^image\//i.test(item));
      collector.push({ url, filename, mimeType });
      return;
    }
  }

  root.forEach((child) => collectGeminiImageAttachments(child, collector));
}

function extractGeminiImageAttachments(entry: unknown): GeminiRpcImageAttachment[] {
  const collected: GeminiRpcImageAttachment[] = [];
  collectGeminiImageAttachments(entry, collected);
  const deduped = new Map<string, GeminiRpcImageAttachment>();
  collected.forEach((attachment) => {
    const key = `${attachment.filename ?? ""}::${attachment.url.trim()}`;
    deduped.set(key, attachment);
  });
  return Array.from(deduped.values());
}

function isGeminiDocumentAttachmentCandidate(value: unknown[]): boolean {
  const hasRemoteUrl = value.some((item) => typeof item === "string" && /^https?:\/\//i.test(item));
  const hasDocumentHint = value.some(
    (item) =>
      typeof item === "string" &&
      (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|tsv|md)$/i.test(item) || /^(application|text)\//i.test(item)),
  );
  return hasRemoteUrl && hasDocumentHint;
}

function collectGeminiDocumentAttachments(root: unknown, collector: GeminiRpcLinkedAttachment[]): void {
  if (!Array.isArray(root)) return;

  if (isGeminiDocumentAttachmentCandidate(root)) {
    const url = root.find((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item));
    if (url) {
      const title = root.find((item): item is string => typeof item === "string" && /\.(pdf|docx?|xlsx?|pptx?|txt|csv|tsv|md)$/i.test(item));
      const mimeType = root.find((item): item is string => typeof item === "string" && /^(application|text)\//i.test(item));
      collector.push({ url, title, mimeType });
      return;
    }
  }

  root.forEach((child) => collectGeminiDocumentAttachments(child, collector));
}

function extractGeminiDocumentAttachments(entry: unknown): GeminiRpcLinkedAttachment[] {
  const collected: GeminiRpcLinkedAttachment[] = [];
  collectGeminiDocumentAttachments(entry, collected);
  const deduped = new Map<string, GeminiRpcLinkedAttachment>();
  collected.forEach((attachment) => {
    deduped.set(`${attachment.title ?? ""}::${attachment.url}`, attachment);
  });
  return Array.from(deduped.values()).filter((attachment) => !/^https:\/\/lh3\.googleusercontent\.com\/gg\//.test(attachment.url));
}

function buildGeminiImageMarkdown(attachments: GeminiRpcImageAttachment[]): string[] {
  return attachments.map((attachment, index) => {
    const alt = attachment.filename?.trim() || `image-${index + 1}`;
    return `![${alt}](${attachment.url})`;
  });
}

function buildGeminiAttachmentMarkdown(attachments: GeminiRpcLinkedAttachment[]): string[] {
  return attachments.map((attachment, index) => {
    const title = attachment.title?.trim() || attachment.url.split("/").pop() || `attachment-${index + 1}`;
    return `> [attachment] [${title}](${attachment.url})`;
  });
}

function extractHnvQHbPayload(responseText: string): string {
  // batchexecute format: )]}'\n\n<size>\n<json>\n<size>\n<json>\n...
  // Strip the leading security prefix and split into chunks by the size-prefixed lines.
  const stripped = responseText.replace(/^\)\]\}'\n/, "");
  const chunks = stripped.split(/\n\d+\n/).filter(Boolean);
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk) as unknown;
      if (Array.isArray(parsed) && Array.isArray(parsed[0]) && parsed[0][1] === "hNvQHb" && typeof parsed[0][2] === "string") {
        return parsed[0][2];
      }
    } catch {
      // not valid JSON, skip
    }
  }
  // Fallback: try the first chunk (original behavior)
  const firstChunk = stripped.replace(/^\d+\n/, "").split("\n")[0] ?? "[]";
  const outer = JSON.parse(firstChunk) as unknown;
  if (Array.isArray(outer) && Array.isArray(outer[0]) && typeof outer[0][2] === "string") {
    return outer[0][2];
  }
  throw new Error("Gemini hNvQHb response did not contain a parsable payload.");
}

export function parseGeminiConversationFromHnvQHbResponse(
  responseText: string,
  url: string,
  sourceId: string,
  title?: string,
): ConversationBundle {
  let innerPayload: string;
  try {
    innerPayload = extractHnvQHbPayload(responseText);
  } catch {
    throw new Error("Gemini hNvQHb response did not contain a parsable payload.");
  }

  const inner = JSON.parse(innerPayload) as unknown;
  const turnEntries = Array.isArray(inner) && Array.isArray(inner[0]) ? inner[0] : [];
  const orderedTurnEntries = turnEntries
    .map((entry, index) => ({
      entry,
      index,
      timestamp: getGeminiTurnTimestampValue(entry),
    }))
    .sort((left, right) => {
      if (left.timestamp === undefined && right.timestamp === undefined) return left.index - right.index;
      if (left.timestamp === undefined) return -1;
      if (right.timestamp === undefined) return 1;
      if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
      return left.index - right.index;
    })
    .map((item) => item.entry);
  const messages: ConversationBundle["messages"] = [];
  let previousPromptImageAttachments: GeminiRpcImageAttachment[] = [];
  let previousPromptDocumentAttachments: GeminiRpcLinkedAttachment[] = [];

  orderedTurnEntries.forEach((entry, index) => {
    if (!Array.isArray(entry)) return;
    const turnTimestamp = Array.isArray(entry[4]) ? normalizeGeminiTimestamp(entry[4][0], entry[4][1]) : undefined;
    const promptImageAttachments = extractGeminiImageAttachments(entry[2]);
    const promptDocumentAttachments = extractGeminiDocumentAttachments(entry[2]);
    const effectivePromptImageAttachments = filterInheritedGeminiAttachments(
      promptImageAttachments,
      previousPromptImageAttachments,
    );
    const effectivePromptDocumentAttachments = filterInheritedGeminiAttachments(
      promptDocumentAttachments,
      previousPromptDocumentAttachments,
    );
    previousPromptImageAttachments = promptImageAttachments;
    previousPromptDocumentAttachments = promptDocumentAttachments;
    const prompt = Array.isArray(entry[2]) && Array.isArray(entry[2][0]) && typeof entry[2][0][0] === "string"
      ? entry[2][0][0].trim()
      : "";
    const userParts = [
      ...buildGeminiImageMarkdown(effectivePromptImageAttachments),
      ...buildGeminiAttachmentMarkdown(effectivePromptDocumentAttachments),
      prompt,
    ].filter(Boolean);
    if (userParts.length > 0) {
      messages.push({
        id: `user-${index + 1}`,
        role: "user",
        markdown: userParts.join("\n\n"),
        createdAt: turnTimestamp,
      });
    }

    const responseEntry = Array.isArray(entry[3]) && Array.isArray(entry[3][0]) ? entry[3][0][0] : undefined;
    const responseTextValue = extractGeminiResponseText(responseEntry, url);
    const thinkingText = extractGeminiThinkingText(responseEntry);
    const assistantParts = [formatThinkingBlock(thinkingText), responseTextValue].filter(Boolean);
    if (assistantParts.length > 0) {
      const responseId =
        Array.isArray(responseEntry) && typeof responseEntry[0] === "string" ? responseEntry[0] : `assistant-${index + 1}`;
      messages.push({
        id: responseId,
        role: "assistant",
        markdown: assistantParts.join("\n\n"),
        createdAt: turnTimestamp,
      });
    }
  });

  if (messages.length === 0) {
    throw new Error("Gemini hNvQHb response returned no usable messages.");
  }

  const sourceUpdatedAt = [...messages].reverse().find((message) => message.role === "assistant" && message.createdAt)?.createdAt;

  return {
    platform: "gemini",
    sourceId,
    url,
    title,
    extractedAt: new Date().toISOString(),
    sourceUpdatedAt,
    participants: buildParticipants(messages, "Gemini"),
    messages,
    meta: {
      sourceHost: "gemini.google.com",
      source: "page-world-rpc",
      turnCount: messages.length,
    },
  };
}

export const geminiAdapter: PlatformAdapter = {
  platform: "gemini",
  matches(url) {
    return /^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(url);
  },
  async extractCurrentConversation(ctx) {
    const normalizedUrl = normalizeConversationUrl(ctx.location.href);
    const sourceId = extractGeminiConversationIdFromUrl(normalizedUrl);
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

    return extractGeminiConversationFromDom(ctx.document, normalizedUrl, sourceId);
  },
};

export const aiStudioAdapter: PlatformAdapter = {
  platform: "aistudio",
  matches(url) {
    return /^https:\/\/aistudio\.google\.com\/prompts\/(?!new_chat)([^/?#]+)/.test(url);
  },
  async extractCurrentConversation(ctx) {
    const normalizedUrl = normalizeConversationUrl(ctx.location.href);
    const sourceId = extractAiStudioPromptIdFromUrl(normalizedUrl);
    if (!sourceId) {
      throw new Error("Current page is not an AI Studio prompt URL.");
    }

    await hydrateScrollableConversation(ctx.document, {
      stepRatio: 0.85,
      settleMs: 500,
      maxSteps: 24,
    });

    return extractAiStudioConversationFromDom(ctx.document, normalizedUrl, sourceId);
  },
};
