import type { ConversationBundle, Message } from "@aiexporter/core-schema";
import { createMarkdownConverter } from "./turndown";

function getView(document: Document): Window {
  return document.defaultView ?? window;
}

function sanitizeClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, script, style, textarea").forEach((node) => node.remove());
  return clone;
}

function getElementText(element: Element | null | undefined): string {
  if (!element) return "";
  const htmlElement = element as HTMLElement;
  return htmlElement.innerText?.trim() || element.textContent?.trim() || "";
}

function sanitizeAiStudioClone(element: HTMLElement): HTMLElement {
  const clone = sanitizeClone(element);
  clone
    .querySelectorAll(
      [
        ".actions-container",
        ".author-label",
        ".timestamp",
        ".thought-collapsed-text-container",
        "mat-expansion-panel-header",
        "ms-chat-turn-options",
        ".material-symbols-outlined",
      ].join(", "),
    )
    .forEach((node) => node.remove());
  return clone;
}

function turndownNode(element: HTMLElement): string {
  const converter = createMarkdownConverter();
  return converter.turndown(sanitizeClone(element)).trim() || getElementText(element);
}

function turndownAiStudioNode(element: HTMLElement): string {
  const converter = createMarkdownConverter();
  return converter.turndown(sanitizeAiStudioClone(element)).trim() || getElementText(element);
}

function findPrimaryScrollContainer(document: Document): HTMLElement | null {
  const view = getView(document);
  const candidates = [
    document.querySelector<HTMLElement>("main"),
    ...Array.from(document.querySelectorAll<HTMLElement>("main *")),
    document.querySelector<HTMLElement>(".chat-session-content"),
    ...Array.from(document.querySelectorAll<HTMLElement>(".chat-session-content *")),
  ].filter(Boolean) as HTMLElement[];

  for (const candidate of candidates) {
    const style = view.getComputedStyle(candidate);
    if (
      candidate.scrollHeight > candidate.clientHeight + 200 &&
      (style.overflowY === "auto" || style.overflowY === "scroll")
    ) {
      return candidate;
    }
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export async function hydrateScrollableConversation(
  document: Document,
  options: {
    stepRatio?: number;
    settleMs?: number;
    maxSteps?: number;
  } = {},
): Promise<void> {
  const container = findPrimaryScrollContainer(document);
  if (!container) return;
  const view = getView(document);

  const stepRatio = options.stepRatio ?? 0.9;
  const settleMs = options.settleMs ?? 500;
  const maxSteps = options.maxSteps ?? 40;

  const original = container.scrollTop;
  container.scrollTop = container.scrollHeight;
  await new Promise((resolve) => view.setTimeout(resolve, settleMs));

  for (let step = 0; step < maxSteps; step += 1) {
    const nextTop = Math.max(0, container.scrollTop - container.clientHeight * stepRatio);
    if (nextTop === container.scrollTop) break;
    container.scrollTop = nextTop;
    await new Promise((resolve) => view.setTimeout(resolve, settleMs));
    if (container.scrollTop <= 4) break;
  }

  container.scrollTop = original;
}

function buildParticipants(messages: ConversationBundle["messages"], assistantName: string) {
  const participants = new Map<string, ConversationBundle["participants"][number]>();
  messages.forEach((message) => {
    if (message.role === "user" && !participants.has("user")) {
      participants.set("user", { id: "user", role: "user", name: "User" });
    }
    if (message.role === "assistant" && !participants.has("assistant")) {
      participants.set("assistant", { id: "assistant", role: "assistant", name: assistantName });
    }
    if (message.role === "system" && !participants.has("system")) {
      participants.set("system", { id: "system", role: "system", name: "System" });
    }
  });
  if (participants.size === 0) {
    participants.set("assistant", { id: "assistant", role: "assistant", name: assistantName });
  }
  return Array.from(participants.values());
}

function sortByDomOrder(nodes: HTMLElement[]): HTMLElement[] {
  const nodeCtor = nodes[0]?.ownerDocument.defaultView?.Node ?? Node;
  return [...nodes].sort((left, right) => {
    const relation = left.compareDocumentPosition(right);
    if (relation & nodeCtor.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & nodeCtor.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function extractGeminiPromptTitleFallback(document: Document): string | undefined {
  const lines = getElementText(document.querySelector<HTMLElement>(".query-text.gds-body-l"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(你说|you said)$/i.test(line));
  return lines[0]?.slice(0, 80);
}

function getGeminiTitle(document: Document): string | undefined {
  return (
    getElementText(document.querySelector<HTMLElement>('[data-test-id="conversation-title"]')) ||
    getElementText(document.querySelector<HTMLAnchorElement>('a[href*="/app/"][aria-current="page"]')) ||
    extractGeminiPromptTitleFallback(document) ||
    document.title.replace(/\s*\|\s*Google Gemini\s*$/i, "").trim() ||
    undefined
  );
}

export function extractGeminiConversationFromDom(document: Document, url: string, sourceId: string): ConversationBundle {
  const userNodes = Array.from(document.querySelectorAll<HTMLElement>(".query-text.gds-body-l"));
  const assistantNodes = Array.from(document.querySelectorAll<HTMLElement>("structured-content-container"));
  const orderedNodes = sortByDomOrder([...userNodes, ...assistantNodes]);

  const messages: Message[] = orderedNodes
    .map((node, index) => {
      const isUser = node.matches(".query-text.gds-body-l");
      const role = isUser ? "user" : "assistant";
      const contentRoot = isUser
        ? node
        : node.querySelector<HTMLElement>(".markdown, .markdown-main-panel, message-content") ?? node;
      let markdown = turndownNode(contentRoot);

      if (!isUser) {
        const thoughts = node.closest(".response-content")?.querySelector<HTMLElement>("[data-test-id='model-thoughts']");
        const thoughtsLabel = getElementText(
          thoughts?.querySelector<HTMLElement>(".thoughts-header-button-label, .thoughts-content"),
        );
        if (thoughtsLabel && !markdown.includes(thoughtsLabel)) {
          markdown = `> [thinking] ${thoughtsLabel}\n\n${markdown}`.trim();
        }
      }

      return {
        id: node.id || node.getAttribute("data-test-id") || `${role}-${index + 1}`,
        role,
        markdown,
      };
    })
    .filter((message) => message.markdown.trim().length > 0);

  if (messages.length === 0) {
    throw new Error("Unable to extract Gemini conversation messages from DOM.");
  }

  return {
    platform: "gemini",
    sourceId,
    url,
    title: getGeminiTitle(document),
    extractedAt: new Date().toISOString(),
    participants: buildParticipants(messages, "Gemini"),
    messages,
    meta: {
      sourceHost: "gemini.google.com",
      turnCount: messages.length,
    },
  };
}

function findAiStudioSettingsValue(document: Document, label: string): string | undefined {
  const labels = Array.from(document.querySelectorAll<HTMLElement>(".item-description-title, .title, h2, h3"));
  const matched = labels.find((element) => getElementText(element) === label);
  if (!matched) return undefined;
  const container =
    matched.closest<HTMLElement>(".settings-item, .selector-container, .field-group, .overlay-header") ?? matched.parentElement;
  const text = getElementText(container).replace(/\s+/g, " ").trim();
  return text || undefined;
}

function collectAiStudioMeta(document: Document): Record<string, unknown> {
  return {
    sourceHost: "aistudio.google.com",
    model: document.querySelector<HTMLElement>('[data-test-id="model-name"]')?.textContent?.trim() ?? undefined,
    systemInstructions: findAiStudioSettingsValue(document, "System instructions"),
    temperature: findAiStudioSettingsValue(document, "Temperature"),
    mediaResolution: findAiStudioSettingsValue(document, "Media resolution"),
    thinkingLevel: findAiStudioSettingsValue(document, "Thinking level"),
    tools: Array.from(document.querySelectorAll<HTMLElement>(".settings-tool .item-description-title, .group-title"))
      .map((element) => getElementText(element))
      .filter(Boolean),
  };
}

function normalizeAiStudioText(text: string): string {
  return text
    .replace(/\b(edit|more_vert|thumb_up|thumb_down|chevron_right|chevron_left|chevron_more)\b/gi, " ")
    .replace(/\b(Model \d{1,2}:\d{2})\b/g, " ")
    .replace(/\bThoughts?\b/gi, " ")
    .replace(/\bExpand to view model thoughts\b/gi, " ")
    .replace(/\bResponse ready\.?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMeaningfulAiStudioText(turn: HTMLElement): boolean {
  const textareaText = Array.from(turn.querySelectorAll<HTMLTextAreaElement>("textarea"))
    .map((textarea) => textarea.value.trim())
    .join(" ")
    .trim();
  if (textareaText.length > 0) return true;

  const root =
    turn.querySelector<HTMLElement>("ms-text-chunk, ms-cmark-node, ms-prompt-chunk, .turn-content") ?? turn;
  return normalizeAiStudioText(getElementText(root)).length > 0;
}

async function expandAiStudioEditableTurns(document: Document): Promise<void> {
  const view = getView(document);
  const editButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('ms-chat-turn .toggle-edit-button, ms-chat-turn button[aria-label="Edit"]'),
  );
  for (const button of editButtons) {
    if (button.disabled) continue;
    const turn = button.closest<HTMLElement>("ms-chat-turn");
    if (turn && hasMeaningfulAiStudioText(turn)) continue;
    button.click();
    await new Promise((resolve) => view.setTimeout(resolve, 200));
  }
}

function getAiStudioTitle(document: Document): string | undefined {
  return (
    document.title.replace(/\s*\|\s*Google AI Studio\s*$/i, "").trim() ||
    getElementText(document.querySelector<HTMLElement>("title")) ||
    undefined
  );
}

function uniqMarkdown(blocks: string[]): string[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const normalized = block.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function extractAiStudioTurnMarkdown(turn: HTMLElement, role: "user" | "assistant"): string {
  if (role === "user") {
    const textareaBlocks = uniqMarkdown(
      Array.from(turn.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((textarea) => textarea.value.trim())
        .filter(Boolean),
    );
    if (textareaBlocks.length > 0) {
      return textareaBlocks.join("\n\n");
    }

    const contentRoot =
      turn.querySelector<HTMLElement>(".user-prompt-container ms-text-chunk, .user-prompt-container ms-cmark-node, .user-prompt-container ms-prompt-chunk") ??
      turn.querySelector<HTMLElement>(".user-prompt-container .turn-content, .turn-content");
    if (!contentRoot) return "";
    return normalizeAiStudioText(turndownAiStudioNode(contentRoot));
  }

  const blocks: string[] = [];
  const thoughtChunk = turn.querySelector<HTMLElement>("ms-thought-chunk");
  if (thoughtChunk) {
    const thoughtRoots = Array.from(
      thoughtChunk.querySelectorAll<HTMLElement>("ms-text-chunk, ms-cmark-node, p, li, pre, code, blockquote"),
    );
    const thoughtSource = thoughtRoots.length > 0 ? uniqMarkdown(thoughtRoots.map((root) => turndownAiStudioNode(root))).join("\n\n") : turndownAiStudioNode(thoughtChunk);
    const thoughtText = normalizeAiStudioText(thoughtSource);
    if (thoughtText) {
      blocks.push(`> [thinking] ${thoughtText}`);
    }
  }

  const responseRoots = Array.from(
    turn.querySelectorAll<HTMLElement>(
      [
        ".model-prompt-container ms-text-chunk",
        ".model-prompt-container ms-cmark-node.v3-font-body",
        ".model-prompt-container pre",
        ".model-prompt-container table",
      ].join(", "),
    ),
  ).filter((root) => !root.closest("ms-thought-chunk"));

  if (responseRoots.length > 0) {
    uniqMarkdown(responseRoots.map((root) => normalizeAiStudioText(turndownAiStudioNode(root)))).forEach((block) => {
      if (block) blocks.push(block);
    });
  } else if (!thoughtChunk) {
    const fallbackRoot =
      turn.querySelector<HTMLElement>(".model-prompt-container .turn-content, .model-prompt-container, .turn-content");
    if (fallbackRoot) {
      const fallback = normalizeAiStudioText(turndownAiStudioNode(fallbackRoot));
      if (fallback) blocks.push(fallback);
    }
  }

  return uniqMarkdown(blocks).join("\n\n");
}

export async function extractAiStudioConversationFromDom(document: Document, url: string, sourceId: string): Promise<ConversationBundle> {
  await expandAiStudioEditableTurns(document);

  const messages: Message[] = [];
  const title = getAiStudioTitle(document);
  const turns = Array.from(document.querySelectorAll<HTMLElement>("ms-chat-turn"));
  turns.forEach((turn, index) => {
    const roleContainer = turn.querySelector<HTMLElement>(".chat-turn-container");
    const role = roleContainer?.classList.contains("user") ? "user" : "assistant";
    const markdown = extractAiStudioTurnMarkdown(turn, role);

    if (markdown.length === 0) return;
    messages.push({
      id: turn.id || `${role}-${index + 1}`,
      role,
      markdown,
    });
  });

  if (!messages.some((message) => message.role === "user") && title) {
    messages.unshift({
      id: `${sourceId}-prompt-title`,
      role: "user",
      markdown: title,
    });
  }

  if (messages.length === 0) {
    const fallback = [
      title ? `# ${title}` : "",
      "AI Studio conversation content was not fully accessible from the current DOM snapshot.",
      "Run settings metadata was exported for this prompt.",
    ]
      .filter(Boolean)
      .join("\n\n");

    messages.push({
      id: `${sourceId}-fallback`,
      role: "assistant",
      markdown: fallback,
    });
  }

  return {
    platform: "aistudio",
    sourceId,
    url,
    title,
    extractedAt: new Date().toISOString(),
    participants: buildParticipants(messages, "Google AI Studio"),
    messages,
    meta: collectAiStudioMeta(document),
  };
}
