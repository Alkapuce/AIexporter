import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import { normalizeConversationUrl, type ConversationBundle, type Participant } from "@aiexporter/core-schema";
import { collectConversationTurns, getChatTitle, turnToMarkdown } from "./dom";
import { extractConversationIdFromUrl } from "./discovery";

function buildParticipants(messages: ConversationBundle["messages"]): Participant[] {
  const seen = new Map<string, Participant>();
  messages.forEach((message) => {
    if (message.role === "user" && !seen.has("user")) {
      seen.set("user", { id: "user", role: "user", name: "User" });
    }
    if (message.role === "assistant" && !seen.has("assistant")) {
      seen.set("assistant", { id: "assistant", role: "assistant", name: "ChatGPT" });
    }
    if (message.role === "system" && !seen.has("system")) {
      seen.set("system", { id: "system", role: "system", name: "System" });
    }
  });
  if (seen.size === 0) {
    seen.set("assistant", { id: "assistant", role: "assistant", name: "ChatGPT" });
  }
  return Array.from(seen.values());
}

interface ChatGptApiMessageAuthor {
  role?: string;
  name?: string;
}

interface ChatGptApiMessageContent {
  parts?: unknown[];
  content_type?: string;
}

interface ChatGptApiMessage {
  id?: string;
  author?: ChatGptApiMessageAuthor;
  create_time?: string | number;
  content?: ChatGptApiMessageContent;
}

interface ChatGptApiMappingNode {
  id?: string;
  parent?: string | null;
  message?: ChatGptApiMessage | null;
}

interface ChatGptApiConversationResponse {
  id?: string;
  title?: string;
  current_node?: string;
  mapping?: Record<string, ChatGptApiMappingNode>;
  update_time?: string | number;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && /^\d+(\.\d+)?$/.test(value)) {
      return new Date(numeric * 1000).toISOString();
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

function normalizeContentPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";

  const candidate = part as Record<string, unknown>;
  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.content === "string") return candidate.content;
  if (typeof candidate.title === "string") return candidate.title;
  if (typeof candidate.url === "string") return candidate.url;
  return JSON.stringify(candidate);
}

function normalizeRole(role: unknown): "user" | "assistant" | "system" | null {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return null;
}

export function parseChatGptConversationResponse(
  payload: ChatGptApiConversationResponse,
  url: string,
  sourceId: string,
): ConversationBundle {
  const mapping = payload.mapping ?? {};
  const orderedNodeIds: string[] = [];
  const seen = new Set<string>();
  let currentNodeId = payload.current_node;

  while (currentNodeId && !seen.has(currentNodeId)) {
    seen.add(currentNodeId);
    orderedNodeIds.unshift(currentNodeId);
    currentNodeId = mapping[currentNodeId]?.parent ?? undefined;
  }

  const messages = orderedNodeIds
    .map((nodeId) => mapping[nodeId])
    .map((node) => {
      const message = node?.message;
      const role = normalizeRole(message?.author?.role);
      if (!message || !role) return null;

      const parts = Array.isArray(message.content?.parts) ? message.content.parts : [];
      const markdown = parts
        .map(normalizeContentPart)
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");

      if (!markdown) return null;

      return {
        id: message.id ?? node?.id ?? `chatgpt-${crypto.randomUUID()}`,
        role,
        markdown,
        createdAt: normalizeTimestamp(message.create_time),
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));

  if (messages.length === 0) {
    throw new Error("ChatGPT API returned no usable messages.");
  }

  return {
    platform: "chatgpt",
    sourceId,
    url,
    title: payload.title,
    extractedAt: new Date().toISOString(),
    sourceUpdatedAt: normalizeTimestamp(payload.update_time) ?? messages[messages.length - 1]?.createdAt,
    participants: buildParticipants(messages),
    messages,
    meta: {
      source: "api",
      rawNodeCount: Object.keys(mapping).length,
    },
  };
}

export const chatgptAdapter: PlatformAdapter = {
  platform: "chatgpt",
  matches(url) {
    return /^https:\/\/chatgpt\.com\//.test(url);
  },
  async extractCurrentConversation(ctx) {
    const normalizedUrl = normalizeConversationUrl(ctx.location.href);
    const sourceId = extractConversationIdFromUrl(normalizedUrl);
    if (!sourceId) {
      throw new Error("Current page is not a ChatGPT conversation URL.");
    }

    const turns = collectConversationTurns(ctx.document);
    const messages = turns
      .map(turnToMarkdown)
      .filter((message) => message.markdown.trim().length > 0)
      .map((message) => ({
        id: message.messageId,
        role: message.role,
        markdown: message.markdown,
        createdAt: message.createdAt,
      }));

    if (messages.length === 0) {
      throw new Error("No conversation messages were found in the DOM.");
    }

    const sourceUpdatedAt = messages[messages.length - 1]?.createdAt;

    return {
      platform: "chatgpt",
      sourceId,
      url: normalizedUrl,
      title: getChatTitle(ctx.document),
      extractedAt: new Date().toISOString(),
      sourceUpdatedAt,
      participants: buildParticipants(messages),
      messages,
      meta: {
        turnCount: turns.length,
      },
    };
  },
};
