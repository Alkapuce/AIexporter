import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  type ConversationIndexEntry,
  type ExportArtifactEntry,
} from "@aiexporter/adapter-sdk";
import type { ConversationBundle } from "@aiexporter/core-schema";

const storage = vi.hoisted(() => ({
  artifactIndex: [] as ExportArtifactEntry[],
  conversationIndex: [] as ConversationIndexEntry[],
}));

const nativeHostMocks = vi.hoisted(() => ({
  checkPathExistsWithNativeHost: vi.fn(),
  listFilesWithNativeHost: vi.fn(),
  movePathWithNativeHost: vi.fn(),
  pingNativeHost: vi.fn(),
  readFileWithNativeHost: vi.fn(),
  resolveExportRootWithNativeHost: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
  verifyArtifactFilesPresent: vi.fn(),
}));

const existingPaths = vi.hoisted(() => new Set<string>());

vi.mock("../runtime/storage", () => ({
  loadArtifactIndex: vi.fn(async () => storage.artifactIndex),
  loadConversationIndex: vi.fn(async () => storage.conversationIndex),
  saveArtifactIndex: vi.fn(async (entries: ExportArtifactEntry[]) => {
    storage.artifactIndex = entries;
    return entries;
  }),
  saveConversationIndex: vi.fn(async (entries: ConversationIndexEntry[]) => {
    storage.conversationIndex = entries;
    return entries;
  }),
}));

vi.mock("../runtime/native-host", () => nativeHostMocks);

vi.mock("./artifact-persistence", () => ({
  verifyArtifactFilesPresent: persistenceMocks.verifyArtifactFilesPresent,
}));

const settings = {
  ...DEFAULT_EXTENSION_SETTINGS,
  downloads: {
    ...DEFAULT_EXTENSION_SETTINGS.downloads,
    exportRootPath: "C:\\exports",
  },
};

function normalizePath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

function createBundle(
  overrides: Partial<ConversationBundle> = {},
): ConversationBundle {
  return {
    platform: "gemini",
    sourceId: "conv123456",
    url: "https://gemini.google.com/app/conv123456",
    title: "Disk Conversation",
    extractedAt: "2026-04-24T10:00:00.000Z",
    participants: [
      { id: "user", role: "user", name: "User" },
      { id: "assistant", role: "assistant", name: "Gemini" },
    ],
    messages: [{ id: "m1", role: "user", markdown: "hello" }],
    meta: {
      revision: "rev-disk",
      exportCompatibilityVersion: "compat-1",
    },
    ...overrides,
  };
}

function createConversationIndexEntry(
  overrides: Partial<ConversationIndexEntry> = {},
): ConversationIndexEntry {
  return {
    platform: "gemini",
    sourceId: "conv-1",
    title: "Indexed conversation",
    url: "https://gemini.google.com/app/conv-1",
    lastSeenAt: "2026-04-24T09:00:00.000Z",
    latestDiscoveryFingerprint: "fingerprint-latest",
    discoveryState: "complete",
    exportState: "exported",
    latestExportRevision: "rev-latest",
    latestExportCompatibilityVersion: "compat-1",
    ...overrides,
  };
}

describe("syncArtifactsWithDisk", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existingPaths.clear();
    storage.artifactIndex = [];
    storage.conversationIndex = [];

    nativeHostMocks.pingNativeHost.mockResolvedValue({ ok: true });
    nativeHostMocks.resolveExportRootWithNativeHost.mockResolvedValue({
      ok: true,
      path: "C:\\exports",
    });
    nativeHostMocks.listFilesWithNativeHost.mockResolvedValue({
      ok: true,
      paths: [],
    });
    nativeHostMocks.movePathWithNativeHost.mockResolvedValue({
      ok: true,
      path: "C:\\moved",
    });
    nativeHostMocks.readFileWithNativeHost.mockResolvedValue({
      ok: true,
      content: "",
    });
    nativeHostMocks.checkPathExistsWithNativeHost.mockImplementation(
      async (path: string) => ({
        ok: true,
        path: existingPaths.has(normalizePath(path)) ? path : undefined,
      }),
    );
    persistenceMocks.verifyArtifactFilesPresent.mockResolvedValue(true);
  });

  it("does not requeue a conversation when only an older non-latest artifact is missing", async () => {
    storage.artifactIndex = [
      {
        platform: "gemini",
        sourceId: "conv-1",
        revision: "rev-old",
        markdownFilename: "C:\\exports\\old.md",
        exportedAt: "2026-04-20T10:00:00.000Z",
        localStatus: "present",
        isLatestForConversation: false,
      },
      {
        platform: "gemini",
        sourceId: "conv-1",
        revision: "rev-latest",
        markdownFilename: "C:\\exports\\latest.md",
        exportedAt: "2026-04-21T10:00:00.000Z",
        localStatus: "present",
        isLatestForConversation: true,
      },
    ];
    storage.conversationIndex = [createConversationIndexEntry()];
    persistenceMocks.verifyArtifactFilesPresent.mockImplementation(
      async (entry: ExportArtifactEntry) => entry.revision === "rev-latest",
    );

    const { syncArtifactsWithDisk } = await import("./artifact-sync");
    const result = await syncArtifactsWithDisk(settings, "gemini");

    expect(result.missingCount).toBe(1);
    expect(result.requeueEvents).toEqual([]);
    expect(storage.conversationIndex[0]?.exportState).toBe("exported");
    expect(
      storage.artifactIndex.find((entry) => entry.revision === "rev-old")
        ?.localStatus,
    ).toBe("missing");
    expect(
      storage.artifactIndex.find((entry) => entry.revision === "rev-latest")
        ?.isLatestForConversation,
    ).toBe(true);
  });

  it("imports bundle files from disk and marks their markdown as present", async () => {
    const bundlePath =
      "C:\\exports\\AIexporter\\gemini\\Disk Conversation__conv1234\\Disk Conversation.bundle.json";
    const markdownPath =
      "C:\\exports\\AIexporter\\gemini\\Disk Conversation__conv1234\\Disk Conversation.md";
    existingPaths.add(normalizePath(markdownPath));
    nativeHostMocks.listFilesWithNativeHost.mockResolvedValue({
      ok: true,
      paths: [bundlePath],
    });
    nativeHostMocks.readFileWithNativeHost.mockResolvedValue({
      ok: true,
      content: JSON.stringify(createBundle()),
    });

    const { syncArtifactsWithDisk } = await import("./artifact-sync");
    const result = await syncArtifactsWithDisk(settings, "gemini");

    expect(result.importedCount).toBe(1);
    expect(result.missingCount).toBe(0);
    expect(storage.artifactIndex).toEqual([
      expect.objectContaining({
        platform: "gemini",
        sourceId: "conv123456",
        revision: "rev-disk",
        markdownFilename: markdownPath,
        bundleFilename: bundlePath,
        localStatus: "present",
        isLatestForConversation: true,
      }),
    ]);
    expect(storage.conversationIndex[0]).toEqual(
      expect.objectContaining({
        platform: "gemini",
        sourceId: "conv123456",
        exportState: "exported",
        latestExportRevision: "rev-disk",
      }),
    );
  });

  it("skips bundle files whose embedded platform is outside the requested sync scope", async () => {
    const bundlePath =
      "C:\\exports\\AIexporter\\gemini\\Misfiled Conversation__chatgpt1\\Misfiled Conversation.bundle.json";
    const chatgptBundle = createBundle({
      platform: "chatgpt",
      sourceId: "chatgpt-1",
      url: "https://chatgpt.com/c/chatgpt-1",
      title: "Misfiled Conversation",
    });
    nativeHostMocks.listFilesWithNativeHost.mockResolvedValue({
      ok: true,
      paths: [bundlePath],
    });
    nativeHostMocks.readFileWithNativeHost.mockResolvedValue({
      ok: true,
      content: JSON.stringify(chatgptBundle),
    });

    const { syncArtifactsWithDisk } = await import("./artifact-sync");
    const result = await syncArtifactsWithDisk(settings, "gemini");

    expect(result.importedCount).toBe(0);
    expect(storage.artifactIndex).toEqual([]);
    expect(storage.conversationIndex).toEqual([]);
    expect(nativeHostMocks.movePathWithNativeHost).not.toHaveBeenCalled();
  });

  it("does not move a legacy revision folder into its parent conversation folder", async () => {
    const bundlePath =
      "C:\\exports\\AIexporter\\gemini\\Disk Conversation__conv1234\\rev-disk\\Disk Conversation.bundle.json";
    const markdownPath =
      "C:\\exports\\AIexporter\\gemini\\Disk Conversation__conv1234\\rev-disk\\Disk Conversation.md";
    existingPaths.add(normalizePath(markdownPath));
    nativeHostMocks.listFilesWithNativeHost.mockResolvedValue({
      ok: true,
      paths: [bundlePath],
    });
    nativeHostMocks.readFileWithNativeHost.mockResolvedValue({
      ok: true,
      content: JSON.stringify(createBundle()),
    });

    const { syncArtifactsWithDisk } = await import("./artifact-sync");
    await syncArtifactsWithDisk(settings, "gemini");

    expect(nativeHostMocks.movePathWithNativeHost).not.toHaveBeenCalled();
    expect(storage.artifactIndex[0]).toEqual(
      expect.objectContaining({
        markdownFilename: markdownPath,
        bundleFilename: bundlePath,
        localStatus: "present",
      }),
    );
  });
});
