import type {
  ConversationIndexEntry,
  PlatformServiceState,
  QueueState,
  WorkerLeaseState,
} from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";

export function countPlatformWorkers(workers: WorkerLeaseState[], platform: SourcePlatform): number {
  return workers.filter((worker) => worker.platform === platform && worker.busy).length;
}

export function rebuildPlatformServiceState(
  service: PlatformServiceState,
  queueState: QueueState,
  conversationIndex: ConversationIndexEntry[],
): PlatformServiceState {
  const platformItems = queueState.items.filter((item) => item.platform === service.platform);
  const platformIndex = conversationIndex.filter((entry) => entry.platform === service.platform);

  const pending = platformItems.filter((item) => item.status === "pending").length;
  const processing = platformItems.filter((item) => item.status === "processing").length;
  const completed = platformItems.filter((item) => item.status === "completed").length;
  const failed = platformItems.filter((item) => item.status === "failed").length;
  const exportedTotal = platformIndex.filter((entry) => entry.exportState === "exported").length;

  let nextStatus = service.status;
  if (!service.desiredRunning) {
    nextStatus = service.activeWorkers > 0 || service.activeDiscoveryTabs > 0 ? "pausing" : "paused";
  } else if (service.activeDiscoveryTabs > 0) {
    nextStatus = service.status === "discovering" ? "discovering" : "backfilling";
  } else if (service.activeWorkers > 0) {
    nextStatus = "running";
  } else if (pending > 0) {
    nextStatus = "starting";
  } else if (service.status !== "error") {
    nextStatus = "idle";
  }

  return {
    ...service,
    status: nextStatus,
    activeWorkers: countPlatformWorkers(queueState.activeWorkers, service.platform),
    stats: {
      discoveredTotal: platformIndex.length,
      exportedTotal,
      pending,
      processing,
      completed,
      failed,
    },
  };
}

export function rebuildAllPlatformServices(
  queueState: QueueState,
  conversationIndex: ConversationIndexEntry[],
): QueueState["services"] {
  return {
    chatgpt: rebuildPlatformServiceState(queueState.services.chatgpt, queueState, conversationIndex),
    gemini: rebuildPlatformServiceState(queueState.services.gemini, queueState, conversationIndex),
    deepseek: rebuildPlatformServiceState(queueState.services.deepseek, queueState, conversationIndex),
  };
}
