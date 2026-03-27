import { describe, expect, it, vi } from "vitest";
import type { QueueState } from "@aiexporter/adapter-sdk";
import { createBackgroundRuntimeRouter } from "./runtime-router";

function createQueueState(): QueueState {
  return {
    items: [],
    activeWorkers: [],
    lastProcessedAt: undefined,
    settings: {
      syncToServer: false,
      serverUrl: "http://127.0.0.1:8787",
      browserLabel: "Edge",
      uiLocale: "zh-CN",
      dashboardOpenBehavior: "tab",
      scheduler: {
        autoStartOnBrowserLaunch: true,
        globalPaused: false,
        logRetentionEntries: 500,
      },
      downloads: {
        mode: "downloads-api",
        hideDownloadUi: true,
        skipIfLatestExists: true,
        retainLocalRevisionCount: 3,
        openFileActionsEnabled: true,
      },
      platforms: {
        chatgpt: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: false,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 1000,
          navigationTimeoutMs: 10000,
          settleDelayMs: 500,
          discoverySweepIntervalMs: 60000,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 10000,
          discoveryScrollStableRounds: 2,
          receiverReadyTimeoutMs: 5000,
          receiverRetryLimit: 3,
          apiExtractMode: "page_world_first",
        },
        gemini: {
          enabled: false,
          autoExportEnabled: false,
          historyBackfillEnabled: false,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 1000,
          navigationTimeoutMs: 10000,
          settleDelayMs: 500,
          discoverySweepIntervalMs: 60000,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 10000,
          discoveryScrollStableRounds: 2,
          receiverReadyTimeoutMs: 5000,
          receiverRetryLimit: 3,
          apiExtractMode: "page_world_first",
        },
        deepseek: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "background_backfill",
          maxConcurrency: 1,
          minStartIntervalMs: 1000,
          navigationTimeoutMs: 12000,
          settleDelayMs: 500,
          discoverySweepIntervalMs: 60000,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: true,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 10000,
          discoveryScrollStableRounds: 2,
          receiverReadyTimeoutMs: 5000,
          receiverRetryLimit: 3,
          apiExtractMode: "page_world_first",
        },
      },
    },
    services: {
      chatgpt: {
        platform: "chatgpt",
        status: "idle",
        desiredRunning: true,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
      },
      gemini: {
        platform: "gemini",
        status: "paused",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
      },
      deepseek: {
        platform: "deepseek",
        status: "idle",
        desiredRunning: true,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
      },
    },
  };
}

function createRouter() {
  const queueState = createQueueState();
  const serviceRuntime = {
    clearPlatformLocalRecords: vi.fn().mockResolvedValue(queueState),
    extractConversationFromTab: vi.fn(),
    handleTabRemoved: vi.fn().mockResolvedValue(undefined),
    queuePassiveDiscoveryEvent: vi.fn().mockResolvedValue({ total: 1, queued: 1 }),
    requestPlatformTick: vi.fn(),
    runDeepSeekDiscoverySweep: vi.fn().mockResolvedValue(undefined),
    updatePlatformDesiredRunning: vi.fn().mockResolvedValue(queueState),
  };

  const deps = {
    clearDebugState: vi.fn().mockResolvedValue({ logs: [] }),
    downloadTextAsset: vi.fn().mockResolvedValue({ downloadId: 1 }),
    loadDebugState: vi.fn().mockResolvedValue({ logs: [] }),
    loadQueueState: vi.fn().mockResolvedValue(queueState),
    openLatestArtifact: vi.fn().mockResolvedValue({ revision: "rev-1" }),
    persistBundle: vi.fn(),
    recordManualExportDebug: vi.fn().mockResolvedValue(undefined),
    refreshQueueServices: vi.fn().mockResolvedValue(queueState),
    showLatestArtifactFolder: vi.fn().mockResolvedValue({ revision: "rev-1" }),
    syncDownloadUiWithSettings: vi.fn().mockResolvedValue(undefined),
    updateConversationIndex: vi.fn().mockResolvedValue([]),
    updateQueueStateWithDerived: vi.fn().mockImplementation(async (updater) => updater(queueState)),
    writeBackgroundLog: vi.fn().mockResolvedValue(undefined),
  };

  return {
    deps,
    handler: createBackgroundRuntimeRouter(serviceRuntime, deps),
    serviceRuntime,
    queueState,
  };
}

describe("background runtime router", () => {
  it("returns queue state snapshots for queue-state-request", async () => {
    const { handler, queueState, deps } = createRouter();

    await expect(handler({ type: "queue-state-request" }, {} as browser.runtime.MessageSender)).resolves.toBe(queueState);
    expect(deps.loadQueueState).toHaveBeenCalledTimes(1);
  });

  it("delegates artifact-open-latest to artifact persistence helpers", async () => {
    const { handler, deps } = createRouter();

    await expect(
      handler(
        { type: "artifact-open-latest", platform: "deepseek", sourceId: "conv-1" },
        {} as browser.runtime.MessageSender,
      ),
    ).resolves.toEqual({ revision: "rev-1" });

    expect(deps.openLatestArtifact).toHaveBeenCalledWith("deepseek", "conv-1");
  });

  it("starts a full bootstrap sweep for deepseek", async () => {
    const { handler, serviceRuntime } = createRouter();

    await handler(
      { type: "service-full-bootstrap-run", platform: "deepseek" },
      {} as browser.runtime.MessageSender,
    );
    await Promise.resolve();

    expect(serviceRuntime.runDeepSeekDiscoverySweep).toHaveBeenCalledWith("deepseek", "full-bootstrap");
  });

  it("rejects manual export without an active sender tab", async () => {
    const { handler } = createRouter();

    await expect(
      handler({ type: "manual-export-current", url: "https://chat.deepseek.com" }, {} as browser.runtime.MessageSender),
    ).rejects.toThrow("Manual export requires an active conversation tab.");
  });
});
