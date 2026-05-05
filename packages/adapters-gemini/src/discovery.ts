import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";

const GEMINI_CONVERSATION_PATTERN = /\/app\/([^/?#]+)/i;
const AISTUDIO_PROMPT_PATTERN = /\/prompts\/([^/?#]+)/i;
const GEMINI_RESERVED_ROUTE_IDS = new Set(["mystuff"]);
const RELATIVE_TIME_LABEL_PATTERN =
  /\b((?:today|yesterday|just now|last week|last month)|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i;
const ABSOLUTE_TIME_LABEL_PATTERN =
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s+\d{4})?)\b/i;

function normalizeRelativeUrl(url: string, origin: string): string {
  const normalized = new URL(url, origin);
  normalized.searchParams.delete("aiexporter_worker");
  normalized.searchParams.delete("aiexporter_discovery");
  return normalized.toString();
}

function normalizeTimestamp(seconds: string, nanos?: string): string | undefined {
  const secondsValue = Number(seconds);
  if (!Number.isFinite(secondsValue)) return undefined;
  const nanosValue = Number(nanos ?? "0");
  const millis = secondsValue * 1_000 + Math.floor((Number.isFinite(nanosValue) ? nanosValue : 0) / 1_000_000);
  const timestamp = new Date(millis);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function linkText(anchor: HTMLAnchorElement): string | undefined {
  const text = anchor.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function extractTimeLabel(text: string | null | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const relativeMatch = normalized.match(RELATIVE_TIME_LABEL_PATTERN);
  if (relativeMatch?.[1]) {
    return relativeMatch[1].trim();
  }

  const absoluteMatch = normalized.match(ABSOLUTE_TIME_LABEL_PATTERN);
  if (absoluteMatch?.[1]) {
    return absoluteMatch[1].trim();
  }

  return undefined;
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
    .map((container) =>
      container.querySelector<HTMLElement>(".cdk-column-updated, .mat-column-updated, [data-column='updated']"),
    )
    .find(Boolean);

  const candidateTexts = [
    updatedCell?.textContent,
    siblingText,
    ...candidateContainers.map((container) => container.textContent),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, " ").trim());

  for (const text of candidateTexts) {
    const timeLabel = extractTimeLabel(text);
    if (timeLabel) {
      return timeLabel;
    }
  }

  return undefined;
}

function findGeminiHistoryRow(anchor: HTMLAnchorElement): Element | null {
  let current: Element | null = anchor;
  for (let depth = 0; current && depth < 7; depth += 1) {
    if (
      current.matches(
        [
          "mat-list-item",
          "c-wiz",
          ".conversation",
          ".history-item",
          ".nav-item",
          "[role='listitem']",
          "[data-test-id*='history']",
        ].join(", "),
      )
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return anchor.parentElement ?? null;
}

function extractGeminiUpdatedLabel(anchor: HTMLAnchorElement): string | undefined {
  const row = findGeminiHistoryRow(anchor);
  const candidateContainers = [row, anchor.parentElement, anchor.parentElement?.parentElement].filter(
    (value): value is Element => Boolean(value),
  );
  const candidateTexts = [
    anchor.getAttribute("aria-label"),
    anchor.getAttribute("title"),
    ...candidateContainers.map((container) => container.textContent),
  ];

  for (const candidateText of candidateTexts) {
    const timeLabel = extractTimeLabel(candidateText);
    if (timeLabel) {
      return timeLabel;
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
    sourceUpdatedLabel: extractGeminiUpdatedLabel(anchor),
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

export interface AiStudioListPromptsParseResult {
  payloads: BridgeNetworkPayload[];
  nextCursor?: string;
}

function extractAiStudioUpdatedAtFromPromptCandidate(candidate: unknown): string | undefined {
  if (!Array.isArray(candidate)) return undefined;
  const updateContainer = Array.isArray(candidate[4]) ? candidate[4] : null;
  const updatedTuple = updateContainer && Array.isArray(updateContainer[0]) ? updateContainer[0] : null;
  if (!updatedTuple) return undefined;
  const seconds = typeof updatedTuple[0] === "string" ? updatedTuple[0] : undefined;
  const nanos =
    typeof updatedTuple[1] === "number"
      ? String(updatedTuple[1])
      : typeof updatedTuple[1] === "string"
        ? updatedTuple[1]
        : undefined;
  return seconds ? normalizeTimestamp(seconds, nanos) : undefined;
}

function toAiStudioListPromptsPayload(candidate: unknown, origin: string): BridgeNetworkPayload | null {
  if (!Array.isArray(candidate)) return null;
  const promptPath = typeof candidate[0] === "string" ? candidate[0] : undefined;
  if (!promptPath?.startsWith("prompts/")) return null;

  const sourceId = extractAiStudioPromptIdFromUrl(`https://aistudio.google.com/${promptPath}`);
  if (!sourceId) return null;

  const metadata = Array.isArray(candidate[4]) ? candidate[4] : null;
  const title = metadata && typeof metadata[0] === "string" ? metadata[0].trim() || undefined : undefined;

  return {
    sourceId,
    url: normalizeRelativeUrl(`/${promptPath}`, origin),
    title,
    sourceUpdatedAt: extractAiStudioUpdatedAtFromPromptCandidate(metadata),
  };
}

export function extractAiStudioPayloadsFromListPromptsResponse(
  responseText: string,
  origin = "https://aistudio.google.com",
): AiStudioListPromptsParseResult {
  const parsed = JSON.parse(responseText) as unknown;
  if (!Array.isArray(parsed)) {
    return {
      payloads: [],
    };
  }

  const rawPayloads = Array.isArray(parsed[0]) ? parsed[0] : [];
  const payloads = dedupePayloads(
    rawPayloads
      .map((candidate) => toAiStudioListPromptsPayload(candidate, origin))
      .filter((payload): payload is BridgeNetworkPayload => Boolean(payload)),
  );
  const nextCursor = typeof parsed[1] === "string" && parsed[1].trim() ? parsed[1] : undefined;

  return {
    payloads,
    nextCursor,
  };
}

export function extractGeminiPayloadsFromBatchedResponse(
  responseText: string,
  origin = "https://gemini.google.com",
): BridgeNetworkPayload[] {
  const patterns = [
    /\["c_([^"]+)","((?:\\.|[^"\\])*)",null,null,null,\[(\d+)(?:,(\d+))?\]/g,
    /\\\"c_([^\\"]+)\\\",\\\"((?:\\\\.|[^\\"])*)\\\",null,null,null,\[(\d+)(?:,(\d+))?\]/g,
  ];

  const payloads: BridgeNetworkPayload[] = [];

  for (const pattern of patterns) {
    for (const match of responseText.matchAll(pattern)) {
      const sourceId = match[1];
      const rawTitle = match[2];
      if (!sourceId || !rawTitle) continue;
      const normalizedTitle = pattern === patterns[1] ? rawTitle.replace(/\\\\/g, "\\") : rawTitle;
      const title = JSON.parse(`"${normalizedTitle}"`) as string;
      payloads.push({
        sourceId,
        url: normalizeRelativeUrl(`/app/${sourceId}`, origin),
        title: title.trim() || undefined,
        sourceUpdatedAt: normalizeTimestamp(match[3] ?? "", match[4]),
      });
    }
    if (payloads.length > 0) {
      break;
    }
  }

  return dedupePayloads(payloads);
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
