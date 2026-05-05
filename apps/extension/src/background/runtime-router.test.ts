import { afterEach, describe, expect, it, vi } from "vitest";
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
      uiThemeMode: "system",
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
          discoveryDomMaxCycles: 24,
          discoveryDomPostScrollWaitMs: 5000,
          discoveryDomStableCycles: 3,
          discoveryDomScrollBottomAttempts: 4,
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
          discoveryDomMaxCycles: 200,
          discoveryDomPostScrollWaitMs: 5000,
          discoveryDomStableCycles: 3,
          discoveryDomScrollBottomAttempts: 4,
          receiverReadyTimeoutMs: 5000,
          receiverRetryLimit: 3,
          apiExtractMode: "page_world_first",
        },
        aistudio: {
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
          discoveryDomMaxCycles: 24,
          discoveryDomPostScrollWaitMs: 5000,
          discoveryDomStableCycles: 3,
          discoveryDomScrollBottomAttempts: 4,
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
          discoveryDomMaxCycles: 24,
          discoveryDomPostScrollWaitMs: 5000,
          discoveryDomStableCycles: 3,
          discoveryDomScrollBottomAttempts: 4,
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
      aistudio: {
        platform: "aistudio",
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
  let queueState = createQueueState();
  const serviceRuntime = {
    clearPlatformLocalRecords: vi.fn().mockResolvedValue(queueState),
    extractConversationFromTab: vi.fn(),
    handleTabRemoved: vi.fn().mockResolvedValue(undefined),
    queuePassiveDiscoveryEvent: vi.fn().mockResolvedValue({ total: 1, queued: 1 }),
    queuePassiveDiscoveryEvents: vi.fn().mockResolvedValue({ total: 2, queued: 2 }),
    requestPlatformStartupCatchup: vi.fn(),
    requestPlatformTick: vi.fn(),
    runPlatformDiscoverySweep: vi.fn().mockResolvedValue(undefined),
    updatePlatformDesiredRunning: vi.fn().mockResolvedValue(queueState),
  };

  const deps = {
    clearDebugState: vi.fn().mockResolvedValue({ logs: [] }),
    downloadTextAsset: vi.fn().mockResolvedValue({ downloadId: 1 }),
    getQueueStateSnapshot: vi.fn().mockImplementation(async () => queueState),
    loadDebugState: vi.fn().mockResolvedValue({ logs: [] }),
    loadQueueState: vi.fn().mockImplementation(async () => queueState),
    openLatestArtifact: vi.fn().mockResolvedValue({ revision: "rev-1" }),
    persistBundle: vi.fn(),
    recordManualExportDebug: vi.fn().mockResolvedValue(undefined),
    refreshQueueServices: vi.fn().mockImplementation(async () => queueState),
    showLatestArtifactFolder: vi.fn().mockResolvedValue({ revision: "rev-1" }),
    syncDownloadUiWithSettings: vi.fn().mockResolvedValue(undefined),
    updateConversationIndex: vi.fn().mockResolvedValue([]),
    updateQueueStateWithDerived: vi.fn().mockImplementation(async (updater) => {
      queueState = await updater(queueState);
      return queueState;
    }),
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns queue state snapshots for queue-state-request", async () => {
    const { handler, queueState, deps } = createRouter();

    await expect(handler({ type: "queue-state-request" }, {} as browser.runtime.MessageSender)).resolves.toBe(
      queueState,
    );
    expect(deps.getQueueStateSnapshot).toHaveBeenCalledTimes(1);
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

    await handler({ type: "service-full-bootstrap-run", platform: "deepseek" }, {} as browser.runtime.MessageSender);
    await Promise.resolve();

    expect(serviceRuntime.runPlatformDiscoverySweep).toHaveBeenCalledWith("deepseek", "full-bootstrap");
  });

  it("enables google platforms before resume", async () => {
    const { handler, deps, serviceRuntime } = createRouter();

    await handler({ type: "service-resume", platform: "gemini" }, {} as browser.runtime.MessageSender);

    expect(deps.updateQueueStateWithDerived).toHaveBeenCalled();
    expect(serviceRuntime.updatePlatformDesiredRunning).toHaveBeenCalledWith("gemini", true);
  });

  it("queues passive discovery batches and triggers platform ticks", async () => {
    const { handler, serviceRuntime } = createRouter();

    const events = [
      {
        platform: "deepseek" as const,
        sourceId: "conv-1",
        url: "https://chat.deepseek.com/a/chat/s/conv-1",
        revisionFingerprint: "rev-1",
      },
      {
        platform: "deepseek" as const,
        sourceId: "conv-2",
        url: "https://chat.deepseek.com/a/chat/s/conv-2",
        revisionFingerprint: "rev-2",
      },
    ];

    await handler({ type: "queue-discovery-batch", events }, { tab: { id: 9 } } as browser.runtime.MessageSender);

    expect(serviceRuntime.queuePassiveDiscoveryEvents).toHaveBeenCalledWith(events);
    expect(serviceRuntime.requestPlatformTick).toHaveBeenCalledWith("deepseek");
  });

  it("reloads the source tab and retries manual export when the receiver is unavailable", async () => {
    const { handler, serviceRuntime, deps } = createRouter();
    const bundle = {
      platform: "deepseek" as const,
      sourceId: "conv-1",
      url: "https://chat.deepseek.com/a/chat/s/conv-1",
      title: "DeepSeek Chat",
      extractedAt: "2026-04-21T12:00:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "DeepSeek" },
      ],
      messages: [{ id: "m1", role: "user", markdown: "hello" }],
    };
    serviceRuntime.extractConversationFromTab
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce(bundle);
    deps.persistBundle.mockResolvedValue({
      bundle,
      revision: "rev-1",
      files: ["AIexporter/deepseek/conv-1.md", "AIexporter/deepseek/conv-1.bundle.json"],
      downloadIds: [101, 102],
      artifactEntry: {
        platform: "deepseek",
        sourceId: "conv-1",
        revision: "rev-1",
        exportedAt: "2026-04-21T12:00:01.000Z",
        localStatus: "present",
        isLatestForConversation: true,
      },
      skipped: false,
    });

    vi.stubGlobal("browser", {
      tabs: {
        get: vi
          .fn()
          .mockResolvedValueOnce({ id: 11, url: "https://chat.deepseek.com/a/chat/s/conv-1", status: "complete" })
          .mockResolvedValue({
            id: 11,
            url: "https://chat.deepseek.com/a/chat/s/conv-1",
            title: "DeepSeek Chat",
            status: "complete",
          }),
        reload: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      handler(
        {
          type: "manual-export-run",
          sourceTabId: 11,
          options: {
            preset: "standard",
            includeMarkdown: true,
            includeBundleJson: true,
            markdownOptions: {
              includeThinking: false,
              includeImages: true,
              includeAttachments: true,
              includeMessageTimestamps: true,
            },
          },
        },
        {} as browser.runtime.MessageSender,
      ),
    ).resolves.toMatchObject({
      ok: true,
      revision: "rev-1",
      skipped: false,
    });

    expect(globalThis.browser.tabs.reload).toHaveBeenCalledWith(11);
    expect(serviceRuntime.extractConversationFromTab).toHaveBeenCalledTimes(2);
  });

  it("marks discover-export items completed after a successful foreground fetch", async () => {
    const { handler, serviceRuntime, deps, queueState } = createRouter();
    queueState.items = [
      {
        key: "deepseek:conv-1:rev-1",
        kind: "export",
        priority: "retry",
        platform: "deepseek",
        status: "failed",
        attempts: 1,
        discoveredAt: "2026-04-23T10:00:00.000Z",
        updatedAt: "2026-04-23T10:01:00.000Z",
        lastError: "old error",
        event: {
          platform: "deepseek",
          sourceId: "conv-1",
          url: "https://chat.deepseek.com/a/chat/s/conv-1",
          revisionFingerprint: "rev-1",
        },
      },
    ];
    const bundle = {
      platform: "deepseek" as const,
      sourceId: "conv-1",
      url: "https://chat.deepseek.com/a/chat/s/conv-1",
      title: "DeepSeek Chat",
      extractedAt: "2026-04-23T10:02:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "DeepSeek" },
      ],
      messages: [{ id: "m1", role: "user", markdown: "hello" }],
    };
    serviceRuntime.extractConversationFromTab.mockResolvedValue(bundle);
    deps.persistBundle.mockResolvedValue({
      bundle,
      revision: "rev-2",
      files: ["AIexporter/deepseek/conv-1.md"],
      downloadIds: [101],
      artifactEntry: {
        platform: "deepseek",
        sourceId: "conv-1",
        revision: "rev-2",
        exportedAt: "2026-04-23T10:02:01.000Z",
        localStatus: "present",
        isLatestForConversation: true,
      },
      skipped: false,
    });

    vi.stubGlobal("browser", {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 88 }),
        get: vi.fn().mockResolvedValue({
          id: 88,
          url: "https://chat.deepseek.com/a/chat/s/conv-1?aiexporter_worker=1",
          status: "complete",
        }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    });

    const nextState = (await handler(
      { type: "queue-item-discover-export", key: "deepseek:conv-1:rev-1" },
      {} as browser.runtime.MessageSender,
    )) as QueueState;

    expect(nextState.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "deepseek:conv-1:rev-1",
          status: "completed",
          resultRevision: "rev-2",
          lastError: undefined,
          workerId: undefined,
        }),
      ]),
    );
  });
});
