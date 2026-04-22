import type {
  ConversationIndexEntry,
  DebugState,
  ExtensionSettings,
  ExportArtifactEntry,
  ManualExportOptions,
  PlatformRuntimeConfig,
  QueueItemStatus,
  QueueState,
  RuntimeMessage,
} from "@aiexporter/adapter-sdk";
import { normalizeConversationUrl, type SourcePlatform } from "@aiexporter/core-schema";

export interface DashboardStateSnapshot {
  queueState: QueueState;
  debugState: DebugState;
  artifactIndex: ExportArtifactEntry[];
  conversationIndex: ConversationIndexEntry[];
}

export interface ActiveConversationTarget {
  tabId?: number;
  url?: string;
  title?: string;
  platform?: SourcePlatform;
  supported: boolean;
}

function inferPlatformFromUrl(url: string | undefined): SourcePlatform | undefined {
  if (!url) return undefined;
  if (/^https:\/\/chatgpt\.com\/c\//i.test(url)) return "chatgpt";
  if (/^https:\/\/chat\.deepseek\.com\/a\/chat\//i.test(url)) return "deepseek";
  if (/^https:\/\/gemini\.google\.com\/app\//i.test(url)) return "gemini";
  if (/^https:\/\/aistudio\.google\.com\/prompts\/(?!new_chat)/i.test(url)) return "aistudio";
  return undefined;
}

async function sendMessage<T>(message: RuntimeMessage, timeoutMs = 10_000): Promise<T> {
  const response = await Promise.race([
    browser.runtime.sendMessage(message),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Background request timed out: ${message.type}`)), timeoutMs);
    }),
  ]);
  if (response && typeof response === "object" && "__aiexporterError" in (response as Record<string, unknown>)) {
    throw new Error(
      typeof (response as { __aiexporterError?: unknown }).__aiexporterError === "string"
        ? ((response as { __aiexporterError?: string }).__aiexporterError as string)
        : "Background request failed.",
    );
  }
  return response as T;
}

export async function fetchDashboardState(): Promise<DashboardStateSnapshot> {
  const [queueState, debugState, artifactRaw, conversationRaw] = await Promise.all([
    sendMessage<QueueState>({ type: "queue-state-request" }),
    sendMessage<DebugState>({ type: "debug-state-request" }),
    browser.storage.local.get("aiexporter.artifactIndex"),
    browser.storage.local.get("aiexporter.conversationIndex"),
  ]);

  const artifactIndex = Array.isArray(artifactRaw["aiexporter.artifactIndex"])
    ? (artifactRaw["aiexporter.artifactIndex"] as ExportArtifactEntry[])
    : [];
  const conversationIndex = Array.isArray(conversationRaw["aiexporter.conversationIndex"])
    ? (conversationRaw["aiexporter.conversationIndex"] as ConversationIndexEntry[])
    : [];

  return { queueState, debugState, artifactIndex, conversationIndex };
}

export function requestQueueState(): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-state-request" });
}

export function requestDebugState(): Promise<DebugState> {
  return sendMessage<DebugState>({ type: "debug-state-request" });
}

export function updateSettings(settings: Partial<ExtensionSettings>): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "settings-update", settings });
}

export function updatePlatformSettings(
  platform: SourcePlatform,
  settings: Partial<PlatformRuntimeConfig>,
): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "platform-settings-update", platform, settings });
}

export function pausePlatform(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "service-pause", platform });
}

export function resumePlatform(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "service-resume", platform });
}

export function runDiscovery(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "service-discovery-run", platform });
}

export function runFullBootstrap(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "service-full-bootstrap-run", platform });
}

export function processQueue(): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-process-request" });
}

export function retryFailed(): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-retry-request" });
}

export function clearQueueStatuses(
  statuses: QueueItemStatus[],
  platform?: SourcePlatform,
): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-clear-status", statuses, platform });
}

export function retryQueueItem(key: string): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-item-retry", key });
}

export function cancelQueueItem(key: string): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-item-cancel", key });
}

export function removeQueueItem(key: string): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-item-remove", key });
}

export function forceExportQueueItem(key: string): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-item-force-export", key });
}

export function discoverExportQueueItem(key: string): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "queue-item-discover-export", key }, 120_000);
}

export function clearPlatformLocalRecords(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "artifact-clear-platform-local", platform });
}

export function clearLogs(): Promise<DebugState> {
  return sendMessage<DebugState>({ type: "debug-clear-request" });
}

export function exportLogs(): Promise<unknown> {
  return sendMessage({ type: "dashboard-log-export-request" });
}

export function pickExportRoot(currentPath?: string): Promise<{ path?: string }> {
  return sendMessage({ type: "downloads-pick-export-root", currentPath });
}

export function resolveExportRoot(): Promise<{ path?: string }> {
  return sendMessage({ type: "downloads-resolve-export-root" });
}

export function resolveDefaultDownloadsRoot(): Promise<{ path?: string }> {
  return sendMessage({ type: "downloads-resolve-default-root" });
}

export function syncArtifacts(platform?: SourcePlatform): Promise<unknown> {
  return sendMessage({ type: "artifact-sync-run", platform });
}

export function openSourceUrl(url: string): void {
  window.open(normalizeConversationUrl(url), "_blank", "noopener,noreferrer");
}

export function openDashboard(): Promise<browser.tabs.Tab> {
  return browser.tabs.create({
    url: browser.runtime.getURL("dashboard.html"),
    active: true,
  });
}

export async function getActiveConversationTarget(): Promise<ActiveConversationTarget> {
  const [tab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const platform = inferPlatformFromUrl(tab?.url);
  return {
    tabId: tab?.id,
    url: tab?.url,
    title: tab?.title,
    platform,
    supported: Boolean(typeof tab?.id === "number" && platform),
  };
}

type ChromeDownloadsAction = "open" | "show";

type ChromeDownloadsApi = {
  open: (downloadId: number) => void;
  show: (downloadId: number) => void;
};

type ChromeRuntimeApi = {
  lastError?: {
    message?: string;
  };
};

type ChromeApi = {
  downloads?: Partial<ChromeDownloadsApi>;
  runtime?: ChromeRuntimeApi;
};

function getChromeApi(): ChromeApi | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;
}

function getChromeDownloadsApi(): ChromeDownloadsApi {
  const downloadsApi = getChromeApi()?.downloads;
  if (!downloadsApi?.open || !downloadsApi?.show) {
    throw new Error("The downloads API is unavailable in the dashboard context.");
  }

  return downloadsApi as ChromeDownloadsApi;
}

function invokeDownloadAction(action: ChromeDownloadsAction, downloadId: number): void {
  const downloadsApi = getChromeDownloadsApi();
  const actionFn = downloadsApi[action] as (downloadId: number) => void;

  try {
    actionFn(downloadId);
    const message = getChromeApi()?.runtime?.lastError?.message;
    if (message) {
      throw new Error(message);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function openLatestArtifact(platform: SourcePlatform, sourceId: string): Promise<unknown> {
  return sendMessage({
    type: "artifact-open-latest",
    platform,
    sourceId,
  });
}

export function showArtifactFolder(platform: SourcePlatform, sourceId: string): Promise<unknown> {
  return sendMessage({
    type: "artifact-show-folder",
    platform,
    sourceId,
  });
}

export function runManualExport(
  sourceTabId: number,
  options: ManualExportOptions,
): Promise<{
  ok: true;
  revision: string;
  files: string[];
  downloadIds: number[];
  skipped: boolean;
}> {
  return sendMessage({
    type: "manual-export-run",
    sourceTabId,
    options,
  }, 60_000);
}

export function getSettingsSnapshot(): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "settings-get" });
}
