import type {
  DebugState,
  ExtensionSettings,
  ExportArtifactEntry,
  PlatformRuntimeConfig,
  QueueItemStatus,
  QueueState,
  RuntimeMessage,
} from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";

export interface DashboardStateSnapshot {
  queueState: QueueState;
  debugState: DebugState;
  artifactIndex: ExportArtifactEntry[];
}

async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

export async function fetchDashboardState(): Promise<DashboardStateSnapshot> {
  const [queueState, debugState, artifactRaw] = await Promise.all([
    sendMessage<QueueState>({ type: "queue-state-request" }),
    sendMessage<DebugState>({ type: "debug-state-request" }),
    browser.storage.local.get("aiexporter.artifactIndex"),
  ]);

  const artifactIndex = Array.isArray(artifactRaw["aiexporter.artifactIndex"])
    ? (artifactRaw["aiexporter.artifactIndex"] as ExportArtifactEntry[])
    : [];

  return { queueState, debugState, artifactIndex };
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

export function clearPlatformLocalRecords(platform: SourcePlatform): Promise<QueueState> {
  return sendMessage<QueueState>({ type: "artifact-clear-platform-local", platform });
}

export function clearLogs(): Promise<DebugState> {
  return sendMessage<DebugState>({ type: "debug-clear-request" });
}

export function exportLogs(): Promise<unknown> {
  return sendMessage({ type: "dashboard-log-export-request" });
}

export function openSourceUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openDashboard(): Promise<browser.tabs.Tab> {
  return browser.tabs.create({
    url: browser.runtime.getURL("dashboard.html"),
    active: true,
  });
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
