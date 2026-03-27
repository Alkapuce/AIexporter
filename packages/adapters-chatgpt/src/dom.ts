import { createMarkdownConverter } from "./turndown";

function sanitizeClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, script, style, textarea").forEach((node) => node.remove());
  clone.querySelectorAll("[data-testid='copy-turn-action-button']").forEach((node) => node.remove());
  return clone;
}

export function getChatTitle(document: Document): string | undefined {
  const heading = document.querySelector("main h1")?.textContent?.trim();
  if (heading) return heading;
  const title = document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  return title || undefined;
}

export function collectConversationTurns(document: Document): HTMLElement[] {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-'], [data-message-author-role]"),
  );
  const unique = new Map<string, HTMLElement>();

  nodes.forEach((node, index) => {
    const container = node.matches("[data-testid^='conversation-turn-']")
      ? node
      : (node.closest("[data-testid^='conversation-turn-']") as HTMLElement | null) ?? node;
    const key = (container.dataset.testid ?? container.id) || `turn-${index}`;
    if (!unique.has(key)) unique.set(key, container);
  });

  return Array.from(unique.values());
}

export function turnToMarkdown(turn: HTMLElement): {
  role: string;
  markdown: string;
  messageId: string;
  createdAt?: string;
} {
  const roleElement = turn.querySelector<HTMLElement>("[data-message-author-role]") ?? turn;
  const role = roleElement.dataset.messageAuthorRole ?? "assistant";
  const contentRoot =
    roleElement.querySelector<HTMLElement>(".markdown, [class*='markdown'], .whitespace-pre-wrap") ??
    roleElement;

  const converter = createMarkdownConverter();
  const markdown = converter.turndown(sanitizeClone(contentRoot)).trim() || contentRoot.textContent?.trim() || "";
  const messageId =
    roleElement.id ||
    turn.dataset.messageId ||
    turn.dataset.testid ||
    `message-${Math.abs(markdown.length)}`;
  const createdAt = turn.querySelector("time")?.getAttribute("datetime") ?? undefined;

  return {
    role,
    markdown,
    messageId,
    createdAt,
  };
}
