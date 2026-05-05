import { describe, expect, it } from "vitest";
import type { QueueState } from "@aiexporter/adapter-sdk";
import {
  AUTOMATIC_ARTIFACT_SYNC_INTERVAL_MS,
  canRunAutomaticArtifactSync,
  isAutomaticArtifactSyncDue,
} from "./artifact-sync-state";

function createQueueState(overrides: Partial<QueueState> = {}): QueueState {
  return {
    items: [],
    activeWorkers: [],
    settings: {} as QueueState["settings"],
    services: {} as QueueState["services"],
    ...overrides,
  };
}

describe("artifact sync state helpers", () => {
  it("runs weekly sync when there is no recorded successful sync", () => {
    expect(isAutomaticArtifactSyncDue(undefined, Date.parse("2026-04-17T00:00:00.000Z"))).toBe(true);
  });

  it("waits roughly a week before the next automatic sync", () => {
    const lastCompletedAt = "2026-04-10T00:00:00.000Z";
    const almostDue = Date.parse(lastCompletedAt) + AUTOMATIC_ARTIFACT_SYNC_INTERVAL_MS - 1;
    const due = Date.parse(lastCompletedAt) + AUTOMATIC_ARTIFACT_SYNC_INTERVAL_MS;

    expect(isAutomaticArtifactSyncDue(lastCompletedAt, almostDue)).toBe(false);
    expect(isAutomaticArtifactSyncDue(lastCompletedAt, due)).toBe(true);
  });

  it("skips automatic sync while queue work is still active", () => {
    expect(
      canRunAutomaticArtifactSync(
        createQueueState({
          activeWorkers: [
            {
              workerId: "worker-1",
              platform: "gemini",
              role: "export",
              busy: true,
              createdAt: "2026-04-17T00:00:00.000Z",
              lastActiveAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe(false);

    expect(
      canRunAutomaticArtifactSync(
        createQueueState({
          items: [
            {
              key: "gemini:1",
              event: {
                platform: "gemini",
                sourceId: "1",
                url: "https://gemini.google.com/app/1",
                revisionFingerprint: "rev-1",
              },
              kind: "export",
              priority: "realtime",
              platform: "gemini",
              status: "processing",
              attempts: 0,
              discoveredAt: "2026-04-17T00:00:00.000Z",
              updatedAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe(false);

    expect(
      canRunAutomaticArtifactSync(
        createQueueState({
          items: [
            {
              key: "gemini:2",
              event: {
                platform: "gemini",
                sourceId: "2",
                url: "https://gemini.google.com/app/2",
                revisionFingerprint: "rev-2",
              },
              kind: "export",
              priority: "realtime",
              platform: "gemini",
              status: "pending",
              attempts: 0,
              discoveredAt: "2026-04-17T00:00:00.000Z",
              updatedAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe(false);

    expect(canRunAutomaticArtifactSync(createQueueState())).toBe(true);
  });
});
