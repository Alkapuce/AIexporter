import { normalizeConversationTitle } from "@aiexporter/core-schema";
import { sanitizeClone } from "@aiexporter/adapter-sdk";
import { createMarkdownConverter } from "./turndown";

function collectAttachmentCards(node: HTMLElement): Array<{ name: string; meta?: string }> {
  const cards: Array<{ name: string; meta?: string }> = [];
  const seen = new Set<string>();
  node.querySelectorAll<HTMLElement>("div, button, [role='button']").forEach((candidate) => {
    const name =
      candidate.querySelector<HTMLElement>(".f3a54b52")?.textContent?.trim() ??
      candidate.querySelector<HTMLElement>("[class*='title']")?.textContent?.trim();
    const meta =
      candidate
        .querySelector<HTMLElement>("._5119742, .dc832104, [class*='meta'], [class*='size']")
        ?.textContent?.trim() ?? undefined;
    if (!name || name.length > 260) return;
    if (!/\.(pdf|png|jpe?g|gif|webp|bmp|svg|docx?|pptx?|xlsx?|csv|tsv|md|txt)$/i.test(name)) return;
    const key = `${name}::${meta ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ name, meta });
  });
  return cards;
}

function buildAttachmentMarkdown(cards: Array<{ name: string; meta?: string }>): string[] {
  return cards.map((card) => `> [attachment] ${card.name}${card.meta ? ` (${card.meta})` : ""}`);
}

function inferRole(node: HTMLElement): "user" | "assistant" {
  const explicitRole =
    node.dataset.role ??
    node.getAttribute("data-message-role") ??
    node.getAttribute("data-author-role") ??
    node.querySelector<HTMLElement>("[data-role], [data-message-role], [data-author-role]")?.dataset.role;

  if (explicitRole) {
    const lower = explicitRole.toLowerCase();
    if (lower.includes("user") || lower.includes("human")) return "user";
    if (lower.includes("assistant") || lower.includes("bot")) return "assistant";
  }

  const text = [node.className, node.getAttribute("data-testid") ?? "", node.textContent ?? ""].join(" ").toLowerCase();
  if (text.includes("deepseek")) return "assistant";
  return "assistant";
}

function collectMessageContainers(document: Document): HTMLElement[] {
  const selectors = [
    "main [data-role]",
    "main [data-message-role]",
    "main [data-author-role]",
    "main article",
    "main [class*='message']",
    "main [class*='chat-message']",
  ];

  const seen = new Set<HTMLElement>();
  const nodes: HTMLElement[] = [];
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      nodes.push(node);
    });
  }
  return nodes;
}

export function getChatTitle(document: Document): string | undefined {
  const heading = normalizeConversationTitle(document.querySelector("main h1")?.textContent?.trim());
  if (heading) return heading;
  const title = normalizeConversationTitle(document.title.replace(/\s*\|\s*DeepSeek\s*$/i, "").trim());
  return title || undefined;
}

export function extractConversationFromDom(document: Document): {
  title?: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    markdown: string;
    createdAt?: string;
  }>;
} {
  const converter = createMarkdownConverter();
  const messages = collectMessageContainers(document)
    .map((node, index) => {
      const contentRoot =
        node.querySelector<HTMLElement>(".ds-markdown, .markdown, [class*='markdown'], [class*='message-content']") ??
        node;
      const attachmentBlocks = buildAttachmentMarkdown(collectAttachmentCards(node));
      const textMarkdown =
        converter.turndown(sanitizeClone(contentRoot)).trim() || contentRoot.textContent?.trim() || "";
      const markdown = [...attachmentBlocks, textMarkdown].filter(Boolean).join("\n\n");
      return {
        id: node.id || node.getAttribute("data-id") || node.getAttribute("data-testid") || `deepseek-message-${index}`,
        role: inferRole(node),
        markdown,
        createdAt: node.querySelector("time")?.getAttribute("datetime") ?? undefined,
      };
    })
    .filter((message) => message.markdown.length > 0);

  return {
    title: getChatTitle(document),
    messages,
  };
}
