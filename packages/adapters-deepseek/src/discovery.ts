import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import type { DeepSeekHistoryResponse, DeepSeekSessionCandidate } from "./types";

const CONVERSATION_PATTERN = /^https?:\/\/chat\.deepseek\.com\/a\/chat\/(?:s\/)?([a-zA-Z0-9-]+)/i;

const RELATIVE_TIME_LABEL_PATTERN =
  /\b((?:today|yesterday|just now|last week|last month|a few seconds ago|a minute ago|an hour ago)|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i;
const ABSOLUTE_TIME_LABEL_PATTERN =
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s+\d{4})?)\b/i;
const CHINESE_TIME_LABEL_PATTERN =
  /(\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天|\d{4}[年-]\d{1,2}[月-]\d{1,2}日?)/i;

function extractTimeLabelFromText(text: string | null | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const relativeMatch = normalized.match(RELATIVE_TIME_LABEL_PATTERN);
  if (relativeMatch?.[1]) return relativeMatch[1].trim();

  const absoluteMatch = normalized.match(ABSOLUTE_TIME_LABEL_PATTERN);
  if (absoluteMatch?.[1]) return absoluteMatch[1].trim();

  const chineseMatch = normalized.match(CHINESE_TIME_LABEL_PATTERN);
  if (chineseMatch?.[1]) return chineseMatch[1].trim();

  return undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value !== "string" || !value) return undefined;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && /^\d+(\.\d+)?$/.test(value)) {
    return new Date(numeric * 1000).toISOString();
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function candidateToPayload(candidate: DeepSeekSessionCandidate): BridgeNetworkPayload | null {
  const sourceId = candidate.id ?? candidate.chat_session_id ?? candidate.session_id;
  if (!sourceId) return null;

  return {
    sourceId,
    url: `https://chat.deepseek.com/a/chat/s/${sourceId}`,
    title: typeof candidate.title === "string" && candidate.title ? candidate.title : undefined,
    sourceUpdatedAt: normalizeTimestamp(candidate.updated_at ?? candidate.inserted_at),
  };
}

function parseArray(candidates: unknown): BridgeNetworkPayload[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const payload = candidateToPayload(candidate as DeepSeekSessionCandidate);
    return payload ? [payload] : [];
  });
}

export interface DeepSeekHistoryPageSummary {
  payloads: BridgeNetworkPayload[];
  hasMore: boolean;
  nextCursorUpdatedAt: string | number | null;
}

export function extractSessionIdFromUrl(url: string): string | null {
  const match = CONVERSATION_PATTERN.exec(url);
  return match?.[1] ?? null;
}

export function extractDiscoveryPayloadsFromResponse(payload: unknown): BridgeNetworkPayload[] {
  if (!payload || typeof payload !== "object") return [];

  const response = payload as DeepSeekHistoryResponse;
  const bizData = response.data?.biz_data;

  const currentSession = candidateToPayload({
    id: bizData?.chat_session?.id,
    title: bizData?.chat_session?.title,
    updated_at: bizData?.chat_session?.updated_at,
    inserted_at: bizData?.chat_messages?.at(-1)?.inserted_at,
  });

  const items = [
    ...(currentSession ? [currentSession] : []),
    ...parseArray(bizData?.chat_sessions),
    ...parseArray(bizData?.sessions),
    ...parseArray(response.data?.items),
    ...parseArray(response.data?.list),
  ];

  return mergeDiscoveryPayloads(items);
}

export function extractDiscoveryPayloadsFromDocument(
  document: Document,
  origin = "https://chat.deepseek.com",
): BridgeNetworkPayload[] {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/a/chat/s/"]'));
  const deduped = new Map<string, BridgeNetworkPayload>();

  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    const absoluteUrl = new URL(href, origin).toString();
    const sourceId = extractSessionIdFromUrl(absoluteUrl);
    if (!sourceId) return;

    const title = link.textContent?.trim().replace(/\s+/g, " ");
    const timeLabel = findTimeLabelNearElement(link);

    const existing = deduped.get(sourceId);
    if (existing) {
      deduped.set(sourceId, {
        ...existing,
        title: title || existing.title,
        sourceUpdatedLabel: timeLabel ?? existing.sourceUpdatedLabel,
      });
      return;
    }

    deduped.set(sourceId, {
      sourceId,
      url: absoluteUrl,
      title: title || undefined,
      sourceUpdatedAt: undefined,
      sourceUpdatedLabel: timeLabel,
    });
  });

  return Array.from(deduped.values());
}

/**
 * Walk up the DOM from an anchor element to find a time label (e.g. "2 days ago")
 * in nearby text content.  DeepSeek sidebar rows typically nest the time label
 * inside the same container as the link or in an adjacent element.
 */
function findTimeLabelNearElement(anchor: HTMLAnchorElement): string | undefined {
  // Try the anchor's own aria-label / title first.
  const ariaLabel = anchor.getAttribute("aria-label");
  const titleAttr = anchor.getAttribute("title");
  const directMatch =
    extractTimeLabelFromText(ariaLabel) ??
    extractTimeLabelFromText(titleAttr);
  if (directMatch) return directMatch;

  // Walk up to a plausible row container.
  let container: Element | null = anchor;
  for (let depth = 0; container && depth < 6; depth += 1) {
    if (
      container.matches(
        [
          "li",
          "[role='listitem']",
          ".conversation-item",
          ".chat-item",
          ".session-item",
          ".sidebar-item",
          "[class*='conversation']",
          "[class*='session']",
          "[class*='sidebar']",
        ].join(", "),
      )
    ) {
      break;
    }
    container = container.parentElement;
  }
  if (!container) container = anchor.parentElement;
  if (!container) return undefined;

  // Collect text from the container and immediate children, excluding the anchor's own title text.
  const candidateTexts: string[] = [];
  const anchorTitle = anchor.textContent?.trim().replace(/\s+/g, " ") ?? "";

  // Check sibling elements (time labels often sit in a separate <span> or <div>).
  if (container !== anchor) {
    for (const child of Array.from(container.children)) {
      if (child === anchor) continue;
      const text = child.textContent?.trim().replace(/\s+/g, " ");
      if (text && text !== anchorTitle) {
        candidateTexts.push(text);
      }
    }
  }

  // Also check the container's full text.
  const containerText = container.textContent?.trim().replace(/\s+/g, " ");
  if (containerText) candidateTexts.push(containerText);

  for (const text of candidateTexts) {
    const timeLabel = extractTimeLabelFromText(text);
    if (timeLabel) return timeLabel;
  }

  return undefined;
}

export function mergeDiscoveryPayloads(
  ...groups: ReadonlyArray<readonly BridgeNetworkPayload[]>
): BridgeNetworkPayload[] {
  const deduped = new Map<string, BridgeNetworkPayload>();
  groups.forEach((group) => {
    group.forEach((item) => {
      deduped.set(item.sourceId, item);
    });
  });
  return Array.from(deduped.values());
}

export function summarizeHistoryPage(payload: DeepSeekHistoryResponse): DeepSeekHistoryPageSummary {
  const sessions = payload.data?.biz_data?.chat_sessions ?? [];
  return {
    payloads: extractDiscoveryPayloadsFromResponse(payload),
    hasMore: Boolean(payload.data?.biz_data?.has_more),
    nextCursorUpdatedAt: sessions.length > 0 ? (sessions[sessions.length - 1]?.updated_at ?? null) : null,
  };
}
