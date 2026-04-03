import type {
  ConversationIndexEntry,
  DebugState,
  ExportArtifactEntry,
  ExtensionSettings,
  PlatformRuntimeConfig,
  PlatformServiceState,
  QueueState,
} from "./types";

function createDefaultPlatformRuntimeConfig(overrides: Partial<PlatformRuntimeConfig> = {}): PlatformRuntimeConfig {
  return {
    enabled: true,
    autoExportEnabled: true,
    historyBackfillEnabled: true,
    discoveryMode: "background_backfill",
    maxConcurrency: 1,
    minStartIntervalMs: 8_000,
    navigationTimeoutMs: 30_000,
    settleDelayMs: 1_200,
    discoverySweepIntervalMs: 10 * 60 * 1_000,
    reuseWorkerTabs: true,
    bootstrapRequireFullHistory: true,
    bootstrapWindowMode: "background_tab",
    discoveryReadyTimeoutMs: 12_000,
    discoveryScrollStableRounds: 2,
    receiverReadyTimeoutMs: 5_000,
    receiverRetryLimit: 2,
    apiExtractMode: "page_world_first",
    ...overrides,
  };
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  syncToServer: false,
  serverUrl: "http://127.0.0.1:8787",
  browserLabel: "edge",
  uiLocale: "zh-CN",
  dashboardOpenBehavior: "tab",
  scheduler: {
    autoStartOnBrowserLaunch: true,
    globalPaused: false,
    logRetentionEntries: 400,
  },
  downloads: {
    mode: "downloads-api",
    hideDownloadUi: true,
    skipIfLatestExists: true,
    retainLocalRevisionCount: 1,
    openFileActionsEnabled: true,
  },
  platforms: {
    chatgpt: createDefaultPlatformRuntimeConfig({
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      bootstrapRequireFullHistory: false,
    }),
    gemini: createDefaultPlatformRuntimeConfig({
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      bootstrapRequireFullHistory: false,
      discoveryReadyTimeoutMs: 60_000,
    }),
    aistudio: createDefaultPlatformRuntimeConfig({
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      bootstrapRequireFullHistory: false,
      maxConcurrency: 1,
      discoverySweepIntervalMs: 15 * 60 * 1_000,
      discoveryReadyTimeoutMs: 45_000,
    }),
    deepseek: createDefaultPlatformRuntimeConfig({
      enabled: true,
      autoExportEnabled: true,
      historyBackfillEnabled: true,
      discoveryMode: "background_backfill",
      maxConcurrency: 2,
    }),
  },
};

export const DEFAULT_DEBUG_STATE: DebugState = {
  logs: [],
  maxEntries: 400,
};

function createDefaultPlatformServiceState(platform: PlatformServiceState["platform"]): PlatformServiceState {
  return {
    platform,
    status: "idle",
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
  };
}

export const DEFAULT_QUEUE_STATE: QueueState = {
  items: [],
  services: {
    chatgpt: createDefaultPlatformServiceState("chatgpt"),
    gemini: createDefaultPlatformServiceState("gemini"),
    aistudio: createDefaultPlatformServiceState("aistudio"),
    deepseek: createDefaultPlatformServiceState("deepseek"),
  },
  activeWorkers: [],
  settings: DEFAULT_EXTENSION_SETTINGS,
};

export const DEFAULT_CONVERSATION_INDEX: ConversationIndexEntry[] = [];
export const DEFAULT_ARTIFACT_INDEX: ExportArtifactEntry[] = [];
