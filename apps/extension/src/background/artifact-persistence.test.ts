import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueState } from "@aiexporter/adapter-sdk";
import type { ConversationBundle } from "@aiexporter/core-schema";
import { resolvePreferredConversationTitle, verifyTargetArtifactPathsPresent } from "./artifact-persistence";

function createBundle(): ConversationBundle {
  return {
    platform: "gemini",
    sourceId: "ffe8f30590386ce1",
    url: "https://gemini.google.com/app/ffe8f30590386ce1",
    title: "电偶极子电场与在外场行为",
    extractedAt: "2026-04-17T09:36:43.249Z",
    participants: [
      { id: "user", role: "user", name: "User" },
      { id: "assistant", role: "assistant", name: "Gemini" },
    ],
    messages: [
      {
        id: "user-1",
        role: "user",
        markdown: "详细讲解这道例题",
      },
      {
        id: "assistant-1",
        role: "assistant",
        markdown: "当然可以。",
      },
    ],
  };
}

function createQueueState(title: string | undefined): QueueState {
  return {
    items: title
      ? [
          {
            key: "gemini:ffe8f30590386ce1:fp-1",
            kind: "export",
            priority: "retry",
            platform: "gemini",
            status: "pending",
            attempts: 1,
            discoveredAt: "2026-04-17T09:37:16.000Z",
            updatedAt: "2026-04-17T09:51:50.000Z",
            event: {
              platform: "gemini",
              sourceId: "ffe8f30590386ce1",
              url: "https://gemini.google.com/app/ffe8f30590386ce1",
              title,
              revisionFingerprint: "fp-1",
            },
          },
        ]
      : [],
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
        status: "idle",
        desiredRunning: false,
        activeWorkers: 0,
        activeDiscoveryTabs: 0,
        stats: { discoveredTotal: 0, exportedTotal: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
      },
    },
    activeWorkers: [],
    settings: {
      syncToServer: false,
      serverUrl: "",
      browserLabel: "",
      uiLocale: "zh-CN",
      uiThemeMode: "system",
      dashboardOpenBehavior: "tab",
      scheduler: {
        autoStartOnBrowserLaunch: false,
        globalPaused: false,
        logRetentionEntries: 1000,
      },
      downloads: {
        mode: "downloads-api",
        hideDownloadUi: false,
        skipIfLatestExists: false,
        retainLocalRevisionCount: 1,
        openFileActionsEnabled: true,
      },
      platforms: {
        chatgpt: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 0,
          navigationTimeoutMs: 0,
          settleDelayMs: 0,
          discoverySweepIntervalMs: 0,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 0,
          discoveryScrollStableRounds: 0,
          discoveryDomMaxCycles: 0,
          discoveryDomPostScrollWaitMs: 0,
          discoveryDomStableCycles: 0,
          discoveryDomScrollBottomAttempts: 0,
          receiverReadyTimeoutMs: 0,
          receiverRetryLimit: 0,
          apiExtractMode: "page_world_first",
        },
        gemini: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 0,
          navigationTimeoutMs: 0,
          settleDelayMs: 0,
          discoverySweepIntervalMs: 0,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 0,
          discoveryScrollStableRounds: 0,
          discoveryDomMaxCycles: 0,
          discoveryDomPostScrollWaitMs: 0,
          discoveryDomStableCycles: 0,
          discoveryDomScrollBottomAttempts: 0,
          receiverReadyTimeoutMs: 0,
          receiverRetryLimit: 0,
          apiExtractMode: "page_world_first",
        },
        aistudio: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 0,
          navigationTimeoutMs: 0,
          settleDelayMs: 0,
          discoverySweepIntervalMs: 0,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 0,
          discoveryScrollStableRounds: 0,
          discoveryDomMaxCycles: 0,
          discoveryDomPostScrollWaitMs: 0,
          discoveryDomStableCycles: 0,
          discoveryDomScrollBottomAttempts: 0,
          receiverReadyTimeoutMs: 0,
          receiverRetryLimit: 0,
          apiExtractMode: "page_world_first",
        },
        deepseek: {
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: true,
          discoveryMode: "passive_only",
          maxConcurrency: 1,
          minStartIntervalMs: 0,
          navigationTimeoutMs: 0,
          settleDelayMs: 0,
          discoverySweepIntervalMs: 0,
          reuseWorkerTabs: true,
          bootstrapRequireFullHistory: false,
          bootstrapWindowMode: "background_tab",
          discoveryReadyTimeoutMs: 0,
          discoveryScrollStableRounds: 0,
          discoveryDomMaxCycles: 0,
          discoveryDomPostScrollWaitMs: 0,
          discoveryDomStableCycles: 0,
          discoveryDomScrollBottomAttempts: 0,
          receiverReadyTimeoutMs: 0,
          receiverRetryLimit: 0,
          apiExtractMode: "page_world_first",
        },
      },
    },
  };
}

describe("resolvePreferredConversationTitle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the indexed discovery title when the latest queue title fell back to the first prompt", () => {
    const resolved = resolvePreferredConversationTitle(
      createBundle(),
      "电偶极子电场与在外场行为",
      createQueueState("详细讲解这道例题"),
    );

    expect(resolved).toBe("电偶极子电场与在外场行为");
  });

  it("still accepts a newer queue title when it is not just the first prompt fallback", () => {
    const resolved = resolvePreferredConversationTitle(
      createBundle(),
      "电偶极子电场与在外场行为",
      createQueueState("导体静电平衡例题整理"),
    );

    expect(resolved).toBe("导体静电平衡例题整理");
  });

  it("does not treat artifacts in a different export root as reusable", async () => {
    const existingPaths = new Set([
      "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.md",
      "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.bundle.json",
    ]);

    vi.stubGlobal("chrome", {
      runtime: {
        sendNativeMessage: (
          _application: string,
          message: { action?: string; path?: string },
          callback?: (response: { ok: boolean; path?: string }) => void,
        ) => {
          if (message.action === "ping") {
            callback?.({ ok: true });
            return;
          }
          if (message.action === "path-exists") {
            callback?.({ ok: true, path: existingPaths.has(message.path ?? "") ? message.path : undefined });
            return;
          }
          callback?.({ ok: true });
        },
      },
    });

    await expect(
      verifyTargetArtifactPathsPresent({
        latestArtifact: {
          platform: "deepseek",
          sourceId: "conv-1",
          revision: "rev-1",
          exportedAt: "2026-04-21T10:00:00.000Z",
          localStatus: "present",
          isLatestForConversation: true,
          markdownFilename: "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.md",
          bundleFilename: "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.bundle.json",
        },
        settings: {
          ...createQueueState(undefined).settings,
          downloads: {
            ...createQueueState(undefined).settings.downloads,
            exportRootPath: "C:\\new-root",
          },
        },
        includeMarkdown: true,
        includeBundleJson: true,
        markdownRelativePath: "AIexporter/deepseek/Conversation/Conversation.md",
        bundleRelativePath: "AIexporter/deepseek/Conversation/Conversation.bundle.json",
      }),
    ).resolves.toBe(false);
  });

  it("allows skipping only when the selected export root already has the target files", async () => {
    const existingPaths = new Set([
      "C:\\new-root\\AIexporter\\deepseek\\Conversation\\Conversation.md",
      "C:\\new-root\\AIexporter\\deepseek\\Conversation\\Conversation.bundle.json",
    ]);

    vi.stubGlobal("chrome", {
      runtime: {
        sendNativeMessage: (
          _application: string,
          message: { action?: string; path?: string },
          callback?: (response: { ok: boolean; path?: string }) => void,
        ) => {
          if (message.action === "ping") {
            callback?.({ ok: true });
            return;
          }
          if (message.action === "path-exists") {
            callback?.({ ok: true, path: existingPaths.has(message.path ?? "") ? message.path : undefined });
            return;
          }
          callback?.({ ok: true });
        },
      },
    });

    await expect(
      verifyTargetArtifactPathsPresent({
        latestArtifact: {
          platform: "deepseek",
          sourceId: "conv-1",
          revision: "rev-1",
          exportedAt: "2026-04-21T10:00:00.000Z",
          localStatus: "present",
          isLatestForConversation: true,
          markdownFilename: "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.md",
          bundleFilename: "C:\\old-root\\AIexporter\\deepseek\\Conversation\\Conversation.bundle.json",
        },
        settings: {
          ...createQueueState(undefined).settings,
          downloads: {
            ...createQueueState(undefined).settings.downloads,
            exportRootPath: "C:\\new-root",
          },
        },
        includeMarkdown: true,
        includeBundleJson: true,
        markdownRelativePath: "AIexporter/deepseek/Conversation/Conversation.md",
        bundleRelativePath: "AIexporter/deepseek/Conversation/Conversation.bundle.json",
      }),
    ).resolves.toBe(true);
  });
});
