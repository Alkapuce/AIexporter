import {
  DEFAULT_ARTIFACT_INDEX,
  DEFAULT_CONVERSATION_INDEX,
  DEFAULT_DEBUG_STATE,
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_QUEUE_STATE,
  type DebugLogEntry,
  type DebugLogInput,
  type DebugState,
  type ConversationIndexEntry,
  type ExportArtifactEntry,
  type ExportQueueItem,
  type ExtensionSettings,
  type PlatformRuntimeConfig,
  type PlatformServiceState,
  type QueueState,
  type WorkerLeaseState,
} from "@aiexporter/adapter-sdk";

const STORAGE_KEY = "aiexporter.queueState";
const DEBUG_STORAGE_KEY = "aiexporter.debugState";
const CONVERSATION_INDEX_KEY = "aiexporter.conversationIndex";
const ARTIFACT_INDEX_KEY = "aiexporter.artifactIndex";
let queueStateMutation = Promise.resolve();
let debugStateMutation = Promise.resolve();
let conversationIndexMutation = Promise.resolve();
let artifactIndexMutation = Promise.resolve();

function enqueueSerializedMutation<T>(
  kind: "queue" | "debug" | "conversationIndex" | "artifactIndex",
  task: () => Promise<T>,
): Promise<T> {
  const currentChain =
    kind === "queue"
      ? queueStateMutation
      : kind === "debug"
        ? debugStateMutation
        : kind === "conversationIndex"
          ? conversationIndexMutation
          : artifactIndexMutation;
  const nextTask = currentChain.then(task, task);
  const settled = nextTask.then(
    () => undefined,
    () => undefined,
  );

  if (kind === "queue") {
    queueStateMutation = settled;
  } else if (kind === "debug") {
    debugStateMutation = settled;
  } else if (kind === "conversationIndex") {
    conversationIndexMutation = settled;
  } else {
    artifactIndexMutation = settled;
  }

  return nextTask;
}

function normalizePlatformConfig(raw: Partial<PlatformRuntimeConfig> | undefined, fallback: PlatformRuntimeConfig): PlatformRuntimeConfig {
  return {
    ...fallback,
    ...(raw ?? {}),
    bootstrapWindowMode: "background_tab",
  };
}

function normalizeService(raw: Partial<PlatformServiceState> | undefined, fallback: PlatformServiceState): PlatformServiceState {
  return {
    ...fallback,
    ...(raw ?? {}),
    stats: {
      ...fallback.stats,
      ...(raw?.stats ?? {}),
    },
  };
}

function normalizeState(raw: unknown): QueueState {
  const candidate = raw as Partial<QueueState> | undefined;
  const exportRootPath =
    typeof candidate?.settings?.downloads?.exportRootPath === "string" &&
    candidate.settings.downloads.exportRootPath.trim().length > 0
      ? candidate.settings.downloads.exportRootPath.trim()
      : undefined;
  const revisionHistoryMode = candidate?.settings?.downloads?.revisionHistoryMode;
  const archiveRetentionDays = candidate?.settings?.downloads?.archiveRetentionDays;
  return {
    items: Array.isArray(candidate?.items)
      ? (candidate.items as ExportQueueItem[]).map((item) => ({
          ...item,
          platform: item.platform ?? item.event?.platform,
        }))
      : DEFAULT_QUEUE_STATE.items,
    services: {
      chatgpt: normalizeService(candidate?.services?.chatgpt, DEFAULT_QUEUE_STATE.services.chatgpt),
      gemini: normalizeService(candidate?.services?.gemini, DEFAULT_QUEUE_STATE.services.gemini),
      aistudio: normalizeService(candidate?.services?.aistudio, DEFAULT_QUEUE_STATE.services.aistudio),
      deepseek: normalizeService(candidate?.services?.deepseek, DEFAULT_QUEUE_STATE.services.deepseek),
    },
    activeWorkers: Array.isArray(candidate?.activeWorkers) ? (candidate.activeWorkers as WorkerLeaseState[]) : [],
    settings: {
      ...DEFAULT_EXTENSION_SETTINGS,
      ...(candidate?.settings as Partial<ExtensionSettings> | undefined),
      scheduler: {
        ...DEFAULT_EXTENSION_SETTINGS.scheduler,
        ...(candidate?.settings?.scheduler ?? {}),
      },
      downloads: {
        ...DEFAULT_EXTENSION_SETTINGS.downloads,
        ...(candidate?.settings?.downloads ?? {}),
        exportRootPath,
        revisionHistoryMode:
          revisionHistoryMode === "disabled" ||
          revisionHistoryMode === "recycle_previous" ||
          revisionHistoryMode === "archive_then_recycle"
            ? revisionHistoryMode
            : DEFAULT_EXTENSION_SETTINGS.downloads.revisionHistoryMode,
        archiveRetentionDays:
          typeof archiveRetentionDays === "number" && Number.isFinite(archiveRetentionDays)
            ? Math.max(1, Math.floor(archiveRetentionDays))
            : DEFAULT_EXTENSION_SETTINGS.downloads.archiveRetentionDays,
      },
      platforms: {
        chatgpt: normalizePlatformConfig(candidate?.settings?.platforms?.chatgpt, DEFAULT_EXTENSION_SETTINGS.platforms.chatgpt),
        gemini: normalizePlatformConfig(candidate?.settings?.platforms?.gemini, DEFAULT_EXTENSION_SETTINGS.platforms.gemini),
        aistudio: normalizePlatformConfig(candidate?.settings?.platforms?.aistudio, DEFAULT_EXTENSION_SETTINGS.platforms.aistudio),
        deepseek: normalizePlatformConfig(candidate?.settings?.platforms?.deepseek, DEFAULT_EXTENSION_SETTINGS.platforms.deepseek),
      },
    },
    lastProcessedAt: candidate?.lastProcessedAt,
  };
}

function normalizeDebugState(raw: unknown): DebugState {
  const candidate = raw as Partial<DebugState> | undefined;
  return {
    logs: Array.isArray(candidate?.logs) ? (candidate.logs as DebugLogEntry[]) : [],
    maxEntries:
      typeof candidate?.maxEntries === "number" && Number.isFinite(candidate.maxEntries)
        ? Math.max(50, Math.floor(candidate.maxEntries))
        : DEFAULT_DEBUG_STATE.maxEntries,
    lastUpdatedAt: candidate?.lastUpdatedAt,
  };
}

function normalizeConversationIndex(raw: unknown): ConversationIndexEntry[] {
  if (!Array.isArray(raw)) return DEFAULT_CONVERSATION_INDEX;
  return (raw as Array<ConversationIndexEntry & { latestExporterVersion?: string }>).map((entry) => ({
    ...entry,
    latestExportCompatibilityVersion:
      entry.latestExportCompatibilityVersion ?? entry.latestExporterVersion,
  }));
}

function normalizeArtifactIndex(raw: unknown): ExportArtifactEntry[] {
  return Array.isArray(raw) ? (raw as ExportArtifactEntry[]) : DEFAULT_ARTIFACT_INDEX;
}

export async function loadQueueState(): Promise<QueueState> {
  const raw = await browser.storage.local.get(STORAGE_KEY);
  return normalizeState(raw[STORAGE_KEY]);
}

export async function saveQueueState(state: QueueState): Promise<QueueState> {
  return enqueueSerializedMutation("queue", async () => {
    await browser.storage.local.set({ [STORAGE_KEY]: state });
    return state;
  });
}

export async function loadDebugState(): Promise<DebugState> {
  const raw = await browser.storage.local.get(DEBUG_STORAGE_KEY);
  return normalizeDebugState(raw[DEBUG_STORAGE_KEY]);
}

export async function loadConversationIndex(): Promise<ConversationIndexEntry[]> {
  const raw = await browser.storage.local.get(CONVERSATION_INDEX_KEY);
  return normalizeConversationIndex(raw[CONVERSATION_INDEX_KEY]);
}

export async function loadArtifactIndex(): Promise<ExportArtifactEntry[]> {
  const raw = await browser.storage.local.get(ARTIFACT_INDEX_KEY);
  return normalizeArtifactIndex(raw[ARTIFACT_INDEX_KEY]);
}

export async function saveDebugState(state: DebugState): Promise<DebugState> {
  return enqueueSerializedMutation("debug", async () => {
    await browser.storage.local.set({ [DEBUG_STORAGE_KEY]: state });
    return state;
  });
}

export async function saveConversationIndex(entries: ConversationIndexEntry[]): Promise<ConversationIndexEntry[]> {
  return enqueueSerializedMutation("conversationIndex", async () => {
    await browser.storage.local.set({ [CONVERSATION_INDEX_KEY]: entries });
    return entries;
  });
}

export async function saveArtifactIndex(entries: ExportArtifactEntry[]): Promise<ExportArtifactEntry[]> {
  return enqueueSerializedMutation("artifactIndex", async () => {
    await browser.storage.local.set({ [ARTIFACT_INDEX_KEY]: entries });
    return entries;
  });
}

export async function updateQueueState(
  updater: (state: QueueState) => QueueState | Promise<QueueState>,
): Promise<QueueState> {
  return enqueueSerializedMutation("queue", async () => {
    const current = await loadQueueState();
    const next = await updater(current);
    await browser.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
}

export async function updateConversationIndex(
  updater: (entries: ConversationIndexEntry[]) => ConversationIndexEntry[] | Promise<ConversationIndexEntry[]>,
): Promise<ConversationIndexEntry[]> {
  return enqueueSerializedMutation("conversationIndex", async () => {
    const current = await loadConversationIndex();
    const next = await updater(current);
    await browser.storage.local.set({ [CONVERSATION_INDEX_KEY]: next });
    return next;
  });
}

export async function updateArtifactIndex(
  updater: (entries: ExportArtifactEntry[]) => ExportArtifactEntry[] | Promise<ExportArtifactEntry[]>,
): Promise<ExportArtifactEntry[]> {
  return enqueueSerializedMutation("artifactIndex", async () => {
    const current = await loadArtifactIndex();
    const next = await updater(current);
    await browser.storage.local.set({ [ARTIFACT_INDEX_KEY]: next });
    return next;
  });
}

export async function appendDebugLog(entry: DebugLogInput): Promise<DebugState> {
  return appendDebugLogs([entry]);
}

export async function appendDebugLogs(entries: DebugLogInput[]): Promise<DebugState> {
  if (entries.length === 0) {
    return loadDebugState();
  }

  return enqueueSerializedMutation("debug", async () => {
    const current = await loadDebugState();
    const nextEntries: DebugLogEntry[] = entries.map((entry) => ({
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }));
    const logs = [...nextEntries.reverse(), ...current.logs].slice(0, current.maxEntries);
    const nextState = {
      ...current,
      logs,
      lastUpdatedAt: nextEntries[nextEntries.length - 1]?.timestamp ?? current.lastUpdatedAt,
    };
    await browser.storage.local.set({ [DEBUG_STORAGE_KEY]: nextState });
    return nextState;
  });
}

export async function clearDebugState(): Promise<DebugState> {
  return enqueueSerializedMutation("debug", async () => {
    const nextState = {
      ...DEFAULT_DEBUG_STATE,
      lastUpdatedAt: new Date().toISOString(),
    };
    await browser.storage.local.set({ [DEBUG_STORAGE_KEY]: nextState });
    return nextState;
  });
}

export async function clearConversationIndex(): Promise<ConversationIndexEntry[]> {
  return saveConversationIndex(DEFAULT_CONVERSATION_INDEX);
}

export async function clearArtifactIndex(): Promise<ExportArtifactEntry[]> {
  return saveArtifactIndex(DEFAULT_ARTIFACT_INDEX);
}
