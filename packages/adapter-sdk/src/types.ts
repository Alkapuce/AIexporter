import type { ConversationBundle, DiscoveryEvent, SourcePlatform } from "@aiexporter/core-schema";

export interface AdapterContext {
  document: Document;
  window: Window;
  location: Location;
}

export interface PlatformAdapter {
  platform: SourcePlatform;
  matches(url: string): boolean;
  extractCurrentConversation(ctx: AdapterContext): Promise<ConversationBundle>;
}

export interface BridgeNetworkPayload {
  sourceId: string;
  url: string;
  title?: string;
  sourceUpdatedAt?: string;
  sourceUpdatedLabel?: string;
}

export interface MainWorldBridgeMessage {
  type:
    | "chatgpt-network-discovery"
    | "chatgpt-page-api-response"
    | "gemini-network-discovery"
    | "gemini-page-api-response"
    | "deepseek-network-discovery"
    | "deepseek-page-api-response"
    ;
  payload?: BridgeNetworkPayload;
  requestId?: string;
  sourceId?: string;
  response?:
    | {
        ok: true;
        data: unknown;
      }
    | {
        ok: false;
        error: string;
      };
}

export type QueueItemKind = "discovery" | "export";
export type QueueItemPriority = "realtime" | "backfill" | "retry";
export type QueueItemStatus = "pending" | "processing" | "completed" | "failed" | "skipped" | "cancelled";
export type AutoExportServiceStatus = "idle" | "starting" | "discovering" | "backfilling" | "running" | "pausing" | "paused" | "error";
export type DiscoveryMode = "passive_only" | "background_backfill";

export interface PlatformRuntimeConfig {
  enabled: boolean;
  autoExportEnabled: boolean;
  historyBackfillEnabled: boolean;
  discoveryMode: DiscoveryMode;
  maxConcurrency: number;
  minStartIntervalMs: number;
  navigationTimeoutMs: number;
  settleDelayMs: number;
  discoverySweepIntervalMs: number;
  reuseWorkerTabs: boolean;
  bootstrapRequireFullHistory: boolean;
  bootstrapWindowMode: "dedicated_window" | "background_tab";
  discoveryReadyTimeoutMs: number;
  discoveryScrollStableRounds: number;
  discoveryDomMaxCycles: number;
  discoveryDomPostScrollWaitMs: number;
  discoveryDomStableCycles: number;
  discoveryDomScrollBottomAttempts: number;
  receiverReadyTimeoutMs: number;
  receiverRetryLimit: number;
  apiExtractMode: "page_world_first";
}

export interface SchedulerSettings {
  autoStartOnBrowserLaunch: boolean;
  globalPaused: boolean;
  logRetentionEntries: number;
}

export type UiLocale = "zh-CN" | "en";
export type UiThemeMode = "system" | "light" | "dark";

export interface DownloadSettings {
  mode: "downloads-api";
  hideDownloadUi: boolean;
  skipIfLatestExists: boolean;
  retainLocalRevisionCount: number;
  openFileActionsEnabled: boolean;
  exportRootPath?: string;
  revisionHistoryMode?: "disabled" | "recycle_previous" | "archive_then_recycle";
  archiveRetentionDays?: number;
}

export type RuntimeMessage =
  | { type: "queue-discovery"; event: DiscoveryEvent }
  | { type: "manual-export-current"; sourceId?: string; url: string }
  | { type: "extract-current-conversation" }
  | { type: "worker-ready-ping" }
  | {
      type: "collect-platform-discovery";
      platform: SourcePlatform;
      mode?: "best-effort" | "full-bootstrap";
      readyTimeoutMs?: number;
      stableRounds?: number;
      expectedCount?: number;
      domMaxCycles?: number;
      domPostScrollWaitMs?: number;
      domStableCycles?: number;
      domScrollBottomAttempts?: number;
    }
  | { type: "service-full-bootstrap-run"; platform: SourcePlatform }
  | { type: "queue-state-request" }
  | { type: "service-state-request" }
  | { type: "debug-state-request" }
  | { type: "queue-process-request" }
  | { type: "queue-retry-request" }
  | { type: "queue-clear-history-request" }
  | { type: "queue-item-retry"; key: string }
  | { type: "queue-item-cancel"; key: string }
  | { type: "queue-item-remove"; key: string }
  | { type: "queue-clear-status"; statuses: QueueItemStatus[]; platform?: SourcePlatform }
  | { type: "service-toggle"; platform: SourcePlatform; enabled: boolean }
  | { type: "service-pause"; platform: SourcePlatform }
  | { type: "service-resume"; platform: SourcePlatform }
  | { type: "service-discovery-run"; platform: SourcePlatform }
  | { type: "platform-settings-update"; platform: SourcePlatform; settings: Partial<PlatformRuntimeConfig> }
  | { type: "artifact-clear-platform-local"; platform: SourcePlatform }
  | { type: "artifact-open-latest"; platform: SourcePlatform; sourceId: string }
  | { type: "artifact-show-folder"; platform: SourcePlatform; sourceId: string }
  | { type: "artifact-sync-run"; platform?: SourcePlatform }
  | { type: "downloads-pick-export-root" }
  | { type: "downloads-resolve-export-root" }
  | { type: "queue-item-force-export"; key: string }
  | { type: "debug-clear-request" }
  | { type: "dashboard-log-export-request" }
  | { type: "settings-get" }
  | { type: "settings-update"; settings: Partial<ExtensionSettings> }
  | { type: "debug-log"; entry: DebugLogInput };

export interface ExportQueueItem {
  key: string;
  event: DiscoveryEvent;
  kind: QueueItemKind;
  priority: QueueItemPriority;
  platform: SourcePlatform;
  workerId?: string;
  status: QueueItemStatus;
  attempts: number;
  lastError?: string;
  skipReason?: "latest_exists";
  resultRevision?: string;
  errorCode?: string;
  discoveredAt: string;
  updatedAt: string;
}

export interface ExtensionSettings {
  syncToServer: boolean;
  serverUrl: string;
  browserLabel: string;
  uiLocale: UiLocale;
  uiThemeMode: UiThemeMode;
  dashboardOpenBehavior: "tab";
  scheduler: SchedulerSettings;
  downloads: DownloadSettings;
  platforms: Record<SourcePlatform, PlatformRuntimeConfig>;
}

export interface WorkerLeaseState {
  workerId: string;
  platform: SourcePlatform;
  tabId?: number;
  role: "export";
  busy: boolean;
  currentQueueKey?: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface PlatformServiceState {
  platform: SourcePlatform;
  status: AutoExportServiceStatus;
  desiredRunning: boolean;
  activeWorkers: number;
  activeDiscoveryTabs: number;
  lastDiscoveryAt?: string;
  lastExportAt?: string;
  nextPlannedRunAt?: string;
  lastError?: string;
  meta?: {
    highestHistoricalCountSeen?: number;
    lastDiscoveryMode?: "best-effort" | "full-bootstrap";
    lastDiscoveryQuality?: "partial" | "full";
  };
  stats: {
    discoveredTotal: number;
    exportedTotal: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

export interface ConversationIndexEntry {
  platform: SourcePlatform;
  sourceId: string;
  title?: string;
  url: string;
  lastSeenAt: string;
  latestDiscoveryFingerprint: string;
  latestSourceUpdatedAt?: string;
  latestSourceUpdatedLabel?: string;
  discoveryState: "partial" | "complete";
  exportState: "never_exported" | "exported" | "failed" | "pending";
  latestExportRevision?: string;
  latestExportCompatibilityVersion?: string;
}

export interface ExportArtifactEntry {
  platform: SourcePlatform;
  sourceId: string;
  revision: string;
  markdownDownloadId?: number;
  bundleDownloadId?: number;
  markdownFilename?: string;
  bundleFilename?: string;
  exportedAt: string;
  archivedAt?: string;
  localStatus?: "present" | "missing" | "deleted" | "skipped_existing" | "archived";
  isLatestForConversation?: boolean;
}

export interface QueueState {
  items: ExportQueueItem[];
  services: Record<SourcePlatform, PlatformServiceState>;
  activeWorkers: WorkerLeaseState[];
  settings: ExtensionSettings;
  lastProcessedAt?: string;
}

export type DebugLogLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogInput {
  level: DebugLogLevel;
  scope: string;
  message: string;
  code?: string;
  traceId?: string;
  platform?: SourcePlatform;
  sourceId?: string;
  workerId?: string;
  details?: Record<string, unknown>;
}

export interface DebugLogEntry extends DebugLogInput {
  id: string;
  timestamp: string;
}

export interface DebugState {
  logs: DebugLogEntry[];
  maxEntries: number;
  lastUpdatedAt?: string;
}
