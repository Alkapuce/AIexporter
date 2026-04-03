import { describe, expect, it } from "vitest";
import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import { buildDeepSeekDiscoveryPagePath, resolveHistoricalPayloads } from "./history";

function payload(sourceId: string, title: string): BridgeNetworkPayload {
  return {
    sourceId,
    url: `https://chat.deepseek.com/a/chat/s/${sourceId}`,
    title,
  };
}

describe("deepseek history helpers", () => {
  it("builds the first discovery API path without a cursor", () => {
    expect(buildDeepSeekDiscoveryPagePath(null)).toBe("/api/v0/chat_session/fetch_page?lte_cursor.pinned=false");
  });

  it("builds the discovery API path with a cursor", () => {
    expect(buildDeepSeekDiscoveryPagePath("1740334294.343")).toBe(
      "/api/v0/chat_session/fetch_page?lte_cursor.pinned=false&lte_cursor.updated_at=1740334294.343",
    );
  });

  it("prefers merged api and sidebar payloads when both are available", () => {
    const result = resolveHistoricalPayloads({
      bufferedPayloads: [payload("session-0", "buffered")],
      sidebarPayloads: [payload("session-1", "sidebar")],
      apiPayloads: [payload("session-1", "api"), payload("session-2", "api-2")],
    });

    expect(result.source).toBe("merged");
    expect(result.payloads.map((item) => item.sourceId)).toEqual(["session-0", "session-1", "session-2"]);
    expect(result.payloads.find((item) => item.sourceId === "session-1")?.title).toBe("api");
  });

  it("falls back to buffered payloads when sidebar is unavailable", () => {
    const result = resolveHistoricalPayloads({
      bufferedPayloads: [payload("session-9", "buffered")],
      sidebarPayloads: [],
      apiPayloads: [],
      preferBufferedOnly: true,
    });

    expect(result.source).toBe("buffered");
    expect(result.payloads).toEqual([payload("session-9", "buffered")]);
  });
});
