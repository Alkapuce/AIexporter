import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

function parseCandidate(candidate: unknown): BridgeNetworkPayload | null {
  if (!candidate || typeof candidate !== "object") return null;
  const objectCandidate = candidate as Record<string, unknown>;
  const sourceId =
    typeof objectCandidate.id === "string"
      ? objectCandidate.id
      : typeof objectCandidate.conversation_id === "string"
        ? objectCandidate.conversation_id
        : null;

  if (!sourceId) return null;

  const title = typeof objectCandidate.title === "string" ? objectCandidate.title : undefined;
  const url =
    typeof objectCandidate.url === "string" && objectCandidate.url.startsWith("http")
      ? objectCandidate.url
      : `https://chatgpt.com/c/${sourceId}`;

  return {
    sourceId,
    url,
    title,
    sourceUpdatedAt: normalizeTimestamp(objectCandidate.update_time ?? objectCandidate.updated_at),
  };
}

export function extractDiscoveryPayloadsFromResponse(payload: unknown): BridgeNetworkPayload[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const parsed = parseCandidate(item);
      return parsed ? [parsed] : [];
    });
  }

  if (!payload || typeof payload !== "object") return [];
  const objectPayload = payload as Record<string, unknown>;

  if (Array.isArray(objectPayload.items)) {
    return objectPayload.items.flatMap((item) => {
      const parsed = parseCandidate(item);
      return parsed ? [parsed] : [];
    });
  }

  const single = parseCandidate(objectPayload);
  return single ? [single] : [];
}

export function extractConversationIdFromUrl(url: string): string | null {
  const match = url.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}
