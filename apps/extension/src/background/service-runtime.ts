import {
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
import { writeBackgroundError, writeBackgroundLog } from "../runtime/logger";
import {
  loadArtifactIndex,
  loadConversationIndex,
  loadQueueState,
  saveArtifactIndex,
  saveConversationIndex,
  updateConversationIndex,
} from "../runtime/storage";
import { markBundleExportResult, persistBundle } from "./artifact-persistence";
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
import { getPlatformAlarmName } from "./shared";
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

export interface BackgroundServiceRuntime {
  clearPlatformLocalRecords(platform: SourcePlatform): Promise<QueueState>;
  extractConversationFromTab(tabId: number, timeoutMs: number): Promise<ConversationBundle>;
  handleTabRemoved(tabId: number): Promise<void>;
  queuePassiveDiscoveryEvent(event: DiscoveryEvent): Promise<{ total: number; queued: number }>;
  requestPlatformStartupCatchup(platform: SourcePlatform): void;
  requestPlatformTick(platform: SourcePlatform): void;
  runPlatformDiscoverySweep(platform: SourcePlatform, mode?: DiscoverySweepMode): Promise<void>;
  updatePlatformDesiredRunning(platform: SourcePlatform, desiredRunning: boolean): Promise<QueueState>;
}

export function createBackgroundServiceRuntime(): BackgroundServiceRuntime {
  const platformTickState = new Map<SourcePlatform, { running: boolean; rerun: boolean }>();
  const platformDiscoveryRuns = new Set<SourcePlatform>();
  const platformStartupCatchup = new Set<SourcePlatform>();
  const platformExecutionEpoch = new Map<SourcePlatform, number>();
  const intentionalWorkerTabClosures = new Set<number>();

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

  function getDiscoveryResponseTimeoutMs(platform: SourcePlatform, config: PlatformRuntimeConfig): number {
    const baseline = config.discoveryReadyTimeoutMs + 10_000;
    if (platform === "gemini") return Math.max(baseline, 180_000);
    if (platform === "aistudio") return Math.max(baseline, 60_000);
    return baseline;
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
          existing.exportState !== "exported";

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

  function buildEventFromConversationIndex(entry: ConversationIndexEntry): DiscoveryEvent {
    return {
      platform: entry.platform,
      sourceId: entry.sourceId,
      url: entry.url,
      title: entry.title,
      sourceUpdatedAt: entry.latestSourceUpdatedAt,
      sourceUpdatedLabel: entry.latestSourceUpdatedLabel,
      revisionFingerprint: entry.latestDiscoveryFingerprint,
    };
  }

  async function hydratePendingQueueFromIndex(platform: SourcePlatform): Promise<number> {
    const [conversationIndex, queueState] = await Promise.all([loadConversationIndex(), loadQueueState()]);
    const candidateEntries = conversationIndex.filter(
      (entry) => entry.platform === platform && entry.exportState === "pending" && entry.latestDiscoveryFingerprint,
    );

    if (candidateEntries.length === 0) {
      return 0;
    }

    const queueKeys = new Set(queueState.items.map((item) => item.key));
    const queueableEvents = candidateEntries
      .map(buildEventFromConversationIndex)
      .filter((event) => !queueKeys.has(`${event.platform}:${event.sourceId}:${event.revisionFingerprint}`));

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

    await writeBackgroundLog("background.queue", "warn", "Rehydrated pending queue items from conversation index.", {
      platform,
      restored: queueableEvents.length,
    });

    return queueableEvents.length;
  }

  async function runPlatformDiscoverySweep(
    platform: SourcePlatform,
    mode: DiscoverySweepMode = "best-effort",
  ): Promise<void> {
    const discoveryUrl = getPlatformDiscoveryUrl(platform);
    if (!discoveryUrl) return;
    if (platformDiscoveryRuns.has(platform)) {
      await writeBackgroundLog("background.discovery", "debug", "Skipped platform discovery sweep because one is already running.", {
        platform,
        mode,
      });
      return;
    }

    platformDiscoveryRuns.add(platform);
    const runEpoch = getPlatformExecutionEpoch(platform);

    let tabId: number | undefined;
    let windowId: number | undefined;
    const initialState = await loadQueueState();
    await patchPlatformService(platform, {
      status: "discovering",
      activeDiscoveryTabs: getPlatformService(initialState, platform).activeDiscoveryTabs + 1,
      lastError: undefined,
    });
    const config = getPlatformConfig(initialState.settings, platform);

    try {
      if (mode === "full-bootstrap" && config.bootstrapWindowMode === "dedicated_window") {
        const discoveryWindow = await browser.windows.create({
          url: discoveryUrl,
          focused: true,
          type: "normal",
          width: 1180,
          height: 900,
        });
        windowId = discoveryWindow.id;
        tabId = discoveryWindow.tabs?.[0]?.id;
      } else {
        const tab = await browser.tabs.create({
          url: discoveryUrl,
          active: false,
        });
        tabId = tab.id;
      }

      if (!tabId) {
        throw new Error(`${platform} discovery tab could not be created.`);
      }
      try {
        await waitForTabComplete(tabId, config.navigationTimeoutMs);
      } catch (error) {
        await writeBackgroundLog(
          "background.discovery",
          "warn",
          "Discovery tab did not reach complete state before timeout, falling back to receiver readiness.",
          {
            platform,
            tabId,
            mode,
            error: error instanceof Error ? error.message : "Timed out waiting for discovery tab to load.",
          },
        );
      }

      await waitForWorkerReady(tabId, discoveryUrl, config.navigationTimeoutMs);

      const payloads = await requestTabRuntimeMessage<BridgeNetworkPayload[]>(
        tabId,
        {
          type: "collect-platform-discovery",
          platform,
          mode,
          readyTimeoutMs: config.discoveryReadyTimeoutMs,
          stableRounds: config.discoveryScrollStableRounds,
        },
        2,
        getDiscoveryResponseTimeoutMs(platform, config),
      );

      const events: DiscoveryEvent[] = [];
      for (const payload of payloads) {
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
          highestHistoricalCountSeen: Math.max(
            initialState.services[platform].meta?.highestHistoricalCountSeen ?? 0,
            batchResult.total,
          ),
          lastDiscoveryMode: mode,
          lastDiscoveryQuality:
            batchResult.total > 0 &&
            batchResult.total >= (initialState.services[platform].meta?.highestHistoricalCountSeen ?? 0)
              ? "full"
              : "partial",
        },
      });
      await writeBackgroundLog(
        "background.discovery",
        "info",
        mode === "full-bootstrap"
          ? `Completed ${platform} full bootstrap discovery sweep.`
          : `Completed ${platform} background discovery sweep.`,
        {
          code: mode === "full-bootstrap" ? "discovery.full_completed" : "discovery.partial_result",
          platform,
          tabId,
          mode,
          discovered: batchResult.total,
          queued: batchResult.queued,
        },
      );
    } catch (error) {
      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        return;
      }
      const lastError = error instanceof Error ? error.message : "DeepSeek discovery sweep failed.";
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
        },
      );
    } finally {
      platformDiscoveryRuns.delete(platform);
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
      }
    }
  }

  function getTargetWorkerCount(service: PlatformServiceState, config: PlatformRuntimeConfig): number {
    if (service.platform === "deepseek") return 1;
    if (config.maxConcurrency <= 1) return 1;
    const lowerError = service.lastError?.toLowerCase() ?? "";
    const risky = lowerError.includes("cloudflare") || lowerError.includes("verify") || lowerError.includes("timed out");
    const canScale = service.stats.pending >= 8 && service.stats.failed === 0 && !risky;
    return canScale ? Math.min(2, config.maxConcurrency) : 1;
  }

  function pickNextPlatformItem(queueState: QueueState, platform: SourcePlatform): ExportQueueItem | undefined {
    return getNextPendingItem(queueState.items.filter((item) => item.platform === platform));
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
        await browser.tabs.update(worker.tabId, { url: navigableUrl, active: false });
        return worker.tabId;
      } catch {
        await removeWorkerLease(worker.workerId);
      }
    }

    const tab = await browser.tabs.create({
      url: navigableUrl,
      active: false,
    });
    await patchWorkerLease(worker.workerId, { tabId: tab.id });
    return tab.id!;
  }

  async function runWorkerTask(platform: SourcePlatform, worker: WorkerLeaseState, item: ExportQueueItem): Promise<void> {
    let tabId: number | undefined;
    const beforeState = await loadQueueState();
    const config = getPlatformConfig(beforeState.settings, platform);
    const runEpoch = getPlatformExecutionEpoch(platform);
    let errorCode: string | undefined;

    try {
      tabId = await resolveWorkerTab(worker, item.event.url, config);

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
      } catch (error) {
        await writeBackgroundLog(
          "background.worker",
          "warn",
          "Worker tab did not reach complete state before timeout, falling back to receiver readiness.",
          {
            code: "worker.load_timeout_fallback",
            platform,
            workerId: worker.workerId,
            tabId,
            targetUrl: item.event.url,
            error: error instanceof Error ? error.message : "Timed out waiting for conversation tab to load.",
          },
        );
      }
      tabId = await ensureWorkerReceiver(worker, tabId, item.event.url, config);
      const currentTab = await browser.tabs.get(tabId);
      if (isChallengeLikeTab(currentTab)) {
        errorCode = "worker.challenge_detected";
        throw new Error("Verification or challenge page detected.");
      }

      await new Promise((resolve) => setTimeout(resolve, config.settleDelayMs));
      const bundle = await extractConversationFromTab(tabId, config.navigationTimeoutMs + 15_000);

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        await removeWorkerLease(worker.workerId);
        return;
      }

      const latestState = await loadQueueState();
      const persisted = await persistBundle(bundle, latestState.settings);

      if (!isPlatformExecutionCurrent(platform, runEpoch)) {
        if (tabId) {
          await closeWorkerTab(tabId, intentionalWorkerTabClosures);
        }
        await removeWorkerLease(worker.workerId);
        return;
      }

      await markBundleExportResult(bundle, persisted.revision, "exported");

      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: patchQueueItem(current.items, item.key, {
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
          key: item.key,
          revision: persisted.revision,
          files: persisted.files,
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
      const lastError = error instanceof Error ? error.message : "Unknown worker error";
      if (!errorCode && isReceiverUnavailableError(error)) {
        errorCode = "worker.receiver_unavailable";
      }
      if (!errorCode && lastError.toLowerCase().includes("timed out")) {
        errorCode = "worker.navigation_timeout";
      }
      const shouldAutoRetryReceiver =
        errorCode === "worker.receiver_unavailable" && item.attempts + 1 < Math.max(3, config.receiverRetryLimit + 2);
      const currentState = await loadQueueState();

      await updateConversationIndex((entries) =>
        entries.map((entry) =>
          entry.platform === platform && entry.sourceId === item.event.sourceId
            ? {
                ...entry,
                exportState: shouldAutoRetryReceiver ? "pending" : "failed",
              }
            : entry,
        ),
      );

      await updateQueueStateWithDerived((current) => ({
        ...current,
        items: patchQueueItem(current.items, item.key, {
          status: shouldAutoRetryReceiver ? "pending" : "failed",
          priority: shouldAutoRetryReceiver ? "retry" : item.priority,
          workerId: undefined,
          lastError: shouldAutoRetryReceiver ? undefined : lastError,
          errorCode: shouldAutoRetryReceiver ? undefined : errorCode,
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
          key: item.key,
          attempts: item.attempts + 1,
          queue: summarizeQueueItems(currentState.items),
        });
      } else {
        await writeBackgroundError("background.queue", errorCode ?? "worker.unknown", "Worker failed queue item.", {
          platform,
          workerId: worker.workerId,
          sourceId: item.event.sourceId,
          key: item.key,
          lastError,
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
    if (platformStartupCatchup.has(platform)) {
      platformStartupCatchup.delete(platform);
      if (!service.lastDiscoveryAt && config.bootstrapRequireFullHistory) {
        await runPlatformDiscoverySweep(platform, "full-bootstrap");
        return;
      }

      await runPlatformDiscoverySweep(platform, "best-effort");
      return;
    }

    if (!service.lastDiscoveryAt && config.bootstrapRequireFullHistory) {
      await runPlatformDiscoverySweep(platform, "full-bootstrap");
      return;
    }

    const now = Date.now();
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

    const targetWorkers = getTargetWorkerCount(service, config);
    const idleWorker = queueState.activeWorkers.find((worker) => worker.platform === platform && !worker.busy);
    const busyWorkers = queueState.activeWorkers.filter((worker) => worker.platform === platform && worker.busy).length;
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

  async function runPlatformTick(platform: SourcePlatform): Promise<void> {
    await recoverOrphanedProcessingItems(platform);
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
      await refreshQueueServices();
      return;
    }

    await maybeRunPlatformDiscovery(platform, await loadQueueState());
    await maybeStartNextPlatformWorker(platform, await loadQueueState());
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
    const nextState = await updateQueueStateWithDerived((current) => ({
      ...current,
      services: {
        ...current.services,
        [platform]: {
          ...current.services[platform],
          desiredRunning,
          status: desiredRunning ? "starting" : current.services[platform].activeWorkers > 0 ? "pausing" : "paused",
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
    requestPlatformStartupCatchup,
    requestPlatformTick,
    runPlatformDiscoverySweep,
    updatePlatformDesiredRunning,
  };
}
