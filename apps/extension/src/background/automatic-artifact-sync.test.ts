import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueState } from "@aiexporter/adapter-sdk";
import { runPeriodicSchedulerWork } from "./automatic-artifact-sync";

function createQueueState(overrides: Partial<QueueState> = {}): QueueState {
  return {
    items: [],
    activeWorkers: [],
    settings: {} as QueueState["settings"],
    services: {} as QueueState["services"],
    ...overrides,
  };
}

function createDeps() {
  return {
    loadQueueState: vi
      .fn<() => Promise<QueueState>>()
      .mockResolvedValue(createQueueState()),
    loadArtifactSyncState: vi
      .fn<() => Promise<{ lastCompletedAt?: string }>>()
      .mockResolvedValue({}),
    runArtifactSync: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    requestPlatformTick:
      vi.fn<
        (platform: "chatgpt" | "gemini" | "aistudio" | "deepseek") => void
      >(),
    writeBackgroundLog: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runPeriodicSchedulerWork", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs automatic sync when it is due and the queue is idle", async () => {
    const deps = createDeps();

    await expect(runPeriodicSchedulerWork(deps)).resolves.toBe("synced");
    expect(deps.runArtifactSync).toHaveBeenCalledTimes(1);
    expect(deps.requestPlatformTick).not.toHaveBeenCalled();
  });

  it("falls back to normal platform ticks when sync is not due", async () => {
    const deps = createDeps();
    deps.loadArtifactSyncState.mockResolvedValue({
      lastCompletedAt: "2026-04-17T00:00:00.000Z",
    });

    await expect(runPeriodicSchedulerWork(deps)).resolves.toBe("ticked");
    expect(deps.runArtifactSync).not.toHaveBeenCalled();
    expect(deps.requestPlatformTick).toHaveBeenCalledTimes(4);
  });

  it("falls back to normal platform ticks when the queue is busy", async () => {
    const deps = createDeps();
    deps.loadQueueState.mockResolvedValue(
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
    );

    await expect(runPeriodicSchedulerWork(deps)).resolves.toBe("ticked");
    expect(deps.runArtifactSync).not.toHaveBeenCalled();
    expect(deps.requestPlatformTick).toHaveBeenCalledTimes(4);
  });

  it("logs and falls back to normal platform ticks when sync checks throw", async () => {
    const deps = createDeps();
    deps.loadQueueState.mockRejectedValue(new Error("boom"));

    await expect(runPeriodicSchedulerWork(deps)).resolves.toBe("ticked");
    expect(deps.writeBackgroundLog).toHaveBeenCalledWith(
      "background.artifact",
      "warn",
      "Automatic artifact sync check failed; continuing with scheduler ticks.",
      expect.objectContaining({
        code: "artifact.sync_auto_failed",
      }),
    );
    expect(deps.requestPlatformTick).toHaveBeenCalledTimes(4);
  });
});
