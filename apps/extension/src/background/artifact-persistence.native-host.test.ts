import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueState } from "@aiexporter/adapter-sdk";
import type { ConversationBundle } from "@aiexporter/core-schema";

const writtenPaths = new Set<string>();
const writtenFileContents = new Map<string, string>();
const downloadBinaryAsset = vi.fn();
const downloadRemoteAsset = vi.fn();
const downloadTextAsset = vi.fn();
const isDownloadedAssetPresent = vi.fn().mockResolvedValue(false);
const openDownloadedAsset = vi.fn();
const removeDownloadedAsset = vi.fn();
const showDownloadedAsset = vi.fn();
const writeBackgroundLog = vi.fn().mockResolvedValue(undefined);
const syncBundleToServer = vi.fn().mockResolvedValue(undefined);
const loadArtifactIndex = vi.fn().mockResolvedValue([]);
const loadConversationIndex = vi.fn().mockResolvedValue([]);
const updateArtifactIndex = vi.fn().mockImplementation(async (updater: (entries: never[]) => unknown) => updater([]));
const updateConversationIndex = vi.fn();
const loadQueueState = vi.fn();
const pingNativeHost = vi.fn().mockResolvedValue({ ok: true });
const writeFileWithNativeHost = vi
  .fn()
  .mockImplementation(async (relativePath: string, content: string, encoding: "utf8" | "base64", rootPath?: string) => {
    const resolvedRoot = rootPath ?? "C:\\Users\\TestUser\\Downloads";
    const resolvedPath = `${resolvedRoot.replace(/[\\/]+$/, "")}\\${relativePath.replace(/\//g, "\\")}`;
    writtenPaths.add(resolvedPath.toLowerCase());
    writtenFileContents.set(resolvedPath.toLowerCase(), content);
    return {
      ok: true,
      path: resolvedPath,
      content,
      encoding,
    };
  });
const checkPathExistsWithNativeHost = vi.fn().mockImplementation(async (path: string) => ({
  ok: true,
  path: writtenPaths.has(path.toLowerCase()) ? path : undefined,
}));
const movePathWithNativeHost = vi.fn();
const openFileWithNativeHost = vi.fn();
const pruneOldFilesWithNativeHost = vi.fn();
const recyclePathWithNativeHost = vi.fn();
const relocateFileWithNativeHost = vi.fn();
const showFolderWithNativeHost = vi.fn();
const refreshQueueServices = vi.fn().mockResolvedValue(undefined);

vi.mock("../runtime/downloads", () => ({
  downloadBinaryAsset,
  downloadRemoteAsset,
  downloadTextAsset,
  isDownloadedAssetPresent,
  openDownloadedAsset,
  removeDownloadedAsset,
  showDownloadedAsset,
}));

vi.mock("../runtime/logger", () => ({
  writeBackgroundLog,
}));

vi.mock("../runtime/server-sync", () => ({
  syncBundleToServer,
}));

vi.mock("../runtime/storage", () => ({
  loadArtifactIndex,
  loadConversationIndex,
  loadQueueState,
  updateArtifactIndex,
  updateConversationIndex,
}));

vi.mock("../runtime/native-host", () => ({
  checkPathExistsWithNativeHost,
  movePathWithNativeHost,
  openFileWithNativeHost,
  pingNativeHost,
  pruneOldFilesWithNativeHost,
  recyclePathWithNativeHost,
  relocateFileWithNativeHost,
  showFolderWithNativeHost,
  writeFileWithNativeHost,
}));

vi.mock("./state-access", () => ({
  refreshQueueServices,
}));

function createDefaultTestPlatformConfig() {
  return {
    enabled: true,
    autoExportEnabled: true,
    historyBackfillEnabled: true,
    discoveryMode: "passive_only" as const,
    maxConcurrency: 1,
    minStartIntervalMs: 0,
    navigationTimeoutMs: 0,
    settleDelayMs: 0,
    discoverySweepIntervalMs: 0,
    reuseWorkerTabs: true,
    bootstrapRequireFullHistory: false,
    bootstrapWindowMode: "background_tab" as const,
    discoveryReadyTimeoutMs: 0,
    discoveryScrollStableRounds: 0,
    discoveryDomMaxCycles: 0,
    discoveryDomPostScrollWaitMs: 0,
    discoveryDomStableCycles: 0,
    discoveryDomScrollBottomAttempts: 0,
    receiverReadyTimeoutMs: 0,
    receiverRetryLimit: 0,
    apiExtractMode: "page_world_first" as const,
  };
}

function createQueueState(exportRootPath?: string): QueueState {
  return {
    items: [],
    activeWorkers: [],
    lastProcessedAt: undefined,
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
        hideDownloadUi: true,
        skipIfLatestExists: false,
        retainLocalRevisionCount: 1,
        openFileActionsEnabled: true,
        exportRootPath,
      },
      platforms: {
        chatgpt: createDefaultTestPlatformConfig(),
        gemini: createDefaultTestPlatformConfig(),
        aistudio: createDefaultTestPlatformConfig(),
        deepseek: createDefaultTestPlatformConfig(),
      },
    },
    services: {
      chatgpt: {
        platform: "chatgpt",
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
      },
      gemini: {
        platform: "gemini",
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
      },
      aistudio: {
        platform: "aistudio",
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
      },
      deepseek: {
        platform: "deepseek",
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
      },
    },
  };
}

function createBundle(): ConversationBundle {
  return {
    platform: "gemini",
    sourceId: "ffe8f30590386ce1",
    url: "https://gemini.google.com/app/ffe8f30590386ce1",
    title: "Remote Asset Conversation",
    extractedAt: "2026-04-21T09:36:43.249Z",
    participants: [
      { id: "user", role: "user", name: "User" },
      { id: "assistant", role: "assistant", name: "Gemini" },
    ],
    messages: [
      {
        id: "user-1",
        role: "user",
        markdown: "请导出这张图",
      },
      {
        id: "assistant-1",
        role: "assistant",
        markdown: "![diagram](https://example.com/assets/diagram.png)",
      },
    ],
  };
}

function createFallbackTitleBundle(): ConversationBundle {
  return {
    platform: "gemini",
    sourceId: "fallback-title-conv",
    url: "https://gemini.google.com/app/fallback-title-conv",
    title: "Gemini",
    extractedAt: "2026-04-21T09:36:43.249Z",
    participants: [
      { id: "user", role: "user", name: "User" },
      { id: "assistant", role: "assistant", name: "Gemini" },
    ],
    messages: [
      {
        id: "user-1",
        role: "user",
        markdown: "请非常详细地系统讲解一下麦克斯韦方程组在不同介质边界条件下的推导过程、物理意义、典型例题和常见误区",
      },
      {
        id: "assistant-1",
        role: "assistant",
        markdown: "当然可以。",
      },
    ],
  };
}

describe("persistBundle native host persistence", () => {
  beforeEach(() => {
    writtenPaths.clear();
    writtenFileContents.clear();
    vi.clearAllMocks();
    loadArtifactIndex.mockResolvedValue([]);
    loadConversationIndex.mockResolvedValue([]);
    updateArtifactIndex.mockImplementation(async (updater: (entries: never[]) => unknown) => updater([]));
    loadQueueState.mockResolvedValue(createQueueState("C:\\exports"));
    pingNativeHost.mockResolvedValue({ ok: true });
    writeFileWithNativeHost.mockImplementation(
      async (relativePath: string, content: string, encoding: "utf8" | "base64", rootPath?: string) => {
        const resolvedRoot = rootPath ?? "C:\\Users\\TestUser\\Downloads";
        const resolvedPath = `${resolvedRoot.replace(/[\\/]+$/, "")}\\${relativePath.replace(/\//g, "\\")}`;
        writtenPaths.add(resolvedPath.toLowerCase());
        writtenFileContents.set(resolvedPath.toLowerCase(), content);
        return {
          ok: true,
          path: resolvedPath,
          content,
          encoding,
        };
      },
    );
    checkPathExistsWithNativeHost.mockImplementation(async (path: string) => ({
      ok: true,
      path: writtenPaths.has(path.toLowerCase()) ? path : undefined,
    }));
    downloadRemoteAsset.mockImplementation(
      async (relativePath: string, _url: string, _options: { forceFresh?: boolean } = {}, rootPath?: string) => {
        const resolvedRoot = rootPath ?? "C:\\Users\\TestUser\\Downloads";
        const resolvedPath = `${resolvedRoot.replace(/[\\/]+$/, "")}\\${relativePath.replace(/\//g, "\\")}`;
        writtenPaths.add(resolvedPath.toLowerCase());
        return {
          downloadId: 1001,
          filename: resolvedPath,
        };
      },
    );
    vi.stubGlobal("browser", {
      runtime: {
        getManifest: () => ({
          version: "0.2.2",
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes text artifacts and fetched remote assets through native host", async () => {
    const { persistBundle } = await import("./artifact-persistence");

    const result = await persistBundle(createBundle(), createQueueState("C:\\exports").settings);

    expect(writeFileWithNativeHost).toHaveBeenCalledTimes(3);
    expect(writeFileWithNativeHost).toHaveBeenCalledWith(
      expect.stringMatching(/^AIexporter\/gemini\/.+\.md$/),
      expect.any(String),
      "utf8",
      "C:\\exports",
    );
    expect(writeFileWithNativeHost).toHaveBeenCalledWith(
      expect.stringMatching(/^AIexporter\/gemini\/.+\.bundle\.json$/),
      expect.any(String),
      "utf8",
      "C:\\exports",
    );
    expect(writeFileWithNativeHost).toHaveBeenCalledWith(
      expect.stringMatching(/^AIexporter\/gemini\/.+\/assets\/01-diagram\.png$/),
      "AQIDBA==",
      "base64",
      "C:\\exports",
    );
    expect(fetch).toHaveBeenCalledWith("https://example.com/assets/diagram.png", {
      credentials: "include",
    });
    expect(downloadRemoteAsset).not.toHaveBeenCalled();
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^C:\\exports\\AIexporter\\gemini\\.+\.md$/),
        expect.stringMatching(/^C:\\exports\\AIexporter\\gemini\\.+\.bundle\.json$/),
        expect.stringMatching(/^C:\\exports\\AIexporter\\gemini\\.+\\assets\\01-diagram\.png$/),
      ]),
    );
  });

  it("allows exporting with a fallback prompt title instead of throwing", async () => {
    const { persistBundle } = await import("./artifact-persistence");

    await expect(
      persistBundle(createFallbackTitleBundle(), createQueueState("C:\\exports").settings),
    ).resolves.toMatchObject({
      bundle: {
        title: "请非常详细地系统讲解一下麦克斯韦方程组在不同介质边界条件下的推导过程、物理意义、典型例题和常见误",
      },
    });
  });

  it("uses a document-specific asset directory for flat output exports", async () => {
    const { persistBundle } = await import("./artifact-persistence");

    await persistBundle(createBundle(), createQueueState("C:\\exports").settings, {}, { flatOutput: true });

    expect(writeFileWithNativeHost).toHaveBeenCalledWith(
      "Remote Asset Conversation.md",
      expect.any(String),
      "utf8",
      "C:\\exports",
    );
    expect(writeFileWithNativeHost).toHaveBeenCalledWith(
      "Remote Asset Conversation.assets/01-diagram.png",
      "AQIDBA==",
      "base64",
      "C:\\exports",
    );
    expect(downloadRemoteAsset).not.toHaveBeenCalled();
  });

  it("keeps original remote image URLs when remote asset persistence fails", async () => {
    const { persistBundle } = await import("./artifact-persistence");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: {
          get: () => "text/html; charset=utf-8",
        },
        arrayBuffer: async () => Uint8Array.from([]).buffer,
      }),
    );
    const result = await persistBundle(createBundle(), createQueueState("C:\\exports").settings);

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^C:\\exports\\AIexporter\\gemini\\.+\.md$/),
        expect.stringMatching(/^C:\\exports\\AIexporter\\gemini\\.+\.bundle\.json$/),
      ]),
    );
    expect(result.files).toHaveLength(2);
    expect(downloadRemoteAsset).not.toHaveBeenCalled();

    const markdownPath = result.files.find((value) => value.endsWith(".md"));
    const bundlePath = result.files.find((value) => value.endsWith(".bundle.json"));
    expect(markdownPath).toBeTruthy();
    expect(bundlePath).toBeTruthy();

    const markdownContent = writtenFileContents.get(markdownPath!.toLowerCase());
    const bundleContent = writtenFileContents.get(bundlePath!.toLowerCase());
    expect(markdownContent).toContain("https://example.com/assets/diagram.png");
    expect(markdownContent).not.toContain("assets/01-diagram.png");
    expect(bundleContent).toContain("https://example.com/assets/diagram.png");
    expect(bundleContent).not.toContain('"path": "assets/01-diagram.png"');
  });
});
