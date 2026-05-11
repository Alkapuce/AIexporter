import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationBundle } from "@aiexporter/core-schema";
import type {
  ConversationIndexEntry,
  PlatformRuntimeConfig,
  PlatformServiceState,
  QueueState,
} from "@aiexporter/adapter-sdk";
import { AIEXPORTER_EXPORT_COMPATIBILITY_VERSION, DEFAULT_EXTENSION_SETTINGS } from "@aiexporter/adapter-sdk";

const storage = vi.hoisted(() => ({
  queueState: undefined as QueueState | undefined,
  conversationIndex: [] as unknown[],
  artifactIndex: [] as unknown[],
}));

const loggerMocks = vi.hoisted(() => ({
  writeBackgroundLog: vi.fn(),
  writeBackgroundError: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
  persistBundle: vi.fn(),
  markBundleExportResult: vi.fn(),
}));

const tabRuntimeMocks = vi.hoisted(() => ({
  waitForTabComplete: vi.fn(),
  ensureWorkerReceiver: vi.fn(),
  extractConversationFromTab: vi.fn(),
  closeWorkerTab: vi.fn(),
  waitForWorkerReady: vi.fn(),
  requestTabRuntimeMessage: vi.fn(),
  isChallengeLikeTab: vi.fn(),
}));

let resolvePersistBundle: (() => void) | undefined;

vi.mock("../runtime/storage", () => ({
  loadArtifactIndex: vi.fn(async () => storage.artifactIndex),
  loadConversationIndex: vi.fn(async () => storage.conversationIndex),
  loadQueueState: vi.fn(async () => storage.queueState),
  saveArtifactIndex: vi.fn(async (next) => {
    storage.artifactIndex = next;
    return next;
  }),
  saveConversationIndex: vi.fn(async (next) => {
    storage.conversationIndex = next;
    return next;
  }),
  saveQueueState: vi.fn(async (next) => {
    storage.queueState = next;
    return next;
  }),
  updateConversationIndex: vi.fn(async (updater) => {
    storage.conversationIndex = await updater(storage.conversationIndex);
    return storage.conversationIndex;
  }),
  updateQueueState: vi.fn(async (updater) => {
    storage.queueState = await updater(storage.queueState);
    return storage.queueState;
  }),
}));

vi.mock("../runtime/logger", () => ({
  createTraceLogger: vi.fn(() => loggerMocks.writeBackgroundLog),
  writeBackgroundError: loggerMocks.writeBackgroundError,
  writeBackgroundLog: loggerMocks.writeBackgroundLog,
}));

vi.mock("../runtime/downloads", () => ({
  removeDownloadedAsset: vi.fn(),
}));

vi.mock("../runtime/native-host", () => ({
  checkPathExistsWithNativeHost: vi.fn(async () => ({ path: undefined })),
  recyclePathWithNativeHost: vi.fn(),
  resolveExportRootWithNativeHost: vi.fn(async () => ({ path: undefined })),
}));

vi.mock("./artifact-persistence", () => ({
  markBundleExportResult: persistenceMocks.markBundleExportResult,
  persistBundle: persistenceMocks.persistBundle,
}));

vi.mock("./artifact-sync", () => ({
  syncArtifactsWithDisk: vi.fn(async () => ({
    verifiedCount: 0,
    missingCount: 0,
    importedCount: 0,
    requeueEvents: [],
  })),
}));

vi.mock("./artifact-sync-state", () => ({
  recordArtifactSyncCompleted: vi.fn(),
}));

vi.mock("./tab-runtime", async () => {
  const actual = await vi.importActual<typeof import("./tab-runtime")>("./tab-runtime");
  return {
    ...actual,
    closeWorkerTab: tabRuntimeMocks.closeWorkerTab,
    ensureWorkerReceiver: tabRuntimeMocks.ensureWorkerReceiver,
    extractConversationFromTab: tabRuntimeMocks.extractConversationFromTab,
    isChallengeLikeTab: tabRuntimeMocks.isChallengeLikeTab,
    requestTabRuntimeMessage: tabRuntimeMocks.requestTabRuntimeMessage,
    waitForTabComplete: tabRuntimeMocks.waitForTabComplete,
    waitForWorkerReady: tabRuntimeMocks.waitForWorkerReady,
  };
});

function createQueueState(): QueueState {
  return {
    items: [
      {
        key: "deepseek:conv-1:rev-1",
        event: {
          platform: "deepseek",
          sourceId: "conv-1",
          url: "https://chat.deepseek.com/a/chat/s/conv-1",
          revisionFingerprint: "rev-1",
        },
        kind: "export",
        priority: "realtime",
        platform: "deepseek",
        status: "pending",
        attempts: 0,
        discoveredAt: "2026-04-24T10:00:00.000Z",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
    ],
    activeWorkers: [
      {
        workerId: "worker-1",
        platform: "deepseek",
        role: "export",
        busy: false,
        tabId: 123,
        createdAt: "2026-04-24T09:00:00.000Z",
        lastActiveAt: "2026-04-24T09:00:00.000Z",
      },
    ],
    lastProcessedAt: undefined,
    settings: {
      ...DEFAULT_EXTENSION_SETTINGS,
      platforms: {
        ...DEFAULT_EXTENSION_SETTINGS.platforms,
        deepseek: {
          ...DEFAULT_EXTENSION_SETTINGS.platforms.deepseek,
          discoverySweepIntervalMs: 24 * 60 * 60 * 1000,
          historyBackfillEnabled: true,
          maxConcurrency: 1,
          minStartIntervalMs: 0,
          navigationTimeoutMs: 100,
          receiverReadyTimeoutMs: 100,
          reuseWorkerTabs: true,
          settleDelayMs: 0,
        },
      },
    },
    services: {
      chatgpt: {
        platform: "chatgpt",
        status: "paused",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: {
          discoveredTotal: 0,
          exportedTotal: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      },
      gemini: {
        platform: "gemini",
        status: "paused",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: {
          discoveredTotal: 0,
          exportedTotal: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      },
      aistudio: {
        platform: "aistudio",
        status: "paused",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: {
          discoveredTotal: 0,
          exportedTotal: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      },
      deepseek: {
        platform: "deepseek",
        status: "idle",
        desiredRunning: true,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        lastDiscoveryAt: new Date().toISOString(),
        stats: {
          discoveredTotal: 1,
          exportedTotal: 0,
          pending: 1,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      },
    },
  };
}

function createGeminiConversationIndex(count: number): ConversationIndexEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    platform: "gemini",
    sourceId: `gemini-${index + 1}`,
    title: `Gemini ${index + 1}`,
    url: `https://gemini.google.com/app/gemini-${index + 1}`,
    lastSeenAt: "2026-04-24T12:30:00.000Z",
    latestDiscoveryFingerprint: `gemini-fingerprint-${index + 1}`,
    latestExportCompatibilityVersion: AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
    latestExportRevision: `revision-${index + 1}`,
    discoveryState: "complete",
    exportState: "exported",
  }));
}

function withGeminiBackfillEnabled(
  state: QueueState,
  servicePatch: Partial<PlatformServiceState> = {},
  configPatch: Partial<PlatformRuntimeConfig> = {},
): QueueState {
  return {
    ...state,
    items: state.items.filter((item) => item.platform !== "gemini"),
    activeWorkers: state.activeWorkers.filter((worker) => worker.platform !== "gemini"),
    settings: {
      ...state.settings,
      platforms: {
        ...state.settings.platforms,
        gemini: {
          ...state.settings.platforms.gemini,
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "background_backfill",
          bootstrapRequireFullHistory: true,
          discoverySweepIntervalMs: 24 * 60 * 60 * 1_000,
          navigationTimeoutMs: 100,
          receiverReadyTimeoutMs: 100,
          ...configPatch,
        },
      },
    },
    services: {
      ...state.services,
      gemini: {
        ...state.services.gemini,
        status: "paused",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: {
          discoveredTotal: 0,
          exportedTotal: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
        ...servicePatch,
      },
    },
  };
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for async worker task.");
}

describe("background service runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resolvePersistBundle = undefined;
    storage.queueState = createQueueState();
    storage.conversationIndex = [];
    storage.artifactIndex = [];

    vi.stubGlobal("browser", {
      alarms: {
        create: vi.fn(),
      },
      tabs: {
        create: vi.fn(async () => ({ id: 456 })),
        get: vi.fn(async (tabId: number) => {
          if (tabId === 123) {
            throw new Error("No tab with id: 123.");
          }
          return {
            id: tabId,
            status: "complete",
            title: "DeepSeek",
            url: "https://chat.deepseek.com/a/chat/s/conv-1?aiexporter_worker=1",
          };
        }),
        query: vi.fn(async () => []),
        remove: vi.fn(),
        update: vi.fn(),
      },
    });

    const bundle: ConversationBundle = {
      platform: "deepseek",
      sourceId: "conv-1",
      url: "https://chat.deepseek.com/a/chat/s/conv-1",
      title: "DeepSeek",
      extractedAt: "2026-04-24T10:00:01.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "DeepSeek" },
      ],
      messages: [{ id: "m1", role: "user", markdown: "hello" }],
    };

    tabRuntimeMocks.waitForTabComplete.mockResolvedValue(undefined);
    tabRuntimeMocks.ensureWorkerReceiver.mockResolvedValue(456);
    tabRuntimeMocks.extractConversationFromTab.mockResolvedValue(bundle);
    tabRuntimeMocks.isChallengeLikeTab.mockReturnValue(false);
    tabRuntimeMocks.closeWorkerTab.mockResolvedValue(undefined);
    const persistResult = {
      bundle,
      revision: "rev-2",
      files: ["AIexporter/deepseek/DeepSeek/DeepSeek.md"],
      downloadIds: [],
      artifactEntry: {
        platform: "deepseek",
        sourceId: "conv-1",
        revision: "rev-2",
        exportedAt: "2026-04-24T10:00:02.000Z",
        localStatus: "present",
        isLatestForConversation: true,
      },
      skipped: false,
    };
    persistenceMocks.persistBundle.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePersistBundle = () => resolve(persistResult);
        }),
    );
    persistenceMocks.markBundleExportResult.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a reused worker lease when its previous tab id is stale", async () => {
    const { createBackgroundServiceRuntime } = await import("./service-runtime");

    createBackgroundServiceRuntime().requestPlatformTick("deepseek");
    await waitForCondition(() => persistenceMocks.persistBundle.mock.calls.length > 0);

    expect(globalThis.browser.tabs.create).toHaveBeenCalledWith({
      active: false,
      pinned: true,
      url: "https://chat.deepseek.com/a/chat/s/conv-1?aiexporter_worker=1",
    });
    expect(storage.queueState?.activeWorkers).toEqual([
      expect.objectContaining({
        workerId: "worker-1",
        busy: true,
        currentQueueKey: "deepseek:conv-1:rev-1",
        tabId: 456,
      }),
    ]);

    resolvePersistBundle?.();
    await waitForCondition(() => persistenceMocks.markBundleExportResult.mock.calls.length > 0);
  });

  it("does not start Gemini best-effort discovery on resume when the cadence is still fresh", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-04-24T12:43:27.000Z"));
    storage.conversationIndex = createGeminiConversationIndex(790);
    storage.queueState = withGeminiBackfillEnabled(createQueueState(), {
      lastDiscoveryAt: undefined,
      lastExportAt: "2026-04-24T12:37:10.000Z",
      meta: {
        highestHistoricalCountSeen: 790,
        lastDiscoveryMode: "best-effort",
        lastDiscoveryQuality: "full",
      },
    });

    const { createBackgroundServiceRuntime } = await import("./service-runtime");
    const runtime = createBackgroundServiceRuntime();

    runtime.requestPlatformStartupCatchup("gemini");
    await runtime.updatePlatformDesiredRunning("gemini", true);

    await waitForCondition(() => vi.mocked(globalThis.browser.alarms.create).mock.calls.length > 0);
    expect(globalThis.browser.tabs.create).not.toHaveBeenCalled();
    expect(tabRuntimeMocks.requestTabRuntimeMessage).not.toHaveBeenCalled();

    dateNow.mockRestore();
  });

  it("keeps Gemini initial discovery on the full-bootstrap path", async () => {
    tabRuntimeMocks.waitForWorkerReady.mockResolvedValue(undefined);
    tabRuntimeMocks.requestTabRuntimeMessage.mockResolvedValue([]);
    storage.queueState = withGeminiBackfillEnabled(createQueueState());

    const { createBackgroundServiceRuntime } = await import("./service-runtime");
    const runtime = createBackgroundServiceRuntime();

    await runtime.updatePlatformDesiredRunning("gemini", true);
    await waitForCondition(() => tabRuntimeMocks.requestTabRuntimeMessage.mock.calls.length > 0);

    expect(tabRuntimeMocks.requestTabRuntimeMessage).toHaveBeenCalledWith(
      456,
      expect.objectContaining({
        type: "collect-platform-discovery",
        platform: "gemini",
        mode: "full-bootstrap",
      }),
      1,
      expect.any(Number),
    );
  });
});
