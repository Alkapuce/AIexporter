import {
  AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
  buildDiscoveryFingerprint,
  type BridgeNetworkPayload,
  type ConversationIndexEntry,
  type ExportQueueItem,
  type PlatformRuntimeConfig,
  type PlatformServiceState,
  type QueueState,
  type WorkerLeaseState,
} from "@aiexporter/adapter-sdk";
import type { ConversationBundle, DiscoveryEvent, SourcePlatform } from "@aiexporter/core-schema";
import { getNextPendingItem, mergeDiscoveryEvent, patchQueueItem, summarizeQueueItems } from "../runtime/queue";
import { removeDownloadedAsset } from "../runtime/downloads";
import { markConversationIndexExportPending, upsertConversationIndexEntry } from "../runtime/indexes";
import { createTraceLogger, writeBackgroundError, writeBackgroundLog } from "../runtime/logger";
import { checkPathExistsWithNativeHost, recyclePathWithNativeHost, resolveExportRootWithNativeHost } from "../runtime/native-host";
import {
  loadArtifactIndex,
  loadConversationIndex,
  loadQueueState,
  saveArtifactIndex,
  saveConversationIndex,
  updateConversationIndex,
} from "../runtime/storage";
import { markBundleExportResult, persistBundle } from "./artifact-persistence";
import { syncArtifactsWithDisk } from "./artifact-sync";
import { recordArtifactSyncCompleted } from "./artifact-sync-state";
import { getConfiguredExportRoot } from "./export-root";
import {
  getPlatformConfig,
  getPlatformService,
  patchPlatformService,
  patchWorkerLease,
  recoverOrphanedProcessingItems,
  refreshQueueServices,
  removeWorkerLease,
  updateQueueStateWithDerived,
} from "./state-access";
import {
  GOOGLE_CHALLENGE_COOLDOWN_MS,
  STALE_BUSY_WORKER_RECOVERY_MS,
  getPlatformAlarmName,
  sanitizePathSegment,
} from "./shared";
import {
  closeWorkerTab,
  ensureWorkerReceiver,
  extractConversationFromTab,
  isChallengeLikeTab,
  isReceiverUnavailableError,
  requestTabRuntimeMessage,
  waitForTabComplete,
  waitForWorkerReady,
} from "./tab-runtime";

type DiscoverySweepMode = "best-effort" | "full-bootstrap";
type QueueWorkStatus = "pending" | "processing";

function isGooglePlatform(platform: SourcePlatform): boolean {
  return platform === "gemini" || platform === "aistudio";
}

function isGeminiDiscoveryRetryableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unable to load recent conversations") ||
    normalized.includes("unable to load history") ||
    message.includes("无法加载最近的对话") ||
    message.includes("无法加载历史记录") ||
    normalized.includes("worker receiver did not become ready before timeout") ||
    normalized.includes("timed out while waiting for content script response")
  );
}

function isChallengeErrorCode(errorCode: string | undefined, message: string): boolean {
  return errorCode === "worker.challenge_detected" || message.toLowerCase().includes("challenge page detected");
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface BackgroundServiceRuntime {
  clearPlatformLocalRecords(platform: SourcePlatform): Promise<QueueState>;
  extractConversationFromTab(tabId: number, timeoutMs: number): Promise<ConversationBundle>;
  handleTabRemoved(tabId: number): Promise<void>;
  queuePassiveDiscoveryEvent(event: DiscoveryEvent): Promise<{ total: number; queued: number }>;
  queuePassiveDiscoveryEvents(events: DiscoveryEvent[]): Promise<{ total: number; queued: number }>;
  requestPlatformStartupCatchup(platform: SourcePlatform): void;
  requestPlatformTick(platform: SourcePlatform): void;
  runPlatformDiscoverySweep(platform: SourcePlatform, mode?: DiscoverySweepMode): Promise<void>;
  updatePlatformDesiredRunning(platform: SourcePlatform, desiredRunning: boolean): Promise<QueueState>;
}

export function createBackgroundServiceRuntime(): BackgroundServiceRuntime {
  const platformTickState = new Map<SourcePlatform, { running: boolean; rerun: boolean }>();
  const platformDiscoveryRunCounts = new Map<SourcePlatform, number>();
  const platformDiscoverySingleflight = new Map<SourcePlatform, Promise<void>>();
  const platformStartupCatchup = new Set<SourcePlatform>();
  const platformExecutionEpoch = new Map<SourcePlatform, number>();
  const intentionalWorkerTabClosures = new Set<number>();

  function getPlatformDiscoveryRunCount(platform: SourcePlatform): number {
    return platformDiscoveryRunCounts.get(platform) ?? 0;
  }

  function beginPlatformDiscoveryRun(platform: SourcePlatform): void {
    platformDiscoveryRunCounts.set(platform, getPlatformDiscoveryRunCount(platform) + 1);
  }

  function endPlatformDiscoveryRun(platform: SourcePlatform): void {
    const nextCount = getPlatformDiscoveryRunCount(platform) - 1;
    if (nextCount > 0) {
      platformDiscoveryRunCounts.set(platform, nextCount);
      return;
    }
    platformDiscoveryRunCounts.delete(platform);
  }

  function getPlatformExecutionEpoch(platform: SourcePlatform): number {
    return platformExecutionEpoch.get(platform) ?? 0;
  }

  function bumpPlatformExecutionEpoch(platform: SourcePlatform): number {
    const nextEpoch = getPlatformExecutionEpoch(platform) + 1;
    platformExecutionEpoch.set(platform, nextEpoch);
    return nextEpoch;
  }

  function isPlatformExecutionCurrent(platform: SourcePlatform, epoch: number): boolean {
    return getPlatformExecutionEpoch(platform) === epoch;
  }

  function getPlatformDiscoveryUrl(platform: SourcePlatform): string | null {
    if (platform === "deepseek") return "https://chat.deepseek.com/";
    if (platform === "gemini") return "https://gemini.google.com/app";
    if (platform === "aistudio") return "https://aistudio.google.com/library";
    return null;
  }

  function buildMarkedDiscoveryUrl(url: string): string {
    const marked = new URL(url);
    marked.searchParams.set("aiexporter_discovery", "1");
    return marked.toString();
  }

  function getPlatformTabQueryPatterns(platform: SourcePlatform): string[] {
    if (platform === "deepseek") return ["https://chat.deepseek.com/*"];
    if (platform === "gemini") return ["https://gemini.google.com/*"];
    if (platform === "aistudio") return ["https://aistudio.google.com/*"];
    if (platform === "chatgpt") return ["https://chatgpt.com/*"];
    return [];
  }

  function getDiscoveryResponseTimeoutMs(platform: SourcePlatform, config: PlatformRuntimeConfig): number {
    const baseline = config.discoveryReadyTimeoutMs + 10_000;
    if (platform === "gemini") return Math.max(baseline, 180_000);
    if (platform === "aistudio") return Math.max(baseline, 60_000);
    return baseline;
  }

  function hasOutstandingPlatformQueueWork(
    queueState: QueueState,
    platform: SourcePlatform,
    statuses: QueueWorkStatus[] = ["pending", "processing"],
  ): boolean {
    return queueState.items.some((item) => item.platform === platform && statuses.includes(item.status as QueueWorkStatus));
  }

  function shouldRunInitialBootstrapDiscovery(service: PlatformServiceState, config: PlatformRuntimeConfig): boolean {
    return (
      !service.lastDiscoveryAt &&
      config.bootstrapRequireFullHistory &&
      service.stats.discoveredTotal === 0 &&
      (service.meta?.highestHistoricalCountSeen ?? 0) === 0
    );
  }

  function getDiscoveryAttemptTimeoutMs(
    platform: SourcePlatform,
    mode: DiscoverySweepMode,
    config: PlatformRuntimeConfig,
  ): number {
    if (platform === "gemini" && mode === "full-bootstrap") {
      return Math.max(120_000, getDiscoveryResponseTimeoutMs(platform, config) + 15_000);
    }
    if (platform === "aistudio" && mode === "full-bootstrap") {
      return Math.max(120_000, getDiscoveryResponseTimeoutMs(platform, config) + 30_000);
    }
    return Math.max(90_000, getDiscoveryResponseTimeoutMs(platform, config) + 15_000);
  }

  async function applyDiscoveryBatch(
    events: DiscoveryEvent[],
    options: { priority: ExportQueueItem["priority"]; discoveryState: ConversationIndexEntry["discoveryState"] },
  ): Promise<{ total: number; queued: number }> {
    if (events.length === 0) return { total: 0, queued: 0 };

    const queueableEvents: DiscoveryEvent[] = [];

    await updateConversationIndex((entries) => {
      let nextEntries = [...entries];
      for (const event of events) {
        const existing = nextEntries.find((entry) => entry.platform === event.platform && entry.sourceId === event.sourceId);
        nextEntries = upsertConversationIndexEntry(nextEntries, event, options.discoveryState);

        const shouldEnqueue =
          !existing ||
          existing.latestDiscoveryFingerprint !== event.revisionFingerprint ||
          existing.exportState !== "exported" ||
          existing.latestExportCompatibilityVersion !== AIEXPORTER_EXPORT_COMPATIBILITY_VERSION;

        if (shouldEnqueue) {
          queueableEvents.push(event);
          nextEntries = markConversationIndexExportPending(nextEntries, event.platform, event.sourceId);
        }
      }
      return nextEntries;
    });

    if (queueableEvents.length > 0) {
      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: queueableEvents.reduce(
          (items, event) =>
            mergeDiscoveryEvent(items, event, { kind: "export", priority: options.priority, forcePending: true }),
          current.items,
        ),
      }));
    } else {
      await refreshQueueServices();
    }

    const queueState = await loadQueueState();
    await writeBackgroundLog("background.discovery", "info", "Applied discovery batch to queue.", {
      priority: options.priority,
      discoveryState: options.discoveryState,
      exportCompatibilityVersion: AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
      total: events.length,
      queued: queueableEvents.length,
      queue: summarizeQueueItems(queueState.items),
    });

    return {
      total: events.length,
      queued: queueableEvents.length,
    };
  }

  async function queuePassiveDiscoveryEvent(event: DiscoveryEvent): Promise<{ total: number; queued: number }> {
    return applyDiscoveryBatch([event], {
      priority: "realtime",
      discoveryState: "partial",
    });
  }

  async function queuePassiveDiscoveryEvents(events: DiscoveryEvent[]): Promise<{ total: number; queued: number }> {
    if (events.length === 0) {
      return { total: 0, queued: 0 };
    }

    const deduped = Array.from(
      events.reduce((map, event) => map.set(`${event.platform}:${event.sourceId}`, event), new Map<string, DiscoveryEvent>()).values(),
    );

    return applyDiscoveryBatch(deduped, {
      priority: "realtime",
      discoveryState: "partial",
    });
  }

  async function buildEventFromConversationIndex(entry: ConversationIndexEntry): Promise<DiscoveryEvent> {
    const revisionFingerprint =
      entry.latestDiscoveryFingerprint?.trim() ||
      (await buildDiscoveryFingerprint(entry.platform, {
        sourceId: entry.sourceId,
        url: entry.url,
        title: entry.title,
        sourceUpdatedAt: entry.latestSourceUpdatedAt,
        sourceUpdatedLabel: entry.latestSourceUpdatedLabel,
      }));

    return {
      platform: entry.platform,
      sourceId: entry.sourceId,
      url: entry.url,
      title: entry.title,
      sourceUpdatedAt: entry.latestSourceUpdatedAt,
      sourceUpdatedLabel: entry.latestSourceUpdatedLabel,
      revisionFingerprint,
    };
  }

  async function hydratePendingQueueFromIndex(platform: SourcePlatform): Promise<number> {
    const conversationIndex = await loadConversationIndex();
    const queueState = await loadQueueState();
    const queuedSourceIds = new Set(
      queueState.items.filter((item) => item.platform === platform).map((item) => item.event.sourceId),
    );
    const candidateEntries = conversationIndex.filter(
      (entry) =>
        entry.platform === platform &&
        entry.exportState === "pending" &&
        !queuedSourceIds.has(entry.sourceId),
    );

    if (candidateEntries.length === 0) {
      return 0;
    }

    const queueableEvents = await Promise.all(candidateEntries.map((entry) => buildEventFromConversationIndex(entry)));

    if (queueableEvents.length === 0) {
      return 0;
    }

    await updateQueueStateWithDerived((current) => ({
      ...current,
      items: queueableEvents.reduce(
        (items, event) => mergeDiscoveryEvent(items, event, { kind: "export", priority: "backfill", forcePending: true }),
        current.items,
      ),
    }));

    await writeBackgroundLog("background.queue", "info", "Rehydrated pending queue items from conversation index.", {
      platform,
      restored: queueableEvents.length,
    });

    return queueableEvents.length;
  }

  async function markPlatformCompatibilityReexportsPending(platform: SourcePlatform): Promise<number> {
    let marked = 0;

    await updateConversationIndex((entries) =>
      entries.map((entry) => {
        if (entry.platform !== platform || entry.exportState !== "exported") {
          return entry;
        }

        if (entry.latestExportCompatibilityVersion === AIEXPORTER_EXPORT_COMPATIBILITY_VERSION) {
          return entry;
        }

        marked += 1;
        return {
          ...entry,
          exportState: "pending",
        };
      }),
    );

    if (marked === 0) {
      return 0;
    }

    const restored = await hydratePendingQueueFromIndex(platform);
    await writeBackgroundLog("background.queue", "info", "Marked older compatibility exports for forced re-export.", {
      code: "export.compatibility_requeue_applied",
      platform,
      marked,
      restored,
      exportCompatibilityVersion: AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
    });

    return marked;
  }

  async function runPlatformDiscoverySweep(
    platform: SourcePlatform,
    mode: DiscoverySweepMode = "best-effort",
  ): Promise<void> {
    const inFlightSweep = platformDiscoverySingleflight.get(platform);
    if (inFlightSweep) {
      await writeBackgroundLog("background.discovery", "debug", "Joined existing platform discovery sweep instead of starting a duplicate run.", {
        platform,
        mode,
      });
      return inFlightSweep;
    }

    const runPromise = (async () => {
    const discoveryUrl = getPlatformDiscoveryUrl(platform);
    if (!discoveryUrl) return;
    if (getPlatformDiscoveryRunCount(platform) > 0) {
      await writeBackgroundLog("background.discovery", "debug", "Skipped platform discovery sweep because one is already running.", {
        platform,
        mode,
      });
      return;
    }

    beginPlatformDiscoveryRun(platform);
    const runEpoch = getPlatformExecutionEpoch(platform);
    const traceId = crypto.randomUUID();
    const traceLog = createTraceLogger("background.discovery", {
      platform,
      traceId,
      mode,
    });
    const sweepStartedAt = Date.now();

    let tabId: number | undefined;
    let windowId: number | undefined;
    let bestPayloads: BridgeNetworkPayload[] = [];
    let bestAttempt = 0;
    let selectedPayloads: BridgeNetworkPayload[] | null = null;
    let selectedAttempt = 0;
    let lastAttemptError: unknown;
    const initialState = await loadQueueState();
    const highestHistoricalCountSeen = Math.max(
      initialState.services[platform].meta?.highestHistoricalCountSeen ?? 0,
      initialState.services[platform].stats.discoveredTotal ?? 0,
    );
    await patchPlatformService(platform, {
      status: "discovering",
      activeDiscoveryTabs: getPlatformService(initialState, platform).activeDiscoveryTabs + 1,
      lastError: undefined,
    });
    const config = getPlatformConfig(initialState.settings, platform);

    try {
      await traceLog("info", "Starting platform discovery sweep.", {
        code: mode === "full-bootstrap" ? "discovery.full_started" : "discovery.partial_started",
        url: discoveryUrl,
        highestHistoricalCountSeen,
      });

      const closeDiscoveryAttemptResources = async () => {
        if (windowId) {
          await browser.windows.remove(windowId).catch(() => undefined);
          windowId = undefined;
        }
        if (tabId) {
          await browser.tabs.remove(tabId).catch(() => undefined);
          tabId = undefined;
        }
      };

      const maxAttempts = platform === "gemini" ? 2 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          lastAttemptError = undefined;
          const attemptStartedAt = Date.now();
          if (mode === "full-bootstrap" && config.bootstrapWindowMode === "dedicated_window") {
            const discoveryWindow = await browser.windows.create({
              url: buildMarkedDiscoveryUrl(discoveryUrl),
              focused: false,
              type: "normal",
              state: "minimized",
            });
            windowId = discoveryWindow.id;
            tabId = discoveryWindow.tabs?.[0]?.id;
          } else {
            const tab = await browser.tabs.create({
              url: buildMarkedDiscoveryUrl(discoveryUrl),
              active: false,
              pinned: true,
            });
            tabId = tab.id;
          }

          await traceLog("debug", "Created discovery tab.", {
            code: "discovery.tab_created",
            attempt: attempt + 1,
            tabId,
            windowId,
          });

          if (!tabId) {
            throw new Error(`${platform} discovery tab could not be created.`);
          }
          try {
            await waitForTabComplete(tabId, config.navigationTimeoutMs);
            await traceLog("debug", "Discovery tab reached complete state.", {
              code: "discovery.tab_ready",
              attempt: attempt + 1,
              tabId,
              durationMs: Date.now() - attemptStartedAt,
            });
          } catch (error) {
            await traceLog("warn", "Discovery tab did not reach complete state before timeout, falling back to receiver readiness.", {
              code: "discovery.tab_ready_timeout_fallback",
              tabId,
              attempt: attempt + 1,
              error: getErrorMessage(error, "Timed out waiting for discovery tab to load."),
              durationMs: Date.now() - attemptStartedAt,
            });
          }

          const readyStartedAt = Date.now();
          await waitForWorkerReady(tabId, discoveryUrl, config.navigationTimeoutMs);
          await traceLog("debug", "Discovery receiver became ready.", {
            code: "discovery.receiver_ready",
            tabId,
            attempt: attempt + 1,
            durationMs: Date.now() - readyStartedAt,
          });

          const collectStartedAt = Date.now();
          const payloads = await withTimeout(
            requestTabRuntimeMessage<BridgeNetworkPayload[]>(
              tabId,
              {
                type: "collect-platform-discovery",
                platform,
                mode,
                readyTimeoutMs: config.discoveryReadyTimeoutMs,
                stableRounds: config.discoveryScrollStableRounds,
                expectedCount: highestHistoricalCountSeen,
                domMaxCycles: config.discoveryDomMaxCycles,
                domPostScrollWaitMs: config.discoveryDomPostScrollWaitMs,
                domStableCycles: config.discoveryDomStableCycles,
                domScrollBottomAttempts: config.discoveryDomScrollBottomAttempts,
              },
              1,
              getDiscoveryResponseTimeoutMs(platform, config),
            ),
            getDiscoveryAttemptTimeoutMs(platform, mode, config),
            `${platform} discovery attempt exceeded the maximum allowed time.`,
          );
          await traceLog("info", "Collected discovery payload batch from platform tab.", {
            code: "discovery.payloads_collected",
            tabId,
            attempt: attempt + 1,
            discovered: payloads.length,
            durationMs: Date.now() - collectStartedAt,
          });

          if (payloads.length > bestPayloads.length) {
            bestPayloads = payloads;
            bestAttempt = attempt + 1;
          }

          selectedPayloads = payloads;
          selectedAttempt = attempt + 1;
          break;
        } catch (attemptError) {
          lastAttemptError = attemptError;
          const lastError = getErrorMessage(attemptError, "Discovery attempt failed.");
          if (platform === "gemini" && attempt + 1 < maxAttempts && isGeminiDiscoveryRetryableError(lastError)) {
            await traceLog("warn", "Gemini discovery attempt failed with a retryable history error, recreating the discovery tab.", {
              code: "discovery.gemini_retryable_error",
              attempt: attempt + 1,
              lastError,
              durationMs: Date.now() - sweepStartedAt,
            });
            await closeDiscoveryAttemptResources();
            continue;
          }
          throw attemptError;
        }
      }

      if (!selectedPayloads && bestPayloads.length > 0) {
        selectedPayloads = bestPayloads;
        selectedAttempt = bestAttempt;
        await traceLog("warn", "Falling back to the best partial Gemini discovery batch collected before retry exhaustion.", {
          code: "discovery.gemini_best_partial_fallback",
          attempt: bestAttempt,
          discovered: bestPayloads.length,
          highestHistoricalCountSeen,
          lastError: getErrorMessage(lastAttemptError, "Gemini retry attempts did not complete."),
        });
      }

      if (!selectedPayloads) {
        throw lastAttemptError instanceof Error ? lastAttemptError : new Error(`${platform} discovery sweep produced no payloads.`);
      }

      const events: DiscoveryEvent[] = [];
      for (const payload of selectedPayloads) {
        const revisionFingerprint = await buildDiscoveryFingerprint(platform, payload);
        events.push({
          platform,
          ...payload,
          revisionFingerprint,
        });
      }

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        return;
      }

      const batchResult = await applyDiscoveryBatch(events, {
        priority: "backfill",
        discoveryState: "complete",
      });

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        return;
      }

      await patchPlatformService(platform, {
        status: "backfilling",
        lastDiscoveryAt: new Date().toISOString(),
        lastError: undefined,
        meta: {
          ...initialState.services[platform].meta,
          highestHistoricalCountSeen: Math.max(highestHistoricalCountSeen, batchResult.total),
          lastDiscoveryMode: mode,
          lastDiscoveryQuality:
            batchResult.total > 0 && batchResult.total >= highestHistoricalCountSeen ? "full" : "partial",
        },
      });
      await traceLog(
        "info",
        mode === "full-bootstrap"
          ? `Completed ${platform} full bootstrap discovery sweep.`
          : `Completed ${platform} background discovery sweep.`,
        {
          code: mode === "full-bootstrap" ? "discovery.full_completed" : "discovery.partial_result",
          tabId,
          attempt: selectedAttempt,
          discovered: batchResult.total,
          queued: batchResult.queued,
          durationMs: Date.now() - sweepStartedAt,
        },
      );
      return;
    } catch (error) {
      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        return;
      }
      const lastError = getErrorMessage(error, `${platform} discovery sweep failed.`);
      await patchPlatformService(platform, {
        status: "error",
        lastError,
      });
      await writeBackgroundError(
        "background.discovery",
        "discovery.failed",
        mode === "full-bootstrap"
          ? `${platform} full bootstrap discovery sweep failed.`
          : `${platform} background discovery sweep failed.`,
        {
          platform,
          tabId,
          mode,
          lastError,
          traceId,
          durationMs: Date.now() - sweepStartedAt,
        },
      );
    } finally {
      endPlatformDiscoveryRun(platform);
      if (windowId) {
        await browser.windows.remove(windowId).catch(() => undefined);
      }
      if (tabId) {
        await browser.tabs.remove(tabId).catch(() => undefined);
      }
      const latestState = await loadQueueState();
      if (isPlatformExecutionCurrent(platform, runEpoch)) {
        await patchPlatformService(platform, {
          activeDiscoveryTabs: Math.max(0, latestState.services[platform].activeDiscoveryTabs - 1),
        });
        // Kick the tick so workers can start now that discovery is done.
        requestPlatformTick(platform);
      }
    }
    })().finally(() => {
      const currentPromise = platformDiscoverySingleflight.get(platform);
      if (currentPromise === runPromise) {
        platformDiscoverySingleflight.delete(platform);
      }
    });

    platformDiscoverySingleflight.set(platform, runPromise);
    return runPromise;
  }

  function getTargetWorkerCount(service: PlatformServiceState, config: PlatformRuntimeConfig): number {
    if (service.platform === "deepseek") return 1;
    if (isGooglePlatform(service.platform)) return 1;
    if (config.maxConcurrency <= 1) return 1;
    const lowerError = service.lastError?.toLowerCase() ?? "";
    const risky = lowerError.includes("cloudflare") || lowerError.includes("verify") || lowerError.includes("timed out");
    if (service.stats.failed > 0 || risky) return 1;

    if (service.stats.pending >= 24) {
      return Math.max(1, Math.min(4, config.maxConcurrency));
    }
    if (service.stats.pending >= 12) {
      return Math.max(1, Math.min(3, config.maxConcurrency));
    }
    if (service.stats.pending >= 6) {
      return Math.max(1, Math.min(2, config.maxConcurrency));
    }

    return 1;
  }

  function getWorkerIdleAgeMs(worker: WorkerLeaseState, now = Date.now()): number {
    const lastActiveAt = Date.parse(worker.lastActiveAt);
    if (Number.isNaN(lastActiveAt)) return 0;
    return Math.max(0, now - lastActiveAt);
  }

  function isGhostBusyWorker(worker: WorkerLeaseState, now = Date.now()): boolean {
    if (!worker.busy) return false;
    if (typeof worker.tabId === "number") return false;
    return getWorkerIdleAgeMs(worker, now) >= Math.min(STALE_BUSY_WORKER_RECOVERY_MS, 30_000);
  }

  function getPlatformWorkerSnapshot(queueState: QueueState, platform: SourcePlatform): {
    workers: WorkerLeaseState[];
    busyWorkers: WorkerLeaseState[];
    idleWorkers: WorkerLeaseState[];
    ghostBusyWorkers: WorkerLeaseState[];
  } {
    const now = Date.now();
    const workers = queueState.activeWorkers.filter((worker) => worker.platform === platform);
    const ghostBusyWorkers = workers.filter((worker) => isGhostBusyWorker(worker, now));
    const effectiveWorkers = workers.filter((worker) => !ghostBusyWorkers.some((ghost) => ghost.workerId === worker.workerId));
    return {
      workers: effectiveWorkers,
      busyWorkers: effectiveWorkers.filter((worker) => worker.busy),
      idleWorkers: effectiveWorkers.filter((worker) => !worker.busy),
      ghostBusyWorkers,
    };
  }

  function shouldForceGeminiHistoryCatchup(service: PlatformServiceState): boolean {
    if (service.platform !== "gemini") return false;
    const highestHistoricalCountSeen = service.meta?.highestHistoricalCountSeen ?? 0;
    if (highestHistoricalCountSeen <= 0) return false;
    if (service.meta?.lastDiscoveryQuality !== "partial") return false;
    const historicalGap = highestHistoricalCountSeen - service.stats.discoveredTotal;
    return historicalGap >= Math.max(25, Math.ceil(highestHistoricalCountSeen * 0.15));
  }

  function pickNextPlatformItem(queueState: QueueState, platform: SourcePlatform): ExportQueueItem | undefined {
    return getNextPendingItem(queueState.items.filter((item) => item.platform === platform));
  }

  function patchWorkerOwnedQueueItems(
    items: ExportQueueItem[],
    target: ExportQueueItem,
    workerId: string,
    patch: Partial<ExportQueueItem>,
  ): ExportQueueItem[] {
    const now = new Date().toISOString();
    return items.map((item) => {
      const sameKey = item.key === target.key;
      const sameOwnedProcessing =
        item.platform === target.platform &&
        item.event.sourceId === target.event.sourceId &&
        item.status === "processing" &&
        item.workerId === workerId;

      if (!sameKey && !sameOwnedProcessing) {
        return item;
      }

      return {
        ...item,
        ...patch,
        updatedAt: now,
      };
    });
  }

  async function ensureWorkerLease(platform: SourcePlatform): Promise<WorkerLeaseState> {
    const state = await loadQueueState();
    const idleWorker = state.activeWorkers.find((worker) => worker.platform === platform && !worker.busy);
    if (idleWorker) return idleWorker;

    const worker: WorkerLeaseState = {
      workerId: crypto.randomUUID(),
      platform,
      role: "export",
      busy: false,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    await updateQueueStateWithDerived((current) => ({
      ...current,
      activeWorkers: [...current.activeWorkers, worker],
    }));

    return worker;
  }

  async function resolveWorkerTab(worker: WorkerLeaseState, targetUrl: string, config: PlatformRuntimeConfig): Promise<number> {
    const workerUrl = new URL(targetUrl);
    workerUrl.searchParams.set("aiexporter_worker", "1");
    const navigableUrl = workerUrl.toString();

    if (!config.reuseWorkerTabs && worker.tabId) {
      await browser.tabs.remove(worker.tabId).catch(() => undefined);
      await patchWorkerLease(worker.workerId, { tabId: undefined });
    }

    if (config.reuseWorkerTabs && worker.tabId) {
      try {
        await browser.tabs.get(worker.tabId);
        await browser.tabs.update(worker.tabId, { url: navigableUrl, active: false, pinned: true });
        return worker.tabId;
      } catch {
        await removeWorkerLease(worker.workerId);
      }
    }

    const tab = await browser.tabs.create({
      url: navigableUrl,
      active: false,
      pinned: true,
    });
    await patchWorkerLease(worker.workerId, { tabId: tab.id });
    return tab.id!;
  }

  async function closePlatformTransientTabs(platform: SourcePlatform): Promise<void> {
    const queryPatterns = getPlatformTabQueryPatterns(platform);
    if (queryPatterns.length === 0) return;
    const tabs = await browser.tabs.query({ url: queryPatterns });
    for (const tab of tabs) {
      if (typeof tab.id !== "number") continue;
      if (tab.url?.includes("aiexporter_worker=1")) {
        await closeWorkerTab(tab.id, intentionalWorkerTabClosures);
        continue;
      }
      if (tab.url?.includes("aiexporter_discovery=1")) {
        await browser.tabs.remove(tab.id).catch(() => undefined);
      }
    }
  }

  async function runWorkerTask(platform: SourcePlatform, worker: WorkerLeaseState, item: ExportQueueItem): Promise<void> {
    let tabId: number | undefined;
    const beforeState = await loadQueueState();
    const config = getPlatformConfig(beforeState.settings, platform);
    const runEpoch = getPlatformExecutionEpoch(platform);
    const traceId = crypto.randomUUID();
    const traceLog = createTraceLogger("background.queue", {
      platform,
      sourceId: item.event.sourceId,
      workerId: worker.workerId,
      traceId,
      key: item.key,
    });
    const workerStartedAt = Date.now();
    let errorCode: string | undefined;

    try {
      await traceLog("info", "Worker accepted queue item.", {
        code: "worker.started",
        targetUrl: item.event.url,
        priority: item.priority,
        attempts: item.attempts + 1,
      });

      const tabStartedAt = Date.now();
      tabId = await resolveWorkerTab(worker, item.event.url, config);
      await traceLog("debug", "Worker tab resolved.", {
        code: "worker.tab_resolved",
        tabId,
        durationMs: Date.now() - tabStartedAt,
        reuseWorkerTabs: config.reuseWorkerTabs,
      });

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        return;
      }

      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: patchQueueItem(current.items, item.key, {
          status: "processing",
          attempts: item.attempts + 1,
          workerId: worker.workerId,
          lastError: undefined,
        }),
        activeWorkers: current.activeWorkers.map((lease) =>
          lease.workerId === worker.workerId
            ? {
                ...lease,
                busy: true,
                currentQueueKey: item.key,
                tabId,
                lastActiveAt: new Date().toISOString(),
              }
            : lease,
        ),
        services: {
          ...current.services,
          [platform]: {
            ...current.services[platform],
            nextPlannedRunAt: new Date(Date.now() + config.minStartIntervalMs).toISOString(),
            lastError: undefined,
          },
        },
      }));

      try {
        await waitForTabComplete(tabId, config.navigationTimeoutMs);
        await traceLog("debug", "Worker tab reached complete state.", {
          code: "worker.tab_ready",
          tabId,
        });
      } catch (error) {
        await writeBackgroundLog("background.worker", "warn", "Worker tab did not reach complete state before timeout, falling back to receiver readiness.", {
          code: "worker.load_timeout_fallback",
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          tabId,
          targetUrl: item.event.url,
          error: getErrorMessage(error, "Timed out waiting for conversation tab to load."),
        });
      }
      const receiverStartedAt = Date.now();
      tabId = await ensureWorkerReceiver(worker, tabId, item.event.url, config, {
        sourceId: item.event.sourceId,
        traceId,
      });
      await traceLog("debug", "Worker receiver became ready.", {
        code: "worker.receiver_ready",
        tabId,
        durationMs: Date.now() - receiverStartedAt,
      });
      const currentTab = await browser.tabs.get(tabId);
      if (isChallengeLikeTab(currentTab)) {
        errorCode = "worker.challenge_detected";
        throw new Error("Verification or challenge page detected.");
      }

      await new Promise((resolve) => setTimeout(resolve, config.settleDelayMs));
      const extractStartedAt = Date.now();
      const bundle = await extractConversationFromTab(tabId, config.navigationTimeoutMs + 15_000);
      await traceLog("info", "Extracted conversation bundle from worker tab.", {
        code: "worker.extract_completed",
        tabId,
        messageCount: bundle.messages.length,
        durationMs: Date.now() - extractStartedAt,
      });

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        await removeWorkerLease(worker.workerId);
        return;
      }

      const latestState = await loadQueueState();
      const persistStartedAt = Date.now();
      const persisted = await persistBundle(bundle, latestState.settings, {
        traceId,
        workerId: worker.workerId,
        sourceId: item.event.sourceId,
      });
      await traceLog("info", "Persisted conversation bundle to local artifacts.", {
        code: "worker.persist_completed",
        revision: persisted.revision,
        skipped: persisted.skipped ?? false,
        fileCount: persisted.files.length,
        durationMs: Date.now() - persistStartedAt,
      });

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        await removeWorkerLease(worker.workerId);
        return;
      }

      await markBundleExportResult(persisted.bundle, persisted.revision, "exported");

      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: patchWorkerOwnedQueueItems(current.items, item, worker.workerId, {
          status: persisted.skipped ? "skipped" : "completed",
          workerId: undefined,
          skipReason: persisted.skipped ? "latest_exists" : undefined,
          resultRevision: persisted.revision,
          errorCode: undefined,
        }),
        activeWorkers: current.activeWorkers.map((lease) =>
          lease.workerId === worker.workerId
            ? {
                ...lease,
                busy: false,
                currentQueueKey: undefined,
                tabId,
                lastActiveAt: new Date().toISOString(),
              }
            : lease,
        ),
        lastProcessedAt: new Date().toISOString(),
        services: {
          ...current.services,
          [platform]: {
            ...current.services[platform],
            lastExportAt: new Date().toISOString(),
            lastError: undefined,
          },
        },
      }));

      const settledState = await loadQueueState();
      const queueStillProcessing = settledState.items.some(
        (queueItem) =>
          queueItem.platform === platform &&
          queueItem.event.sourceId === item.event.sourceId &&
          queueItem.status === "processing" &&
          queueItem.workerId === worker.workerId,
      );
      const workerStillBusy = settledState.activeWorkers.some(
        (lease) => lease.workerId === worker.workerId && lease.busy,
      );

      if (queueStillProcessing || workerStillBusy) {
        await updateQueueStateWithDerived((current) => ({
          ...current,
          items: patchWorkerOwnedQueueItems(current.items, item, worker.workerId, {
            status: persisted.skipped ? "skipped" : "completed",
            workerId: undefined,
            skipReason: persisted.skipped ? "latest_exists" : undefined,
            resultRevision: persisted.revision,
            errorCode: undefined,
          }),
          activeWorkers: current.activeWorkers.map((lease) =>
            lease.workerId === worker.workerId
              ? {
                  ...lease,
                  busy: false,
                  currentQueueKey: undefined,
                  tabId,
                  lastActiveAt: new Date().toISOString(),
                }
              : lease,
          ),
        }));

        await writeBackgroundLog("background.queue", "warn", "Reconciled worker state after completion because a busy or processing lease remained.", {
          code: "worker.completion_reconciled",
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          key: item.key,
          queueStillProcessing,
          workerStillBusy,
        });
      }

      await writeBackgroundLog(
        "background.queue",
        "info",
        persisted.skipped
          ? "Worker skipped queue item because latest artifact already exists."
          : "Worker completed queue item.",
        {
          code: persisted.skipped ? "download.existing_latest" : undefined,
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          key: item.key,
          revision: persisted.revision,
          files: persisted.files,
          durationMs: Date.now() - workerStartedAt,
        },
      );

      if (!config.reuseWorkerTabs && tabId) {
        await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        await patchWorkerLease(worker.workerId, { tabId: undefined });
      }
    } catch (error) {
      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        await removeWorkerLease(worker.workerId);
        return;
      }
      const lastError = getErrorMessage(error, "Unknown worker error");
      if (!errorCode && isReceiverUnavailableError(error)) {
        errorCode = "worker.receiver_unavailable";
      }
      if (!errorCode && lastError.toLowerCase().includes("timed out")) {
        errorCode = "worker.navigation_timeout";
      }
      const shouldAutoRetryReceiver =
        errorCode === "worker.receiver_unavailable" && item.attempts + 1 < Math.max(3, config.receiverRetryLimit + 2);
      const shouldAutoRetryChallenge = isGooglePlatform(platform) && isChallengeErrorCode(errorCode, lastError);
      const shouldAutoRetry = shouldAutoRetryReceiver || shouldAutoRetryChallenge;
      const cooldownUntil = shouldAutoRetryChallenge ? new Date(Date.now() + GOOGLE_CHALLENGE_COOLDOWN_MS).toISOString() : undefined;
      const currentState = await loadQueueState();

      await updateConversationIndex((entries) =>
        entries.map((entry) =>
          entry.platform === platform && entry.sourceId === item.event.sourceId
            ? {
                ...entry,
                exportState: shouldAutoRetry ? "pending" : "failed",
              }
            : entry,
        ),
      );

      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: patchWorkerOwnedQueueItems(current.items, item, worker.workerId, {
          status: shouldAutoRetry ? "pending" : "failed",
          priority: shouldAutoRetry ? "retry" : item.priority,
          workerId: undefined,
          lastError: shouldAutoRetryReceiver ? undefined : lastError,
          errorCode: shouldAutoRetry ? undefined : errorCode,
        }),
        activeWorkers: current.activeWorkers.map((lease) =>
          lease.workerId === worker.workerId
            ? {
                ...lease,
                busy: false,
                currentQueueKey: undefined,
                lastActiveAt: new Date().toISOString(),
              }
            : lease,
        ),
        lastProcessedAt: new Date().toISOString(),
        services: {
          ...current.services,
          [platform]: {
            ...current.services[platform],
            nextPlannedRunAt: cooldownUntil ?? current.services[platform].nextPlannedRunAt,
            lastError: shouldAutoRetryReceiver ? undefined : lastError,
          },
        },
      }));

      if (shouldAutoRetryReceiver) {
        await writeBackgroundLog("background.queue", "warn", "Worker receiver was unavailable, requeued queue item for retry.", {
          code: errorCode,
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          key: item.key,
          attempts: item.attempts + 1,
          durationMs: Date.now() - workerStartedAt,
          queue: summarizeQueueItems(currentState.items),
        });
      } else if (shouldAutoRetryChallenge) {
        await writeBackgroundLog("background.queue", "warn", "Google platform challenge detected, cooling down before retrying the queue item.", {
          code: errorCode,
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          key: item.key,
          attempts: item.attempts + 1,
          cooldownUntil,
          durationMs: Date.now() - workerStartedAt,
          queue: summarizeQueueItems(currentState.items),
        });
      } else {
        await writeBackgroundError("background.queue", errorCode ?? "worker.unknown", "Worker failed queue item.", {
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          traceId,
          key: item.key,
          lastError,
          durationMs: Date.now() - workerStartedAt,
          queue: summarizeQueueItems(currentState.items),
        });
      }

      if (tabId) {
        await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        await removeWorkerLease(worker.workerId);
      }
    } finally {
      if (isPlatformExecutionCurrent(platform, runEpoch)) {
        requestPlatformTick(platform);
      }
    }
  }

  function schedulePlatformAlarm(platform: SourcePlatform, whenMs: number): void {
    browser.alarms.create(getPlatformAlarmName(platform), {
      when: whenMs,
    });
  }

  async function maybeRunPlatformDiscovery(platform: SourcePlatform, queueState: QueueState): Promise<void> {
    const config = getPlatformConfig(queueState.settings, platform);
    const service = getPlatformService(queueState, platform);
    if (!service.desiredRunning || !config.enabled || !config.autoExportEnabled) return;
    if (!config.historyBackfillEnabled || config.discoveryMode !== "background_backfill") return;
    if (service.activeDiscoveryTabs > 0) return;
    const workerSnapshot = getPlatformWorkerSnapshot(queueState, platform);
    if (workerSnapshot.ghostBusyWorkers.length > 0) {
      await writeBackgroundLog("background.discovery", "warn", "Ignoring ghost busy workers while deciding whether discovery can run.", {
        code: "discovery.ghost_busy_workers_ignored",
        platform,
        ignoredWorkers: workerSnapshot.ghostBusyWorkers.map((worker) => worker.workerId),
      });
    }
    if (isGooglePlatform(platform) && workerSnapshot.busyWorkers.length > 0) return;
    const now = Date.now();
    const nextPlannedAt = service.nextPlannedRunAt ? Date.parse(service.nextPlannedRunAt) : 0;
    if (
      isGooglePlatform(platform) &&
      nextPlannedAt > now &&
      isChallengeErrorCode(undefined, service.lastError ?? "")
    ) {
      schedulePlatformAlarm(platform, nextPlannedAt);
      await writeBackgroundLog("background.discovery", "debug", "Google platform discovery is cooling down after a challenge page was detected.", {
        code: "discovery.challenge_cooldown",
        platform,
        nextPlannedAt: new Date(nextPlannedAt).toISOString(),
      });
      return;
    }

    const hasOutstandingQueueWork = hasOutstandingPlatformQueueWork(queueState, platform);
    const shouldRunBootstrap = shouldRunInitialBootstrapDiscovery(service, config);
    const shouldForceHistoryCatchup = shouldForceGeminiHistoryCatchup(service);
    const shouldPreferQueueDrainBeforeCatchup =
      platform === "gemini" && hasOutstandingQueueWork && service.stats.discoveredTotal > 0;

    if (platformStartupCatchup.has(platform)) {
      platformStartupCatchup.delete(platform);
      if (shouldRunBootstrap) {
        await runPlatformDiscoverySweep(platform, "full-bootstrap");
        return;
      }

      if (shouldPreferQueueDrainBeforeCatchup) {
        await writeBackgroundLog("background.discovery", "debug", "Deferred Gemini catch-up discovery until the first discovered export backlog drains.", {
          code: "discovery.deferred_until_queue_drains",
          platform,
          lastDiscoveryAt: service.lastDiscoveryAt,
          discoveredTotal: service.stats.discoveredTotal,
          pending: service.stats.pending,
          processing: service.stats.processing,
        });
        return;
      }

      if (shouldForceHistoryCatchup) {
        await writeBackgroundLog("background.discovery", "info", "Running Gemini catch-up discovery before draining the full export backlog because the previous bootstrap was partial.", {
          code: "discovery.gemini_partial_catchup",
          platform,
          discoveredTotal: service.stats.discoveredTotal,
          highestHistoricalCountSeen: service.meta?.highestHistoricalCountSeen ?? 0,
          pending: service.stats.pending,
        });
        await runPlatformDiscoverySweep(platform, "full-bootstrap");
        return;
      }

      if (hasOutstandingQueueWork) {
        await writeBackgroundLog("background.discovery", "debug", "Deferred startup discovery because export work is already queued.", {
          code: "discovery.deferred_until_queue_drains",
          platform,
          lastDiscoveryAt: service.lastDiscoveryAt,
          discoveredTotal: service.stats.discoveredTotal,
          pending: service.stats.pending,
          processing: service.stats.processing,
        });
        return;
      }

      await runPlatformDiscoverySweep(platform, "best-effort");
      return;
    }

    if (shouldRunBootstrap) {
      await runPlatformDiscoverySweep(platform, "full-bootstrap");
      return;
    }

    if (shouldPreferQueueDrainBeforeCatchup) {
      await writeBackgroundLog("background.discovery", "debug", "Deferred Gemini catch-up discovery until the first discovered export backlog drains.", {
        code: "discovery.deferred_until_queue_drains",
        platform,
        lastDiscoveryAt: service.lastDiscoveryAt,
        discoveredTotal: service.stats.discoveredTotal,
        pending: service.stats.pending,
        processing: service.stats.processing,
      });
      return;
    }

    if (shouldForceHistoryCatchup) {
      await writeBackgroundLog("background.discovery", "info", "Running Gemini catch-up discovery because the current history set is still far below the previous high-water mark.", {
        code: "discovery.gemini_partial_catchup",
        platform,
        discoveredTotal: service.stats.discoveredTotal,
        highestHistoricalCountSeen: service.meta?.highestHistoricalCountSeen ?? 0,
        pending: service.stats.pending,
      });
      await runPlatformDiscoverySweep(platform, "full-bootstrap");
      return;
    }

    if (hasOutstandingQueueWork) {
      await writeBackgroundLog("background.discovery", "debug", "Deferred scheduled discovery because export work is already queued.", {
        code: "discovery.deferred_until_queue_drains",
        platform,
        lastDiscoveryAt: service.lastDiscoveryAt,
        discoveredTotal: service.stats.discoveredTotal,
        pending: service.stats.pending,
        processing: service.stats.processing,
      });
      return;
    }

    const dueAt = service.lastDiscoveryAt ? Date.parse(service.lastDiscoveryAt) + config.discoverySweepIntervalMs : 0;
    if (service.lastDiscoveryAt && dueAt > now) {
      schedulePlatformAlarm(platform, dueAt);
      return;
    }

    await runPlatformDiscoverySweep(platform, "best-effort");
  }

  async function maybeStartNextPlatformWorker(platform: SourcePlatform, queueState: QueueState): Promise<void> {
    const service = getPlatformService(queueState, platform);
    const config = getPlatformConfig(queueState.settings, platform);
    if (!service.desiredRunning || !config.enabled || !config.autoExportEnabled) return;
    if (isGooglePlatform(platform) && service.activeDiscoveryTabs > 0) {
      await writeBackgroundLog("background.queue", "debug", "Worker start delayed until Google discovery sweep finishes.", {
        platform,
        activeDiscoveryTabs: service.activeDiscoveryTabs,
        queue: summarizeQueueItems(queueState.items),
      });
      return;
    }

    const targetWorkers = getTargetWorkerCount(service, config);
    const workerSnapshot = getPlatformWorkerSnapshot(queueState, platform);
    if (workerSnapshot.ghostBusyWorkers.length > 0) {
      await writeBackgroundLog("background.queue", "warn", "Ignoring ghost busy workers while deciding whether another worker can start.", {
        code: "worker.ghost_busy_workers_ignored",
        platform,
        ignoredWorkers: workerSnapshot.ghostBusyWorkers.map((worker) => worker.workerId),
      });
    }
    const idleWorker = workerSnapshot.idleWorkers[0];
    const busyWorkers = workerSnapshot.busyWorkers.length;
    if (!idleWorker && busyWorkers >= targetWorkers) {
      await writeBackgroundLog("background.queue", "debug", "Worker start skipped because busy worker limit was reached.", {
        platform,
        busyWorkers,
        targetWorkers,
        queue: summarizeQueueItems(queueState.items),
      });
      return;
    }

    const nextPlannedAt = service.nextPlannedRunAt ? Date.parse(service.nextPlannedRunAt) : 0;
    if (nextPlannedAt > Date.now()) {
      schedulePlatformAlarm(platform, nextPlannedAt);
      await writeBackgroundLog("background.queue", "debug", "Worker start delayed by minStartInterval.", {
        platform,
        nextPlannedAt: new Date(nextPlannedAt).toISOString(),
        queue: summarizeQueueItems(queueState.items),
      });
      return;
    }

    let nextItem = pickNextPlatformItem(queueState, platform);
    if (!nextItem) {
      const restored = await hydratePendingQueueFromIndex(platform);
      if (restored > 0) {
        const refreshedState = await loadQueueState();
        nextItem = pickNextPlatformItem(refreshedState, platform);
        if (nextItem) {
          await writeBackgroundLog("background.queue", "info", "Recovered pending work from conversation index.", {
            platform,
            restored,
            queue: summarizeQueueItems(refreshedState.items),
          });
        }
      }
    }

    if (!nextItem) {
      await writeBackgroundLog("background.queue", "debug", "Worker start skipped because no pending queue item was found.", {
        platform,
        queue: summarizeQueueItems(queueState.items),
      });
      return;
    }

    const worker = idleWorker ?? (await ensureWorkerLease(platform));
    await writeBackgroundLog("background.queue", "info", "Starting worker for queue item.", {
      platform,
      workerId: worker.workerId,
      key: nextItem.key,
      sourceId: nextItem.event.sourceId,
      priority: nextItem.priority,
      queue: summarizeQueueItems(queueState.items),
    });
    void runWorkerTask(platform, worker, nextItem);
  }

  async function recoverStaleBusyWorkers(platform: SourcePlatform): Promise<number> {
    const now = Date.now();
    const state = await loadQueueState();
    const staleWorkers = state.activeWorkers.filter((worker) => {
      if (worker.platform !== platform || !worker.busy) return false;
      const lastActiveAt = Date.parse(worker.lastActiveAt);
      return !Number.isNaN(lastActiveAt) && now - lastActiveAt >= STALE_BUSY_WORKER_RECOVERY_MS;
    });

    if (staleWorkers.length === 0) {
      return 0;
    }

    for (const staleWorker of staleWorkers) {
      if (typeof staleWorker.tabId === "number") {
        await closeWorkerTab(staleWorker.tabId, intentionalWorkerTabClosures);
      }
    }

    const staleWorkerIds = new Set(staleWorkers.map((worker) => worker.workerId));
    await updateQueueStateWithDerived((current) => ({
      ...current,
      activeWorkers: current.activeWorkers.filter((worker) => !staleWorkerIds.has(worker.workerId)),
    }));

    await writeBackgroundLog("background.queue", "warn", "Recovered stale busy workers.", {
      code: "worker.stale_busy_recovered",
      platform,
      recoveredWorkers: staleWorkers.length,
      workerIds: staleWorkers.map((worker) => worker.workerId),
    });

    return staleWorkers.length;
  }

  async function cleanupOrphanedWorkerTabs(platform: SourcePlatform): Promise<number> {
    const state = await loadQueueState();
    const trackedTabIds = new Set(
      state.activeWorkers
        .filter((worker) => worker.platform === platform && typeof worker.tabId === "number")
        .map((worker) => worker.tabId as number),
    );

    const queryPatterns = getPlatformTabQueryPatterns(platform);
    if (queryPatterns.length === 0) return 0;

    const tabs = await browser.tabs.query({ url: queryPatterns });
    const orphanedTabs = tabs.filter(
      (tab) => typeof tab.id === "number" && tab.url?.includes("aiexporter_worker=1") && !trackedTabIds.has(tab.id),
    );

    for (const orphanedTab of orphanedTabs) {
      await closeWorkerTab(orphanedTab.id, intentionalWorkerTabClosures);
    }

    if (orphanedTabs.length > 0) {
      await writeBackgroundLog("background.queue", "warn", "Closed orphaned worker tabs.", {
        code: "worker.orphaned_tabs_closed",
        platform,
        closedTabs: orphanedTabs.length,
        tabIds: orphanedTabs.map((tab) => tab.id),
      });
    }

    return orphanedTabs.length;
  }

  async function cleanupOrphanedDiscoveryTabs(platform: SourcePlatform): Promise<number> {
    if (getPlatformDiscoveryRunCount(platform) > 0) {
      return 0;
    }

    const queryPatterns = getPlatformTabQueryPatterns(platform);
    if (queryPatterns.length === 0) return 0;

    const tabs = await browser.tabs.query({ url: queryPatterns });
    const orphanedTabs = tabs.filter((tab) => typeof tab.id === "number" && tab.url?.includes("aiexporter_discovery=1"));

    for (const orphanedTab of orphanedTabs) {
      await browser.tabs.remove(orphanedTab.id!).catch(() => undefined);
    }

    if (orphanedTabs.length > 0) {
      await writeBackgroundLog("background.discovery", "warn", "Closed orphaned discovery tabs.", {
        code: "discovery.orphaned_tabs_closed",
        platform,
        closedTabs: orphanedTabs.length,
        tabIds: orphanedTabs.map((tab) => tab.id),
      });
    }

    return orphanedTabs.length;
  }

  async function cleanupIdleWorkerLeases(platform: SourcePlatform, options: { force?: boolean } = {}): Promise<number> {
    const state = await loadQueueState();
    const config = getPlatformConfig(state.settings, platform);
    const hasOutstandingWork = state.items.some(
      (item) => item.platform === platform && (item.status === "pending" || item.status === "processing"),
    );
    const platformWorkers = state.activeWorkers.filter((worker) => worker.platform === platform);
    const idleWorkers = platformWorkers.filter((worker) => !worker.busy);
    if (idleWorkers.length === 0) {
      return 0;
    }

    let workersToClose = idleWorkers;
    if (hasOutstandingWork && !options.force) {
      const busyCount = platformWorkers.length - idleWorkers.length;
      const keepIdleCount = busyCount < config.maxConcurrency ? 1 : 0;
      workersToClose = idleWorkers.slice(keepIdleCount);
      if (workersToClose.length === 0) {
        return 0;
      }
    }

    for (const idleWorker of workersToClose) {
      if (typeof idleWorker.tabId === "number") {
        await closeWorkerTab(idleWorker.tabId, intentionalWorkerTabClosures);
      }
    }

    const idleWorkerIds = new Set(workersToClose.map((worker) => worker.workerId));
    await updateQueueStateWithDerived((current) => ({
      ...current,
      activeWorkers: current.activeWorkers.filter((worker) => !idleWorkerIds.has(worker.workerId)),
    }));

    await writeBackgroundLog("background.queue", "info", "Closed idle worker tabs after the platform returned to idle.", {
      code: "worker.idle_tabs_closed",
      platform,
      closedWorkers: workersToClose.length,
      workerIds: workersToClose.map((worker) => worker.workerId),
    });

    return workersToClose.length;
  }

  async function runPlatformTick(platform: SourcePlatform): Promise<void> {
    await cleanupOrphanedDiscoveryTabs(platform);
    await cleanupOrphanedWorkerTabs(platform);
    await recoverStaleBusyWorkers(platform);
    await recoverOrphanedProcessingItems(platform);
    const rehydrated = await hydratePendingQueueFromIndex(platform);
    if (rehydrated > 0) {
      await writeBackgroundLog("background.queue", "info", "Filled missing queue items from pending conversation index entries before running the platform tick.", {
        code: "queue.pending_rehydrated_before_tick",
        platform,
        restored: rehydrated,
      });
    }
    const state = await loadQueueState();
    const service = getPlatformService(state, platform);
    const config = getPlatformConfig(state.settings, platform);

    if (!config.enabled) {
      await patchPlatformService(platform, {
        desiredRunning: false,
        status: "paused",
      });
      return;
    }

    if (!service.desiredRunning) {
      await cleanupIdleWorkerLeases(platform, { force: true });
      await refreshQueueServices();
      return;
    }

    await maybeRunPlatformDiscovery(platform, await loadQueueState());
    await maybeStartNextPlatformWorker(platform, await loadQueueState());
    await cleanupIdleWorkerLeases(platform);
    await refreshQueueServices();
  }

  function requestPlatformTick(platform: SourcePlatform): void {
    const current = platformTickState.get(platform);
    if (current?.running) {
      current.rerun = true;
      return;
    }

    platformTickState.set(platform, { running: true, rerun: false });
    void runPlatformTick(platform)
      .catch(async (error) => {
        const errorMessage = error instanceof Error ? error.message : "Platform service tick failed.";
        await patchPlatformService(platform, {
          status: "error",
          lastError: errorMessage,
        });
        await writeBackgroundLog("background.service", "error", "Platform service tick failed.", {
          platform,
          errorMessage,
        });
      })
      .finally(() => {
        const snapshot = platformTickState.get(platform);
        if (snapshot?.rerun) {
          platformTickState.set(platform, { running: false, rerun: false });
          requestPlatformTick(platform);
          return;
        }
        platformTickState.delete(platform);
      });
  }

  function requestPlatformStartupCatchup(platform: SourcePlatform): void {
    platformStartupCatchup.add(platform);
    requestPlatformTick(platform);
  }

  async function updatePlatformDesiredRunning(platform: SourcePlatform, desiredRunning: boolean): Promise<QueueState> {
    if (!desiredRunning) {
      bumpPlatformExecutionEpoch(platform);
      platformStartupCatchup.delete(platform);
      endPlatformDiscoveryRun(platform);
      await closePlatformTransientTabs(platform);
      return updateQueueStateWithDerived((current) => {
        const now = new Date().toISOString();
        return {
          ...current,
          items: current.items.map((item) =>
            item.platform === platform && item.status === "processing"
              ? {
                  ...item,
                  status: "pending",
                  priority: "retry",
                  workerId: undefined,
                  lastError: undefined,
                  errorCode: undefined,
                  updatedAt: now,
                }
              : item,
          ),
          activeWorkers: current.activeWorkers.filter((worker) => worker.platform !== platform),
          services: {
            ...current.services,
            [platform]: {
              ...current.services[platform],
              desiredRunning: false,
              status: "paused",
              activeWorkers: 0,
              activeDiscoveryTabs: 0,
              lastError: undefined,
            },
          },
        };
      });
    }

    await markPlatformCompatibilityReexportsPending(platform);
    const nextState = await updateQueueStateWithDerived((current) => ({
      ...current,
      services: {
        ...current.services,
        [platform]: {
          ...current.services[platform],
          desiredRunning,
          status: "starting",
          lastError: undefined,
        },
      },
    }));

    if (desiredRunning) {
      requestPlatformTick(platform);
    }

    return nextState;
  }

  async function clearPlatformLocalRecords(platform: SourcePlatform): Promise<QueueState> {
    const clearEpoch = bumpPlatformExecutionEpoch(platform);
    const stateBeforeClear = await loadQueueState();
    const workerTabIds = stateBeforeClear.activeWorkers
      .filter((worker) => worker.platform === platform)
      .map((worker) => worker.tabId)
      .filter((tabId): tabId is number => typeof tabId === "number");

    for (const workerTabId of workerTabIds) {
      await closeWorkerTab(workerTabId, intentionalWorkerTabClosures);
    }

    const artifacts = await loadArtifactIndex();
    const targetArtifacts = artifacts.filter((entry) => entry.platform === platform);

    for (const artifact of targetArtifacts) {
      await removeDownloadedAsset(artifact.markdownDownloadId);
      await removeDownloadedAsset(artifact.bundleDownloadId);
    }

    await saveArtifactIndex(artifacts.filter((entry) => entry.platform !== platform));
    await saveConversationIndex((await loadConversationIndex()).filter((entry) => entry.platform !== platform));

    let recycledPaths = 0;
    try {
      const exportRoot = (await resolveExportRootWithNativeHost(getConfiguredExportRoot(stateBeforeClear.settings))).path;
      if (exportRoot) {
        const candidateRoots = [
          `${exportRoot}\\AIexporter\\${sanitizePathSegment(platform)}`,
          `${exportRoot}\\AIexporter\\Archive\\${sanitizePathSegment(platform)}`,
        ];

        for (const candidateRoot of candidateRoots) {
          const existing = await checkPathExistsWithNativeHost(candidateRoot);
          if (!existing.path) {
            continue;
          }
          await recyclePathWithNativeHost(candidateRoot);
          recycledPaths += 1;
        }
      }
    } catch (error) {
      await writeBackgroundLog("background.cleanup", "warn", "Best-effort platform file cleanup failed before sync.", {
        platform,
        error: getErrorMessage(error, "Platform file cleanup failed."),
      });
    }

    let syncSummary:
      | {
          verifiedCount: number;
          missingCount: number;
          importedCount: number;
          requeued: number;
        }
      | undefined;
    try {
      const syncResult = await syncArtifactsWithDisk(stateBeforeClear.settings, platform);
      await recordArtifactSyncCompleted();
      syncSummary = {
        verifiedCount: syncResult.verifiedCount,
        missingCount: syncResult.missingCount,
        importedCount: syncResult.importedCount,
        requeued: syncResult.requeueEvents.length,
      };
    } catch (error) {
      await writeBackgroundLog("background.cleanup", "warn", "Best-effort artifact sync failed after clearing local records.", {
        platform,
        error: getErrorMessage(error, "Artifact sync after clear failed."),
      });
    }

    const currentState = await loadQueueState();
    const config = getPlatformConfig(currentState.settings, platform);
    const desiredRunning =
      !currentState.settings.scheduler.globalPaused && config.enabled && config.autoExportEnabled;

    const nextState = await updateQueueStateWithDerived((current) => ({
      ...current,
      items: current.items.filter((item) => item.platform !== platform),
      activeWorkers: current.activeWorkers.filter((worker) => worker.platform !== platform),
      services: {
        ...current.services,
        [platform]: {
          ...current.services[platform],
          desiredRunning,
          activeWorkers: 0,
          activeDiscoveryTabs: 0,
          status: desiredRunning ? "starting" : "paused",
          lastDiscoveryAt: undefined,
          lastExportAt: undefined,
          nextPlannedRunAt: undefined,
          lastError: undefined,
        },
      },
    }));

    await writeBackgroundLog("background.cleanup", "warn", "Cleared local platform records.", {
      platform,
      deletedArtifactCount: targetArtifacts.length,
      recycledPaths,
      syncSummary,
      desiredRunning,
    });

    if (desiredRunning) {
      if (config.bootstrapRequireFullHistory) {
        void runPlatformDiscoverySweep(platform, "full-bootstrap").finally(() => {
          if (isPlatformExecutionCurrent(platform, clearEpoch)) {
            requestPlatformTick(platform);
          }
        });
      } else {
        requestPlatformTick(platform);
      }
    }

    return nextState;
  }

  async function handleTabRemoved(tabId: number): Promise<void> {
    const intentional = intentionalWorkerTabClosures.delete(tabId);
    await updateQueueStateWithDerived((current) => {
      const matchedWorkers = current.activeWorkers.filter((worker) => worker.tabId === tabId);
      if (matchedWorkers.length === 0) {
        return current;
      }

      const matchedWorkerIds = new Set(matchedWorkers.map((worker) => worker.workerId));
      const now = new Date().toISOString();

      return {
        ...current,
        items: intentional
          ? current.items
          : current.items.map((item) =>
              item.status === "processing" && item.workerId && matchedWorkerIds.has(item.workerId)
                ? {
                    ...item,
                    status: "pending",
                    priority: "retry",
                    workerId: undefined,
                    lastError: undefined,
                    errorCode: undefined,
                    updatedAt: now,
                  }
                : item,
            ),
        activeWorkers: current.activeWorkers.map((worker) =>
          worker.tabId === tabId
            ? {
                ...worker,
                tabId: undefined,
                busy: intentional ? worker.busy : false,
                currentQueueKey: intentional ? worker.currentQueueKey : undefined,
                lastActiveAt: now,
              }
            : worker,
        ),
      };
    });
  }

  return {
    clearPlatformLocalRecords,
    extractConversationFromTab,
    handleTabRemoved,
    queuePassiveDiscoveryEvent,
    queuePassiveDiscoveryEvents,
    requestPlatformStartupCatchup,
    requestPlatformTick,
    runPlatformDiscoverySweep,
    updatePlatformDesiredRunning,
  };
}
