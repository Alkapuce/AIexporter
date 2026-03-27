import { createMarkdownConverter } from "./turndown";

function sanitizeClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, script, style, textarea").forEach((node) => node.remove());
  return clone;
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
  const heading = document.querySelector("main h1")?.textContent?.trim();
  if (heading) return heading;
  const title = document.title.replace(/\s*\|\s*DeepSeek\s*$/i, "").trim();
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
        node.querySelector<HTMLElement>(".ds-markdown, .markdown, [class*='markdown'], [class*='message-content']") ?? node;
      const markdown = converter.turndown(sanitizeClone(contentRoot)).trim() || contentRoot.textContent?.trim() || "";
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
