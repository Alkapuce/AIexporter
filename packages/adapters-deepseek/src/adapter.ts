import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import { normalizeConversationUrl, type ConversationBundle, type Participant } from "@aiexporter/core-schema";
import { extractConversationFromDom } from "./dom";
import { extractSessionIdFromUrl } from "./discovery";
import type { DeepSeekFileAttachment, DeepSeekHistoryResponse, DeepSeekMessage } from "./types";

function buildParticipants(messages: ConversationBundle["messages"]): Participant[] {
  const seen = new Map<string, Participant>();
  messages.forEach((message) => {
    if (message.role === "user" && !seen.has("user")) {
      seen.set("user", { id: "user", role: "user", name: "User" });
    }
    if (message.role === "assistant" && !seen.has("assistant")) {
      seen.set("assistant", { id: "assistant", role: "assistant", name: "DeepSeek" });
    }
    if (message.role === "system" && !seen.has("system")) {
      seen.set("system", { id: "system", role: "system", name: "System" });
    }
  });
  if (seen.size === 0) {
    seen.set("assistant", { id: "assistant", role: "assistant", name: "DeepSeek" });
  }
  return Array.from(seen.values());
}

function normalizeRole(role: string): "user" | "assistant" | null {
  const lower = role.toLowerCase();
  if (lower === "user") return "user";
  if (lower === "assistant") return "assistant";
  return null;
}

function messageIdOf(message: DeepSeekMessage, index: number): string {
  if (typeof message.message_id === "number") return String(message.message_id);
  if (typeof message.message_id === "string" && message.message_id) return message.message_id;
  return `deepseek-message-${index}`;
}

function normalizeTimestamp(value: string | number | undefined): string | undefined {
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && /^\d+(\.\d+)?$/.test(value)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      return new Date(ms).toISOString();
    }
    return value;
  }
  return undefined;
}

function formatThinkingFragment(content: string): string {
  return `> [thinking]\n> ${content.replace(/\n/g, "\n> ")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function buildFileAttachmentBlocks(files: DeepSeekFileAttachment[]): string[] {
  return files
    .filter((f) => f.file_name && f.status !== "FAILED" && f.error_code == null)
    .map((f) => {
      const sizePart = typeof f.file_size === "number" ? ` (${formatFileSize(f.file_size)})` : "";
      if (f.download_url) {
        return `> [attachment] [${f.file_name}](${f.download_url})`;
      }
      return `> [attachment] ${f.file_name}${sizePart}`;
    });
}

function collectRemoteAttachments(markdown: string): { images: string[]; documents: string[] } {
  const urlMatches = markdown.match(/https?:\/\/[^\s)]+/g) ?? [];
  const images: string[] = [];
  const documents: string[] = [];
  urlMatches.forEach((url) => {
    if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(url)) {
      images.push(url);
      return;
    }
    if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|tsv|md)(\?|#|$)/i.test(url)) {
      documents.push(url);
    }
  });
  return {
    images: Array.from(new Set(images)),
    documents: Array.from(new Set(documents)),
  };
}

function appendAttachmentBlocks(markdown: string): string {
  const attachments = collectRemoteAttachments(markdown);
  const imageBlocks = attachments.images.map((url) => {
    const title = url.split("/").pop()?.split("?")[0] || "image";
    return `![${title}](${url})`;
  });
  const documentBlocks = attachments.documents.map((url) => {
    const title = url.split("/").pop()?.split("?")[0] || "attachment";
    return `> [attachment] [${title}](${url})`;
  });
  const appended = [...imageBlocks, ...documentBlocks].filter(Boolean);
  if (appended.length === 0) return markdown;
  return `${markdown}\n\n${appended.join("\n\n")}`.trim();
}

function extractMessageMarkdown(message: DeepSeekMessage): string | undefined {
  const fileBlocks = buildFileAttachmentBlocks(message.files ?? []);

  const direct = message.content?.trim();
  const textMarkdown = direct ? appendAttachmentBlocks(direct) : (() => {
    const fragmentBlocks =
      message.fragments
        ?.map((fragment) => {
          const content = fragment.content?.trim();
          if (!content) return null;
          return fragment.type === "THINK" ? formatThinkingFragment(content) : content;
        })
        .filter((block): block is string => Boolean(block)) ?? [];

    if (message.thinking_content?.trim()) {
      fragmentBlocks.unshift(formatThinkingFragment(message.thinking_content.trim()));
    }

    if (fragmentBlocks.length === 0) return undefined;
    return appendAttachmentBlocks(fragmentBlocks.join("\n\n"));
  })();

  if (!textMarkdown && fileBlocks.length === 0) return undefined;
  return [...fileBlocks, ...(textMarkdown ? [textMarkdown] : [])].join("\n\n");
}

export function parseHistoryResponse(
  data: DeepSeekHistoryResponse,
  url: string,
  sourceId: string,
): ConversationBundle {
  const messages = data.data?.biz_data?.chat_messages ?? [];
  const sorted = [...messages].sort((left, right) => {
    const leftValue = typeof left.message_id === "number" ? left.message_id : Number(left.message_id ?? 0);
    const rightValue = typeof right.message_id === "number" ? right.message_id : Number(right.message_id ?? 0);
    return leftValue - rightValue;
  });

  const normalized = sorted
    .map((message, index) => {
      const role = normalizeRole(message.role);
      if (!role) return null;
      const markdown = extractMessageMarkdown(message);
      if (!markdown) return null;
      return {
        id: messageIdOf(message, index),
        role,
        markdown,
        createdAt: normalizeTimestamp(message.inserted_at),
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));

  if (normalized.length === 0) {
    throw new Error("DeepSeek API returned no usable messages.");
  }

  return {
    platform: "deepseek",
    sourceId,
    url,
    title: data.data?.biz_data?.chat_session?.title,
    extractedAt: new Date().toISOString(),
    sourceUpdatedAt: normalized[normalized.length - 1]?.createdAt,
    participants: buildParticipants(normalized),
    messages: normalized,
    meta: {
      source: "api",
      rawMessageCount: sorted.length,
    },
  };
}

export const deepseekAdapter: PlatformAdapter = {
  platform: "deepseek",
  matches(url) {
    return /^https:\/\/chat\.deepseek\.com\//i.test(url);
  },
  async extractCurrentConversation(ctx) {
    const normalizedUrl = normalizeConversationUrl(ctx.location.href);
    const sourceId = extractSessionIdFromUrl(normalizedUrl);
    if (!sourceId) {
      throw new Error("Current page is not a DeepSeek conversation URL.");
    }

    const domFallback = extractConversationFromDom(ctx.document);
    if (domFallback.messages.length === 0) {
      throw new Error("Unable to export the DeepSeek conversation from DOM.");
    }

    return {
      platform: "deepseek",
      sourceId,
      url: normalizedUrl,
      title: domFallback.title,
      extractedAt: new Date().toISOString(),
      sourceUpdatedAt: domFallback.messages[domFallback.messages.length - 1]?.createdAt,
      participants: buildParticipants(domFallback.messages),
      messages: domFallback.messages,
      meta: {
        source: "dom-fallback",
      },
    };
  },
};
