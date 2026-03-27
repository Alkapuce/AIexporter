import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import type { ConversationBundle, Participant } from "@aiexporter/core-schema";
import { extractConversationFromDom } from "./dom";
import { extractSessionIdFromUrl } from "./discovery";
import type { DeepSeekHistoryResponse, DeepSeekMessage } from "./types";

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
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && /^\d+(\.\d+)?$/.test(value)) {
      return new Date(numeric * 1000).toISOString();
    }
    return value;
  }
  return undefined;
}

function formatThinkingFragment(content: string): string {
  return `> [thinking]\n> ${content.replace(/\n/g, "\n> ")}`;
}

function extractMessageMarkdown(message: DeepSeekMessage): string | undefined {
  const direct = message.content?.trim();
  if (direct) return direct;

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
  return fragmentBlocks.join("\n\n");
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
    const sourceId = extractSessionIdFromUrl(ctx.location.href);
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
      url: ctx.location.href,
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
