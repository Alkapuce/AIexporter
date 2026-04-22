import { describe, expect, it } from "vitest";
import { clearHistoricalItems, getNextPendingItem, mergeDiscoveryEvent, retryFailedItems } from "./queue";

describe("queue helpers", () => {
  it("deduplicates discovery events by fingerprint", () => {
    const items = mergeDiscoveryEvent(
      [],
      {
        platform: "chatgpt",
        sourceId: "conv-1",
        url: "https://chatgpt.com/c/conv-1",
        revisionFingerprint: "abc12345",
      },
      {
        kind: "export",
        priority: "realtime",
      },
      "2026-03-18T08:00:00.000Z",
    );

    const merged = mergeDiscoveryEvent(
      items,
      {
        platform: "chatgpt",
        sourceId: "conv-1",
        url: "https://chatgpt.com/c/conv-1",
        revisionFingerprint: "abc12345",
      },
      {
        kind: "export",
        priority: "realtime",
      },
      "2026-03-18T08:01:00.000Z",
    );

    expect(merged).toHaveLength(1);
    expect(getNextPendingItem(merged)?.event.sourceId).toBe("conv-1");
  });

  it("retries failed items and clears completed history", () => {
    const retried = retryFailedItems([
      {
        key: "k1",
        event: {
          platform: "chatgpt",
          sourceId: "conv-1",
          url: "https://chatgpt.com/c/conv-1",
          revisionFingerprint: "a",
        },
        kind: "export",
        priority: "retry",
        platform: "chatgpt",
        status: "failed",
        attempts: 1,
        discoveredAt: "2026-03-18T08:00:00.000Z",
        updatedAt: "2026-03-18T08:00:00.000Z",
        lastError: "boom",
      },
    ]);

    expect(retried[0]?.status).toBe("pending");

    const cleared = clearHistoricalItems([
      {
        ...retried[0]!,
        status: "completed",
      },
    ]);

    expect(cleared).toHaveLength(0);
  });

  it("requeues an existing fingerprint when forcePending is requested", () => {
    const items = [
      {
        key: "deepseek:conv-1:abc12345",
        event: {
          platform: "deepseek" as const,
          sourceId: "conv-1",
          url: "https://chat.deepseek.com/a/chat/s/conv-1",
          revisionFingerprint: "abc12345",
        },
        kind: "export" as const,
        priority: "backfill" as const,
        platform: "deepseek" as const,
        status: "completed" as const,
        attempts: 1,
        discoveredAt: "2026-03-18T08:00:00.000Z",
        updatedAt: "2026-03-18T08:00:00.000Z",
      },
    ];

    const merged = mergeDiscoveryEvent(
      items,
      {
        platform: "deepseek",
        sourceId: "conv-1",
        url: "https://chat.deepseek.com/a/chat/s/conv-1",
        revisionFingerprint: "abc12345",
      },
      {
        kind: "export",
        priority: "retry",
        forcePending: true,
      },
      "2026-03-18T08:01:00.000Z",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("pending");
    expect(merged[0]?.priority).toBe("retry");
    expect(merged[0]?.platform).toBe("deepseek");
  });

  it("creates a new pending item instead of mutating a completed source item", () => {
    const items = [
      {
        key: "deepseek:conv-1:oldfingerprint",
        event: {
          platform: "deepseek" as const,
          sourceId: "conv-1",
          url: "https://chat.deepseek.com/a/chat/s/conv-1",
          revisionFingerprint: "oldfingerprint",
        },
        kind: "export" as const,
        priority: "backfill" as const,
        platform: "deepseek" as const,
        status: "completed" as const,
        attempts: 1,
        discoveredAt: "2026-03-18T08:00:00.000Z",
        updatedAt: "2026-03-18T08:00:00.000Z",
      },
    ];

    const merged = mergeDiscoveryEvent(
      items,
      {
        platform: "deepseek",
        sourceId: "conv-1",
        url: "https://chat.deepseek.com/a/chat/s/conv-1",
        revisionFingerprint: "newfingerprint",
      },
      {
        kind: "export",
        priority: "realtime",
        forcePending: true,
      },
      "2026-03-18T08:01:00.000Z",
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.key).toBe("deepseek:conv-1:newfingerprint");
    expect(merged[0]?.status).toBe("pending");
    expect(merged[1]?.status).toBe("completed");
  });

  it("merges into a failed item instead of creating a duplicate", () => {
    const items = [
      {
        key: "gemini:conv-1:",
        event: {
          platform: "gemini" as const,
          sourceId: "conv-1",
          url: "https://gemini.google.com/app/conv-1",
          revisionFingerprint: "",
        },
        kind: "export" as const,
        priority: "realtime" as const,
        platform: "gemini" as const,
        status: "failed" as const,
        attempts: 1,
        lastError: "Worker receiver did not become ready before timeout.",
        discoveredAt: "2026-04-22T06:04:45.000Z",
        updatedAt: "2026-04-22T06:05:40.000Z",
      },
    ];

    const merged = mergeDiscoveryEvent(
      items,
      {
        platform: "gemini",
        sourceId: "conv-1",
        url: "https://gemini.google.com/app/conv-1",
        revisionFingerprint: "",
      },
      { kind: "export", priority: "realtime" },
      "2026-04-22T06:06:11.000Z",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("pending");
    expect(merged[0]?.lastError).toBeUndefined();
  });
});
