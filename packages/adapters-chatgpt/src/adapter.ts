import type { PlatformAdapter } from "@aiexporter/adapter-sdk";
import type { ConversationBundle, Participant } from "@aiexporter/core-schema";
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

export const chatgptAdapter: PlatformAdapter = {
  platform: "chatgpt",
  matches(url) {
    return /^https:\/\/chatgpt\.com\//.test(url);
  },
  async extractCurrentConversation(ctx) {
    const sourceId = extractConversationIdFromUrl(ctx.location.href);
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
      url: ctx.location.href,
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

