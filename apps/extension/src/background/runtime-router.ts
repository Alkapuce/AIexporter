import { AIEXPORTER_EXPORT_COMPATIBILITY_VERSION, type QueueState, type RuntimeMessage } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { clearHistoricalItems, clearItemsByStatuses, markQueueItemStatus, mergeDiscoveryEvent, removeQueueItem, retryFailedItems } from "../runtime/queue";
import { downloadTextAsset } from "../runtime/downloads";
import { writeBackgroundLog } from "../runtime/logger";
import { pickFolderWithNativeHost, pingNativeHost, resolveExportRootWithNativeHost, writeFileWithNativeHost } from "../runtime/native-host";
import { loadDebugState, loadQueueState, updateConversationIndex, clearDebugState } from "../runtime/storage";
import { markConversationIndexExportResult, upsertConversationIndexEntry } from "../runtime/indexes";
import { openLatestArtifact, persistBundle, showLatestArtifactFolder } from "./artifact-persistence";
import { syncArtifactsWithDisk } from "./artifact-sync";
import { getConfiguredExportRoot } from "./export-root";
import {
  getQueueStateSnapshot,
  mergeSettings,
  recordManualExportDebug,
  refreshQueueServices,
  syncDownloadUiWithSettings,
  updateQueueStateWithDerived,
} from "./state-access";
import { SUPPORTED_PLATFORMS } from "./shared";
import type { BackgroundServiceRuntime } from "./service-runtime";

const BACKGROUND_MESSAGE_TYPES = [
  "artifact-clear-platform-local",
  "artifact-open-latest",
  "artifact-show-folder",
  "artifact-sync-run",
  "dashboard-log-export-request",
  "debug-clear-request",
  "debug-log",
  "downloads-pick-export-root",
  "downloads-resolve-export-root",
  "debug-state-request",
  "manual-export-current",
  "platform-settings-update",
  "queue-clear-history-request",
  "queue-clear-status",
  "queue-discovery",
  "queue-item-cancel",
  "queue-item-force-export",
  "queue-item-remove",
  "queue-item-retry",
  "queue-process-request",
  "queue-retry-request",
  "queue-state-request",
  "service-discovery-run",
  "service-full-bootstrap-run",
  "service-pause",
  "service-resume",
  "service-state-request",
  "service-toggle",
  "settings-get",
  "settings-update",
] as const;

type BackgroundMessageType = (typeof BACKGROUND_MESSAGE_TYPES)[number];
type BackgroundRuntimeMessage = Extract<RuntimeMessage, { type: BackgroundMessageType }>;
type BackgroundRuntimeHandler<T extends BackgroundRuntimeMessage = BackgroundRuntimeMessage> = (
  message: T,
  sender: browser.runtime.MessageSender,
) => Promise<unknown>;
type BackgroundRuntimeHandlerMap = {
  [K in BackgroundMessageType]: BackgroundRuntimeHandler<Extract<BackgroundRuntimeMessage, { type: K }>>;
};

export interface BackgroundRuntimeRouterDeps {
  clearDebugState: typeof clearDebugState;
  downloadTextAsset: typeof downloadTextAsset;
  getQueueStateSnapshot: typeof getQueueStateSnapshot;
  loadDebugState: typeof loadDebugState;
  loadQueueState: typeof loadQueueState;
  openLatestArtifact: typeof openLatestArtifact;
  persistBundle: typeof persistBundle;
  recordManualExportDebug: typeof recordManualExportDebug;
  refreshQueueServices: typeof refreshQueueServices;
  showLatestArtifactFolder: typeof showLatestArtifactFolder;
  syncDownloadUiWithSettings: typeof syncDownloadUiWithSettings;
  updateConversationIndex: typeof updateConversationIndex;
  updateQueueStateWithDerived: typeof updateQueueStateWithDerived;
  writeBackgroundLog: typeof writeBackgroundLog;
}

const defaultDeps: BackgroundRuntimeRouterDeps = {
  clearDebugState,
  downloadTextAsset,
  getQueueStateSnapshot,
  loadDebugState,
  loadQueueState,
  openLatestArtifact,
  persistBundle,
  recordManualExportDebug,
  refreshQueueServices,
  showLatestArtifactFolder,
  syncDownloadUiWithSettings,
  updateConversationIndex,
  updateQueueStateWithDerived,
  writeBackgroundLog,
};

function inferManualExportPlatform(sender: browser.runtime.MessageSender): SourcePlatform {
  const url = sender.tab?.url ?? "";
  if (url.includes("chat.deepseek.com")) return "deepseek";
  if (url.includes("gemini.google.com")) return "gemini";
  if (url.includes("aistudio.google.com")) return "aistudio";
  return "chatgpt";
}

async function exportDebugSnapshot(deps: BackgroundRuntimeRouterDeps) {
  const debugState = await deps.loadDebugState();
  const queueState = await deps.loadQueueState();
  const relativePath = `AIexporter/debug/debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      exporterVersion: browser.runtime.getManifest().version,
      exportCompatibilityVersion: AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
      logCount: debugState.logs.length,
      logs: debugState.logs,
    },
    null,
    2,
  );

  try {
    const exportRoot = getConfiguredExportRoot(queueState.settings);
    await pingNativeHost();
    const response = await writeFileWithNativeHost(relativePath, payload, "utf8", exportRoot);
    if (response.path) {
      await deps.writeBackgroundLog("background.debug", "info", "Exported dashboard logs via native host.", {
        code: "debug.exported_native_host",
        path: response.path,
        logCount: debugState.logs.length,
      });
      return {
        path: response.path,
        transport: "native-host" as const,
      };
    }
  } catch (error) {
    if (getConfiguredExportRoot(queueState.settings)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    await deps.writeBackgroundLog("background.debug", "warn", "Native-host dashboard log export failed, falling back to downloads API.", {
      code: "debug.export_native_host_failed",
      error: error instanceof Error ? error.message : "Native-host dashboard log export failed.",
      relativePath,
      logCount: debugState.logs.length,
    });
  }

  const downloaded = await deps.downloadTextAsset(relativePath, payload, "application/json");
  await deps.writeBackgroundLog("background.debug", "info", "Exported dashboard logs via downloads API.", {
    code: "debug.exported_downloads_api",
    path: downloaded.filename,
    logCount: debugState.logs.length,
  });
  return {
    path: downloaded.filename,
    downloadId: downloaded.downloadId,
    transport: "downloads-api" as const,
  };
}

async function enablePlatformForManagedRun(
  deps: BackgroundRuntimeRouterDeps,
  platform: SourcePlatform,
): Promise<QueueState> {
  const current = await deps.loadQueueState();
  const currentConfig = current.settings.platforms[platform];
  const shouldEnableBackfill = platform === "deepseek" || platform === "gemini" || platform === "aistudio";

  return deps.updateQueueStateWithDerived((state) => ({
    ...state,
    settings: {
      ...state.settings,
      platforms: {
        ...state.settings.platforms,
        [platform]: {
          ...state.settings.platforms[platform],
          enabled: true,
          autoExportEnabled: true,
          historyBackfillEnabled: shouldEnableBackfill
            ? true
            : state.settings.platforms[platform].historyBackfillEnabled,
          discoveryMode: shouldEnableBackfill ? "background_backfill" : currentConfig.discoveryMode,
        },
      },
    },
  }));
}

async function findQueueItemPlatform(
  loadCurrentState: BackgroundRuntimeRouterDeps["loadQueueState"],
  key: string,
): Promise<SourcePlatform> {
  const current = await loadCurrentState();
  return current.items.find((item) => item.key === key)?.platform ?? "deepseek";
}

function createRuntimeMessageHandlers(
  serviceRuntime: BackgroundServiceRuntime,
  deps: BackgroundRuntimeRouterDeps,
): BackgroundRuntimeHandlerMap {
  return {
    "artifact-clear-platform-local": async (message) => serviceRuntime.clearPlatformLocalRecords(message.platform),
    "artifact-open-latest": async (message) => deps.openLatestArtifact(message.platform, message.sourceId),
    "artifact-show-folder": async (message) => deps.showLatestArtifactFolder(message.platform, message.sourceId),
    "artifact-sync-run": async (message) => {
      const state = await deps.loadQueueState();
      const result = await syncArtifactsWithDisk(state.settings, message.platform);
      if (result.requeueEvents.length > 0) {
        await deps.updateQueueStateWithDerived((current) => ({
          ...current,
          items: result.requeueEvents.reduce(
            (items, event) => mergeDiscoveryEvent(items, event, { kind: "export", priority: "retry", forcePending: true }),
            current.items,
          ),
        }));
      }
      await deps.refreshQueueServices();
      (message.platform ? [message.platform] : SUPPORTED_PLATFORMS).forEach((platform) => {
        serviceRuntime.requestPlatformTick(platform);
      });
      await deps.writeBackgroundLog("background.artifact", "info", "Synchronized artifact index with local export files.", {
        code: "artifact.sync_completed",
        platform: message.platform,
        exportRoot: result.exportRoot,
        verifiedCount: result.verifiedCount,
        missingCount: result.missingCount,
        importedCount: result.importedCount,
        requeued: result.requeueEvents.length,
      });
      return {
        ok: true,
        ...result,
      };
    },
    "dashboard-log-export-request": async () => exportDebugSnapshot(deps),
    "debug-clear-request": async () => deps.clearDebugState(),
    "debug-log": async (message, sender) => {
      await deps.writeBackgroundLog(message.entry.scope, message.entry.level, message.entry.message, {
        ...(message.entry.details ?? {}),
        senderTabId: sender.tab?.id,
      });
      return deps.loadDebugState();
    },
    "debug-state-request": async () => deps.loadDebugState(),
    "downloads-pick-export-root": async () => {
      const queueState = await deps.loadQueueState();
      const currentPath = getConfiguredExportRoot(queueState.settings);
      const response = await pickFolderWithNativeHost(currentPath);
      return {
        path: response.path,
      };
    },
    "downloads-resolve-export-root": async () => {
      const queueState = await deps.loadQueueState();
      const response = await resolveExportRootWithNativeHost(getConfiguredExportRoot(queueState.settings));
      return {
        path: response.path,
      };
    },
    "manual-export-current": async (message, sender) => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        throw new Error("Manual export requires an active conversation tab.");
      }

      const state = await deps.loadQueueState();
      const platform = inferManualExportPlatform(sender);
      const bundle = await serviceRuntime.extractConversationFromTab(
        tabId,
        state.settings.platforms[platform].navigationTimeoutMs + 15_000,
      );
      const result = await deps.persistBundle(bundle, state.settings);
      const persistedBundle = result.bundle;

      await deps.updateConversationIndex((entries) => {
        let next = upsertConversationIndexEntry(
          entries,
          {
            platform: persistedBundle.platform,
            sourceId: persistedBundle.sourceId,
            url: persistedBundle.url,
            title: persistedBundle.title,
            sourceUpdatedAt: persistedBundle.sourceUpdatedAt,
            revisionFingerprint: result.revision,
          },
          "partial",
        );
        next = markConversationIndexExportResult(
          next,
          persistedBundle,
          result.revision,
          "exported",
          AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
        );
        return next;
      });
      await deps.refreshQueueServices();

      const response = {
        ok: true,
        revision: result.revision,
        files: result.files,
        downloadIds: result.downloadIds,
        skipped: result.skipped ?? false,
      };
      await deps.recordManualExportDebug({
        request: message,
        senderTabId: tabId,
        response,
      });
      return response;
    },
    "platform-settings-update": async (message) => {
      const next = await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        settings: {
          ...current.settings,
          platforms: {
            ...current.settings.platforms,
            [message.platform]: {
              ...current.settings.platforms[message.platform],
              ...message.settings,
            },
          },
        },
      }));
      serviceRuntime.requestPlatformTick(message.platform);
      return next;
    },
    "queue-clear-history-request": async () =>
      deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: clearHistoricalItems(current.items),
      })),
    "queue-clear-status": async (message) =>
      deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: clearItemsByStatuses(current.items, message.statuses, message.platform),
      })),
    "queue-discovery": async (message, sender) => {
      const result = await serviceRuntime.queuePassiveDiscoveryEvent(message.event);
      await deps.writeBackgroundLog("background.discovery", "info", "Queued passive discovery event.", {
        platform: message.event.platform,
        sourceId: message.event.sourceId,
        queued: result.queued,
        senderTabId: sender.tab?.id,
      });

      const state = await deps.loadQueueState();
      if (state.services[message.event.platform].desiredRunning) {
        serviceRuntime.requestPlatformTick(message.event.platform);
      }
      return state;
    },
    "queue-item-cancel": async (message) =>
      deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: markQueueItemStatus(current.items, message.key, "cancelled", "Cancelled from dashboard."),
      })),
    "queue-item-force-export": async (message) => {
      const next = await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.key === message.key
            ? {
                ...item,
                status: "pending",
                priority: "retry",
                lastError: undefined,
                errorCode: undefined,
                skipReason: undefined,
                workerId: undefined,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
      serviceRuntime.requestPlatformTick(await findQueueItemPlatform(deps.loadQueueState, message.key));
      return next;
    },
    "queue-item-remove": async (message) =>
      deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: removeQueueItem(current.items, message.key),
      })),
    "queue-item-retry": async (message) => {
      const next = await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.key === message.key && item.status === "failed"
            ? {
                ...item,
                status: "pending",
                priority: "retry",
                lastError: undefined,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
      serviceRuntime.requestPlatformTick(await findQueueItemPlatform(deps.loadQueueState, message.key));
      return next;
    },
    "queue-process-request": async () => {
      SUPPORTED_PLATFORMS.forEach((platform) => {
        serviceRuntime.requestPlatformTick(platform);
      });
      return deps.getQueueStateSnapshot();
    },
    "queue-retry-request": async () => {
      const next = await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        items: retryFailedItems(current.items),
      }));
      SUPPORTED_PLATFORMS.forEach((platform) => {
        serviceRuntime.requestPlatformTick(platform);
      });
      return next;
    },
    "queue-state-request": async () => deps.getQueueStateSnapshot(),
    "service-discovery-run": async (message) => {
      await enablePlatformForManagedRun(deps, message.platform);
      serviceRuntime.requestPlatformTick(message.platform);
      return deps.loadQueueState();
    },
    "service-full-bootstrap-run": async (message) => {
      await enablePlatformForManagedRun(deps, message.platform);
      void serviceRuntime.runPlatformDiscoverySweep(message.platform, "full-bootstrap").finally(() => {
        serviceRuntime.requestPlatformTick(message.platform);
      });
      return deps.getQueueStateSnapshot();
    },
    "service-pause": async (message) => serviceRuntime.updatePlatformDesiredRunning(message.platform, false),
    "service-resume": async (message) => {
      await enablePlatformForManagedRun(deps, message.platform);
      return serviceRuntime.updatePlatformDesiredRunning(message.platform, true);
    },
    "service-state-request": async () => deps.getQueueStateSnapshot(),
    "service-toggle": async (message) => {
      await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        settings: {
          ...current.settings,
          platforms: {
            ...current.settings.platforms,
            [message.platform]: {
              ...current.settings.platforms[message.platform],
              enabled: message.enabled,
            },
          },
        },
      }));
      return serviceRuntime.updatePlatformDesiredRunning(message.platform, message.enabled);
    },
    "settings-get": async () => deps.getQueueStateSnapshot(),
    "settings-update": async (message) => {
      const nextState = await deps.updateQueueStateWithDerived((current) => ({
        ...current,
        settings: mergeSettings(current.settings, message.settings),
      }));
      await deps.syncDownloadUiWithSettings(nextState.settings);
      return nextState;
    },
  };
}

export function createBackgroundRuntimeRouter(
  serviceRuntime: BackgroundServiceRuntime,
  overrides: Partial<BackgroundRuntimeRouterDeps> = {},
) {
  const deps: BackgroundRuntimeRouterDeps = {
    ...defaultDeps,
    ...overrides,
  };
  const handlers = createRuntimeMessageHandlers(serviceRuntime, deps);

  return async function handleRuntimeMessage(message: RuntimeMessage, sender: browser.runtime.MessageSender) {
    const handler = handlers[(message as BackgroundRuntimeMessage).type as BackgroundMessageType];
    if (!handler) {
      return undefined;
    }
    return handler(message as never, sender);
  };
}
