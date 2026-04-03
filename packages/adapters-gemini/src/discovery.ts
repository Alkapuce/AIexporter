import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";

const GEMINI_CONVERSATION_PATTERN = /\/app\/([^/?#]+)/i;
const AISTUDIO_PROMPT_PATTERN = /\/prompts\/([^/?#]+)/i;
const GEMINI_RESERVED_ROUTE_IDS = new Set(["mystuff"]);

function normalizeRelativeUrl(url: string, origin: string): string {
  const normalized = new URL(url, origin);
  normalized.searchParams.delete("aiexporter_worker");
  return normalized.toString();
}

function linkText(anchor: HTMLAnchorElement): string | undefined {
  const text = anchor.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function findAiStudioRow(anchor: HTMLAnchorElement): Element | null {
  let current: Element | null = anchor;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current.matches("tr, .lib-table-row, .history-item, .mat-mdc-row, [role='row']")) {
      return current;
    }
    current = current.parentElement;
  }
  return anchor.parentElement ?? null;
}

function extractAiStudioUpdatedLabel(anchor: HTMLAnchorElement): string | undefined {
  const row = findAiStudioRow(anchor);
  const candidateContainers = [row, anchor.parentElement, anchor.parentElement?.parentElement].filter(
    (value): value is Element => Boolean(value),
  );
  const siblingText = anchor.parentElement?.nextElementSibling?.textContent;
  const updatedCell = candidateContainers
    .map((container) => container.querySelector<HTMLElement>(".cdk-column-updated, .mat-column-updated, [data-column='updated']"))
    .find(Boolean);

  const candidateTexts = [
    updatedCell?.textContent,
    siblingText,
    ...candidateContainers.map((container) => container.textContent),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, " ").trim());

  for (const text of candidateTexts) {
    const match = text.match(
      /\b(?:updated\s+)?((?:today|yesterday)|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i,
    );
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function toGeminiPayload(anchor: HTMLAnchorElement, origin: string): BridgeNetworkPayload | null {
  const href = anchor.getAttribute("href");
  if (!href || href === "/app") return null;
  const url = normalizeRelativeUrl(href, origin);
  const sourceId = extractGeminiConversationIdFromUrl(url);
  if (!sourceId) return null;

  return {
    sourceId,
    url,
    title: linkText(anchor),
  };
}

function toAiStudioPayload(anchor: HTMLAnchorElement, origin: string): BridgeNetworkPayload | null {
  const href = anchor.getAttribute("href");
  if (!href || href.endsWith("/prompts/new_chat")) return null;
  const url = normalizeRelativeUrl(href, origin);
  const sourceId = extractAiStudioPromptIdFromUrl(url);
  if (!sourceId) return null;

  return {
    sourceId,
    url,
    title: linkText(anchor),
    sourceUpdatedLabel: extractAiStudioUpdatedLabel(anchor),
  };
}

function dedupePayloads(payloads: BridgeNetworkPayload[]): BridgeNetworkPayload[] {
  const deduped = new Map<string, BridgeNetworkPayload>();
  payloads.forEach((payload) => {
    const existing = deduped.get(payload.sourceId);
    if (!existing) {
      deduped.set(payload.sourceId, payload);
      return;
    }

    deduped.set(payload.sourceId, {
      ...existing,
      ...payload,
      title: payload.title ?? existing.title,
      sourceUpdatedAt: payload.sourceUpdatedAt ?? existing.sourceUpdatedAt,
      sourceUpdatedLabel: payload.sourceUpdatedLabel ?? existing.sourceUpdatedLabel,
    });
  });
  return Array.from(deduped.values());
}

export function extractGeminiConversationIdFromUrl(url: string): string | null {
  const match = GEMINI_CONVERSATION_PATTERN.exec(url);
  const sourceId = match?.[1] ?? null;
  if (!sourceId || GEMINI_RESERVED_ROUTE_IDS.has(sourceId.toLowerCase())) {
    return null;
  }
  return sourceId;
}

export function extractAiStudioPromptIdFromUrl(url: string): string | null {
  const match = AISTUDIO_PROMPT_PATTERN.exec(url);
  const sourceId = match?.[1] ?? null;
  if (!sourceId || sourceId === "new_chat") return null;
  return sourceId;
}

export function extractGeminiPayloadsFromDocument(
  document: Document,
  origin = "https://gemini.google.com",
): BridgeNetworkPayload[] {
  return dedupePayloads(
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]'))
      .map((anchor) => toGeminiPayload(anchor, origin))
      .filter((payload): payload is BridgeNetworkPayload => Boolean(payload)),
  );
}

export function extractAiStudioPayloadsFromDocument(
  document: Document,
  origin = "https://aistudio.google.com",
): BridgeNetworkPayload[] {
  return dedupePayloads(
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/prompts/"]'))
      .map((anchor) => toAiStudioPayload(anchor, origin))
      .filter((payload): payload is BridgeNetworkPayload => Boolean(payload)),
  );
}
