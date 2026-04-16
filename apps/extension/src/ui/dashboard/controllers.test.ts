import { describe, expect, it } from "vitest";
import type { DebugLogEntry, ExtensionSettings, QueueState } from "@aiexporter/adapter-sdk";
import type { DashboardStateSnapshot } from "../services/dashboard-api";
import {
  buildDashboardArtifactState,
  buildDashboardConversationIndexMap,
  buildDashboardSnapshotState,
  buildRelatedDashboardLogs,
  filterDashboardLogs,
  filterDashboardQueueItems,
  parseRelativeTimeLabel,
  sortDashboardQueueItems,
  updateDeepSeekSettingDraft,
  updateDownloadsSettingDraft,
  updateGlobalSettingDraft,
} from "./controllers";

const baseSettings: ExtensionSettings = {
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
    retainLocalRevisionCount: 2,
    openFileActionsEnabled: true,
  },
  platforms: {
    chatgpt: {
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      maxConcurrency: 1,
      minStartIntervalMs: 1000,
      navigationTimeoutMs: 1000,
      settleDelayMs: 1000,
      discoverySweepIntervalMs: 1000,
      reuseWorkerTabs: true,
      bootstrapRequireFullHistory: false,
      bootstrapWindowMode: "background_tab",
      discoveryReadyTimeoutMs: 1000,
      discoveryScrollStableRounds: 2,
      discoveryDomMaxCycles: 24,
      discoveryDomPostScrollWaitMs: 5000,
      discoveryDomStableCycles: 3,
      discoveryDomScrollBottomAttempts: 4,
      receiverReadyTimeoutMs: 1000,
      receiverRetryLimit: 1,
      apiExtractMode: "page_world_first",
    },
    gemini: {
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      maxConcurrency: 1,
      minStartIntervalMs: 1000,
      navigationTimeoutMs: 1000,
      settleDelayMs: 1000,
      discoverySweepIntervalMs: 1000,
      reuseWorkerTabs: true,
      bootstrapRequireFullHistory: false,
      bootstrapWindowMode: "background_tab",
      discoveryReadyTimeoutMs: 1000,
      discoveryScrollStableRounds: 2,
      discoveryDomMaxCycles: 200,
      discoveryDomPostScrollWaitMs: 5000,
      discoveryDomStableCycles: 3,
      discoveryDomScrollBottomAttempts: 4,
      receiverReadyTimeoutMs: 1000,
      receiverRetryLimit: 1,
      apiExtractMode: "page_world_first",
    },
    aistudio: {
      enabled: false,
      autoExportEnabled: false,
      historyBackfillEnabled: false,
      discoveryMode: "passive_only",
      maxConcurrency: 1,
      minStartIntervalMs: 1000,
      navigationTimeoutMs: 1000,
      settleDelayMs: 1000,
      discoverySweepIntervalMs: 1000,
      reuseWorkerTabs: true,
      bootstrapRequireFullHistory: false,
      bootstrapWindowMode: "background_tab",
      discoveryReadyTimeoutMs: 1000,
      discoveryScrollStableRounds: 2,
      discoveryDomMaxCycles: 24,
      discoveryDomPostScrollWaitMs: 5000,
      discoveryDomStableCycles: 3,
      discoveryDomScrollBottomAttempts: 4,
      receiverReadyTimeoutMs: 1000,
      receiverRetryLimit: 1,
      apiExtractMode: "page_world_first",
    },
    deepseek: {
      enabled: true,
      autoExportEnabled: true,
      historyBackfillEnabled: true,
      discoveryMode: "background_backfill",
      maxConcurrency: 1,
      minStartIntervalMs: 1000,
      navigationTimeoutMs: 1000,
      settleDelayMs: 1000,
      discoverySweepIntervalMs: 1000,
      reuseWorkerTabs: true,
      bootstrapRequireFullHistory: false,
      bootstrapWindowMode: "background_tab",
      discoveryReadyTimeoutMs: 1000,
      discoveryScrollStableRounds: 2,
      discoveryDomMaxCycles: 24,
      discoveryDomPostScrollWaitMs: 5000,
      discoveryDomStableCycles: 3,
      discoveryDomScrollBottomAttempts: 4,
      receiverReadyTimeoutMs: 1000,
      receiverRetryLimit: 1,
      apiExtractMode: "page_world_first",
    },
  },
};

const queueState: QueueState = {
  items: [
    {
      key: "item-1",
      event: {
        platform: "deepseek",
        sourceId: "conv-1",
        url: "https://chat.deepseek.com/a/chat/s/conv-1",
        revisionFingerprint: "fp-1",
        title: "Alpha",
      },
      kind: "discovery",
      priority: "realtime",
      platform: "deepseek",
      status: "completed",
      attempts: 1,
      discoveredAt: "2026-03-30T10:00:00.000Z",
      updatedAt: "2026-03-30T10:00:00.000Z",
      resultRevision: "rev-1",
    },
    {
      key: "item-2",
      event: {
        platform: "deepseek",
        sourceId: "conv-2",
        url: "https://chat.deepseek.com/a/chat/s/conv-2",
        revisionFingerprint: "fp-2",
        title: "Beta",
      },
      kind: "discovery",
      priority: "realtime",
      platform: "deepseek",
      status: "failed",
      attempts: 2,
      discoveredAt: "2026-03-30T10:00:00.000Z",
      updatedAt: "2026-03-30T10:00:00.000Z",
      lastError: "timeout",
      errorCode: "worker.timeout",
    },
  ],
  activeWorkers: [],
  services: {
    chatgpt: {
      platform: "chatgpt",
      status: "idle",
      desiredRunning: false,
      activeWorkers: 0,
      activeDiscoveryTabs: 0,
      stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
    },
    gemini: {
      platform: "gemini",
      status: "idle",
      desiredRunning: false,
      activeWorkers: 0,
      activeDiscoveryTabs: 0,
      stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
    },
    aistudio: {
      platform: "aistudio",
      status: "idle",
      desiredRunning: false,
      activeWorkers: 0,
      activeDiscoveryTabs: 0,
      stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
    },
    deepseek: {
      platform: "deepseek",
      status: "running",
      desiredRunning: true,
      activeWorkers: 1,
      activeDiscoveryTabs: 0,
      stats: { discoveredTotal: 2, exportedTotal: 1, pending: 0, processing: 0, completed: 1, failed: 1 },
    },
  },
  settings: baseSettings,
};

const debugLogs: DebugLogEntry[] = [
  {
    id: "log-1",
    timestamp: "2026-03-30T10:00:00.000Z",
    level: "info",
    scope: "content.deepseek",
    code: "extract.ok",
    message: "deepseek ok",
    details: { sourceId: "conv-1" },
  },
  {
    id: "log-2",
    timestamp: "2026-03-30T10:01:00.000Z",
    level: "error",
    scope: "background.chatgpt",
    code: "worker.failed",
    message: "chatgpt failed",
    details: { platform: "chatgpt" },
  },
];

describe("dashboard controllers", () => {
  it("keeps an existing settings draft during snapshot refresh", () => {
    const existingDraft = updateGlobalSettingDraft(baseSettings, "uiLocale", "en");
    const snapshot: DashboardStateSnapshot = {
      queueState,
      debugState: { logs: debugLogs, maxEntries: 500 },
      artifactIndex: [],
      conversationIndex: [],
    };

    const next = buildDashboardSnapshotState(snapshot, existingDraft);

    expect(next.settingsDraft.uiLocale).toBe("en");
    expect(next.queueState).toBe(queueState);
    expect(next.debugState.logs).toHaveLength(2);
  });

  it("filters queue items by status and search", () => {
    const filtered = filterDashboardQueueItems(queueState, {
      queueSearch: "timeout",
      queueStatusFilter: "failed",
    });

    expect(filtered.map((item) => item.key)).toEqual(["item-2"]);
  });

  it("filters logs by platform and text", () => {
    const filtered = filterDashboardLogs(debugLogs, {
      logLevels: { debug: true, info: true, warn: true, error: true },
      logSearch: "failed",
      logScopeFilter: "all",
      logPlatformFilter: "chatgpt",
      logCodeFilter: "all",
    });

    expect(filtered.map((entry) => entry.id)).toEqual(["log-2"]);
  });

  it("builds a related timeline for the same sourceId", () => {
    const related = buildRelatedDashboardLogs(
      [
        debugLogs[1]!,
        {
          id: "log-3",
          timestamp: "2026-03-30T10:00:30.000Z",
          level: "warn",
          scope: "background.queue",
          message: "queued retry",
          sourceId: "conv-1",
          traceId: "trace-1",
        },
        {
          id: "log-4",
          timestamp: "2026-03-30T10:00:45.000Z",
          level: "info",
          scope: "background.persist",
          message: "persisted",
          sourceId: "conv-1",
          traceId: "trace-1",
        },
        {
          ...debugLogs[0]!,
          sourceId: "conv-1",
          traceId: "trace-1",
        },
      ],
      {
        ...debugLogs[0]!,
        sourceId: "conv-1",
        traceId: "trace-1",
      },
    );

    expect(related.map((entry) => entry.id)).toEqual(["log-1", "log-3", "log-4"]);
  });

  it("updates nested settings drafts without mutating siblings", () => {
    const withDownloads = updateDownloadsSettingDraft(baseSettings, "openFileActionsEnabled", false);
    const withDeepSeek = updateDeepSeekSettingDraft(withDownloads, "historyBackfillEnabled", false);

    expect(withDownloads.downloads.openFileActionsEnabled).toBe(false);
    expect(withDownloads.platforms.deepseek.historyBackfillEnabled).toBe(true);
    expect(withDeepSeek.platforms.deepseek.historyBackfillEnabled).toBe(false);
  });

  it("maps openable artifact state from the latest downloadable revision", () => {
    const artifactState = buildDashboardArtifactState([
      {
        platform: "deepseek",
        sourceId: "conv-1",
        revision: "rev-1",
        markdownFilename: "a.md",
        bundleFilename: "a.bundle.json",
        markdownDownloadId: undefined,
        bundleDownloadId: 1,
        exportedAt: "2026-03-30T10:00:00.000Z",
        localStatus: "present",
      },
      {
        platform: "deepseek",
        sourceId: "conv-1",
        revision: "rev-2",
        markdownFilename: "b.md",
        bundleFilename: "b.bundle.json",
        markdownDownloadId: 2,
        bundleDownloadId: 3,
        exportedAt: "2026-03-30T10:05:00.000Z",
        localStatus: "present",
      },
    ]);

    expect(Array.from(artifactState.openableSourceIds)).toEqual(["conv-1"]);
    expect(artifactState.latestArtifacts.get("conv-1")?.revision).toBe("rev-2");
  });

  it("parses relative source updated labels for sorting", () => {
    const now = new Date("2026-04-03T12:00:00.000Z");
    expect(parseRelativeTimeLabel("6 hours ago", now)).toBe(Date.parse("2026-04-03T06:00:00.000Z"));
    expect(parseRelativeTimeLabel("Yesterday", now)).toBe(Date.parse("2026-04-02T12:00:00.000Z"));
  });

  it("sorts queue items by website time metadata", () => {
    const conversationIndexMap = buildDashboardConversationIndexMap([
      {
        platform: "deepseek",
        sourceId: "conv-1",
        title: "Alpha",
        url: "https://chat.deepseek.com/a/chat/s/conv-1",
        lastSeenAt: "2026-03-30T10:00:00.000Z",
        latestDiscoveryFingerprint: "fp-1",
        latestSourceUpdatedLabel: "6 hours ago",
        discoveryState: "complete",
        exportState: "pending",
      },
      {
        platform: "deepseek",
        sourceId: "conv-2",
        title: "Beta",
        url: "https://chat.deepseek.com/a/chat/s/conv-2",
        lastSeenAt: "2026-03-30T11:00:00.000Z",
        latestDiscoveryFingerprint: "fp-2",
        latestSourceUpdatedLabel: "2 hours ago",
        discoveryState: "complete",
        exportState: "pending",
      },
    ]);

    const sorted = sortDashboardQueueItems(
      queueState.items,
      conversationIndexMap,
      new Map(),
      "websiteTime",
      "desc",
    );

    expect(sorted.map((item) => item.event.sourceId)).toEqual(["conv-2", "conv-1"]);
  });
});
