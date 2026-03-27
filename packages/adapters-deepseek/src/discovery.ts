import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import type { DeepSeekHistoryResponse, DeepSeekSessionCandidate } from "./types";

const CONVERSATION_PATTERN = /^https?:\/\/chat\.deepseek\.com\/a\/chat\/(?:s\/)?([a-zA-Z0-9-]+)/i;

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

  const deduped = new Map<string, BridgeNetworkPayload>();
  items.forEach((item) => {
    deduped.set(item.sourceId, item);
  });
  return Array.from(deduped.values());
}

export function extractDiscoveryPayloadsFromDocument(document: Document, origin = "https://chat.deepseek.com"): BridgeNetworkPayload[] {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/a/chat/s/"]'));
  const deduped = new Map<string, BridgeNetworkPayload>();

  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    const absoluteUrl = new URL(href, origin).toString();
    const sourceId = extractSessionIdFromUrl(absoluteUrl);
    if (!sourceId) return;

    const title = link.textContent?.trim().replace(/\s+/g, " ");
    deduped.set(sourceId, {
      sourceId,
      url: absoluteUrl,
      title: title || undefined,
      sourceUpdatedAt: undefined,
    });
  });

  return Array.from(deduped.values());
}
