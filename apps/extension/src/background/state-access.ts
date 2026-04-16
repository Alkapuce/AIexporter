import {
  DEFAULT_QUEUE_STATE,
  type ExtensionSettings,
  type PlatformRuntimeConfig,
  type PlatformServiceState,
  type QueueState,
  type WorkerLeaseState,
} from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { applyDownloadUiPreference } from "../runtime/downloads";
import { writeBackgroundLog } from "../runtime/logger";
import { rebuildAllPlatformServices } from "../runtime/service-state";
import {
  loadArtifactIndex,
  loadConversationIndex,
  loadDebugState,
  loadQueueState,
  saveQueueState,
  updateQueueState,
} from "../runtime/storage";
import {
  DEBUG_LAST_MANUAL_EXPORT_KEY,
  ORPHANED_PROCESSING_RECOVERY_MS,
  SUPPORTED_PLATFORMS,
} from "./shared";

function getPlatformTabQueryPatterns(platform: SourcePlatform): string[] {
  if (platform === "deepseek") return ["https://chat.deepseek.com/*"];
  if (platform === "gemini") return ["https://gemini.google.com/*"];
  if (platform === "aistudio") return ["https://aistudio.google.com/*"];
  if (platform === "chatgpt") return ["https://chatgpt.com/*"];
  return [];
}

async function buildActualDiscoveryTabCounts(): Promise<Record<SourcePlatform, number>> {
  const counts = {
    chatgpt: 0,
    gemini: 0,
    aistudio: 0,
    deepseek: 0,
  } satisfies Record<SourcePlatform, number>;

  for (const platform of SUPPORTED_PLATFORMS) {
    const queryPatterns = getPlatformTabQueryPatterns(platform);
    if (queryPatterns.length === 0) continue;
    const tabs = await browser.tabs.query({ url: queryPatterns });
    counts[platform] = tabs.filter((tab) => tab.url?.includes("aiexporter_discovery=1")).length;
  }

  return counts;
}

export function getPlatformConfig(settings: ExtensionSettings, platform: SourcePlatform): PlatformRuntimeConfig {
  const config = migrateLegacyPlatformConfig(platform, settings.platforms[platform]);
  return {
    ...config,
    bootstrapWindowMode: "background_tab",
  };
}

function migrateLegacyPlatformConfig(
  platform: SourcePlatform,
  config: PlatformRuntimeConfig,
): PlatformRuntimeConfig {
  let nextConfig: PlatformRuntimeConfig = {
    ...config,
    bootstrapWindowMode: "background_tab",
  };

  if (platform === "gemini" || platform === "aistudio") {
    const looksLikeLegacyPassiveOnlyConfig =
      nextConfig.discoveryMode === "passive_only" &&
      !nextConfig.historyBackfillEnabled &&
      !nextConfig.bootstrapRequireFullHistory;

    if (looksLikeLegacyPassiveOnlyConfig) {
      nextConfig = {
        ...nextConfig,
        historyBackfillEnabled: true,
        discoveryMode: "background_backfill",
        bootstrapRequireFullHistory: true,
      };
    }

    const looksLikeLegacyGoogleDefaults =
      nextConfig.maxConcurrency === 1 &&
      nextConfig.minStartIntervalMs === 8_000 &&
      nextConfig.navigationTimeoutMs === 30_000 &&
      nextConfig.receiverRetryLimit === 2;

    if (looksLikeLegacyGoogleDefaults) {
      nextConfig = {
        ...nextConfig,
        maxConcurrency: 4,
        discoverySweepIntervalMs: Math.max(nextConfig.discoverySweepIntervalMs, 24 * 60 * 60 * 1_000),
        bootstrapRequireFullHistory: true,
        bootstrapWindowMode: "background_tab",
        reuseWorkerTabs: true,
        discoveryReadyTimeoutMs:
          platform === "gemini"
            ? Math.max(nextConfig.discoveryReadyTimeoutMs, 60_000)
            : Math.max(nextConfig.discoveryReadyTimeoutMs, 45_000),
      };
    }
  } else if (platform === "deepseek") {
    nextConfig = {
      ...nextConfig,
      maxConcurrency: 1,
    };
  } else if (nextConfig.maxConcurrency === 1 && platform !== "chatgpt") {
    nextConfig = {
      ...nextConfig,
      maxConcurrency: 4,
    };
  }

  const looksLikeLegacyFastDiscoveryInterval =
    nextConfig.discoverySweepIntervalMs === 10 * 60 * 1_000 || nextConfig.discoverySweepIntervalMs === 15 * 60 * 1_000;

  if (looksLikeLegacyFastDiscoveryInterval && platform !== "chatgpt") {
    nextConfig = {
      ...nextConfig,
      discoverySweepIntervalMs: 24 * 60 * 60 * 1_000,
    };
  }

  return nextConfig;
}

export function getPlatformService(queueState: QueueState, platform: SourcePlatform): PlatformServiceState {
  return queueState.services[platform];
}

export function mergeSettings(current: ExtensionSettings, patch: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    ...current,
    ...patch,
    scheduler: {
      ...current.scheduler,
      ...(patch.scheduler ?? {}),
    },
    downloads: {
      ...current.downloads,
      ...(patch.downloads ?? {}),
    },
    platforms: {
      chatgpt: {
        ...current.platforms.chatgpt,
        ...(patch.platforms?.chatgpt ?? {}),
      },
      gemini: {
        ...current.platforms.gemini,
        ...(patch.platforms?.gemini ?? {}),
      },
      aistudio: {
        ...current.platforms.aistudio,
        ...(patch.platforms?.aistudio ?? {}),
      },
      deepseek: {
        ...current.platforms.deepseek,
        ...(patch.platforms?.deepseek ?? {}),
      },
    },
  };
}

export function deriveDesiredRunning(
  service: PlatformServiceState,
  settings: ExtensionSettings,
  platform: SourcePlatform,
): boolean {
  const config = getPlatformConfig(settings, platform);
  if (settings.scheduler.globalPaused) return false;
  if (!config.enabled || !config.autoExportEnabled) return false;
  if (service.status === "paused" && !service.desiredRunning) return false;
  return service.desiredRunning || settings.scheduler.autoStartOnBrowserLaunch;
}

export async function rebuildAndSaveQueueState(state: QueueState): Promise<QueueState> {
  const conversationIndex = await loadConversationIndex();
  const next = {
    ...state,
    services: rebuildAllPlatformServices(state, conversationIndex),
  };
  return saveQueueState(next);
}

export async function updateQueueStateWithDerived(
  updater: (state: QueueState) => QueueState | Promise<QueueState>,
): Promise<QueueState> {
  return updateQueueState(async (current) => {
    const next = await updater(current);
    const conversationIndex = await loadConversationIndex();
    return {
      ...next,
      services: rebuildAllPlatformServices(next, conversationIndex),
    };
  });
}

export async function refreshQueueServices(): Promise<QueueState> {
  const state = await loadQueueState();
  return rebuildAndSaveQueueState(state);
}

export async function getQueueStateSnapshot(): Promise<QueueState> {
  const state = await loadQueueState();
  const conversationIndex = await loadConversationIndex();
  const actualDiscoveryTabs = await buildActualDiscoveryTabCounts();
  const synchronizedState: QueueState = {
    ...state,
    services: {
      chatgpt: {
        ...state.services.chatgpt,
        activeDiscoveryTabs: actualDiscoveryTabs.chatgpt,
      },
      gemini: {
        ...state.services.gemini,
        activeDiscoveryTabs: actualDiscoveryTabs.gemini,
      },
      aistudio: {
        ...state.services.aistudio,
        activeDiscoveryTabs: actualDiscoveryTabs.aistudio,
      },
      deepseek: {
        ...state.services.deepseek,
        activeDiscoveryTabs: actualDiscoveryTabs.deepseek,
      },
    },
  };
  return {
    ...synchronizedState,
    services: rebuildAllPlatformServices(synchronizedState, conversationIndex),
  };
}

export async function patchPlatformService(
  platform: SourcePlatform,
  patch: Partial<PlatformServiceState>,
): Promise<QueueState> {
  return updateQueueStateWithDerived((current) => ({
    ...current,
    services: {
      ...current.services,
      [platform]: {
        ...current.services[platform],
        ...patch,
      },
    },
  }));
}

export async function patchWorkerLease(workerId: string, patch: Partial<WorkerLeaseState>): Promise<QueueState> {
  return updateQueueStateWithDerived((current) => ({
    ...current,
    activeWorkers: current.activeWorkers.map((worker) =>
      worker.workerId === workerId
        ? {
            ...worker,
            ...patch,
            lastActiveAt: new Date().toISOString(),
          }
        : worker,
    ),
  }));
}

export async function removeWorkerLease(workerId: string): Promise<QueueState> {
  return updateQueueStateWithDerived((current) => ({
    ...current,
    activeWorkers: current.activeWorkers.filter((worker) => worker.workerId !== workerId),
  }));
}

export async function recoverOrphanedProcessingItems(platform: SourcePlatform): Promise<number> {
  const now = Date.now();
  let recovered = 0;

  await updateQueueStateWithDerived((current) => {
    const activeWorkerIds = new Set(
      current.activeWorkers.filter((worker) => worker.platform === platform).map((worker) => worker.workerId),
    );
    const nextItems = current.items.map((item) => {
      if (item.platform !== platform || item.status !== "processing") return item;
      if (item.workerId && activeWorkerIds.has(item.workerId)) return item;

      const updatedAt = Date.parse(item.updatedAt);
      if (!Number.isNaN(updatedAt) && now - updatedAt < ORPHANED_PROCESSING_RECOVERY_MS) {
        return item;
      }

      recovered += 1;
      return {
        ...item,
        status: "pending" as const,
        priority: "retry" as const,
        workerId: undefined,
        lastError: undefined,
        errorCode: undefined,
        updatedAt: new Date().toISOString(),
      };
    });

    if (recovered === 0) return current;
    return {
      ...current,
      items: nextItems,
    };
  });

  if (recovered > 0) {
    await writeBackgroundLog("background.queue", "warn", "Recovered orphaned processing queue items.", {
      code: "worker.orphaned_processing_recovered",
      platform,
      recovered,
    });
  }

  return recovered;
}

export async function ensureInitialized(): Promise<QueueState> {
  await loadDebugState();
  const conversationIndex = await loadConversationIndex();
  await loadArtifactIndex();

  const normalized = await updateQueueState((current) => {
    const baseState = {
      ...DEFAULT_QUEUE_STATE,
      ...current,
      settings: (() => {
        const merged = mergeSettings(DEFAULT_QUEUE_STATE.settings, current.settings);
        return {
          ...merged,
          platforms: {
            ...merged.platforms,
            chatgpt: migrateLegacyPlatformConfig("chatgpt", merged.platforms.chatgpt),
            gemini: migrateLegacyPlatformConfig("gemini", merged.platforms.gemini),
            aistudio: migrateLegacyPlatformConfig("aistudio", merged.platforms.aistudio),
            deepseek: migrateLegacyPlatformConfig("deepseek", merged.platforms.deepseek),
          },
        };
      })(),
      items: current.items.map((item) =>
        item.status === "processing"
          ? {
              ...item,
              status: "pending" as const,
              workerId: undefined,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      activeWorkers: [],
    };

    const nextServices = Object.fromEntries(
      SUPPORTED_PLATFORMS.map((platform) => {
        const currentService = baseState.services[platform];
        const desiredRunning = deriveDesiredRunning(currentService, baseState.settings, platform);
        return [
          platform,
          {
            ...currentService,
            desiredRunning,
            activeWorkers: 0,
            activeDiscoveryTabs: 0,
            status: desiredRunning ? "idle" : "paused",
          },
        ];
      }),
    ) as QueueState["services"];

    return {
      ...baseState,
      services: nextServices,
    };
  });

  return saveQueueState({
    ...normalized,
    services: rebuildAllPlatformServices(normalized, conversationIndex),
  });
}

export async function syncDownloadUiWithSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await applyDownloadUiPreference(!settings.downloads.hideDownloadUi);
  } catch (error) {
    await writeBackgroundLog("background.downloads", "warn", "Unable to apply download UI preference.", {
      code: "downloads.ui_unavailable",
      error: error instanceof Error ? error.message : "Unable to apply download UI preference",
      hideDownloadUi: settings.downloads.hideDownloadUi,
    });
  }
}

export async function recordManualExportDebug(payload: unknown): Promise<void> {
  await browser.storage.local.set({
    [DEBUG_LAST_MANUAL_EXPORT_KEY]: {
      recordedAt: new Date().toISOString(),
      payload,
    },
  });
}
