import type { ExportQueueItem, QueueItemPriority, QueueItemStatus } from "@aiexporter/adapter-sdk";
import type { DiscoveryEvent } from "@aiexporter/core-schema";

export function getQueueItemKey(event: DiscoveryEvent): string {
  return `${event.platform}:${event.sourceId}:${event.revisionFingerprint}`;
}

export function mergeDiscoveryEvent(
  items: ExportQueueItem[],
  event: DiscoveryEvent,
  options: { kind?: ExportQueueItem["kind"]; priority?: QueueItemPriority; forcePending?: boolean } = {},
  now = new Date().toISOString(),
): ExportQueueItem[] {
  const key = getQueueItemKey(event);
  const existing = items.find((item) => item.key === key);
  const nextKind = options.kind ?? "export";
  const nextPriority = options.priority ?? "realtime";

  if (existing) {
    return items.map((item) =>
      item.key === key
        ? {
            ...item,
            event: {
              ...item.event,
              ...event,
            },
            platform: event.platform,
            kind: nextKind,
            priority: options.forcePending ? nextPriority : item.priority,
            status: options.forcePending && item.status !== "processing" ? "pending" : item.status,
            workerId: options.forcePending ? undefined : item.workerId,
            lastError: options.forcePending ? undefined : item.lastError,
            updatedAt: now,
          }
        : item,
    );
  }

  const existingBySource = items.find((item) => item.event.platform === event.platform && item.event.sourceId === event.sourceId);
  if (
    existingBySource &&
    (existingBySource.status === "pending" || existingBySource.status === "processing") &&
    (!existingBySource.event.sourceUpdatedAt || !event.sourceUpdatedAt)
  ) {
    const mergedEvent: DiscoveryEvent = {
      ...existingBySource.event,
      ...event,
      title: event.title ?? existingBySource.event.title,
      sourceUpdatedAt: event.sourceUpdatedAt ?? existingBySource.event.sourceUpdatedAt,
      sourceUpdatedLabel: event.sourceUpdatedLabel ?? existingBySource.event.sourceUpdatedLabel,
      revisionFingerprint:
        event.sourceUpdatedAt && !existingBySource.event.sourceUpdatedAt
          ? event.revisionFingerprint
          : existingBySource.event.revisionFingerprint,
    };

    return items.map((item) =>
        item.key === existingBySource.key
          ? {
            ...item,
            key: getQueueItemKey(mergedEvent),
            event: mergedEvent,
            platform: mergedEvent.platform,
            kind: nextKind,
            priority: options.forcePending && item.status !== "processing" ? nextPriority : item.priority,
            status: options.forcePending && item.status !== "processing" ? "pending" : item.status,
            workerId: options.forcePending ? undefined : item.workerId,
            lastError: options.forcePending ? undefined : item.lastError,
            updatedAt: now,
          }
        : item,
    );
  }

  return [
    {
      key,
      event,
      kind: nextKind,
      priority: nextPriority,
      platform: event.platform,
      status: "pending",
      attempts: 0,
      discoveredAt: now,
      updatedAt: now,
    },
    ...items,
  ];
}

export function patchQueueItem(
  items: ExportQueueItem[],
  key: string,
  patch: Partial<ExportQueueItem>,
): ExportQueueItem[] {
  return items.map((item) =>
    item.key === key
      ? {
          ...item,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
}

export function getNextPendingItem(items: ExportQueueItem[]): ExportQueueItem | undefined {
  const priorityOrder: QueueItemPriority[] = ["realtime", "retry", "backfill"];
  return [...items]
    .filter((item) => item.status === "pending")
    .sort((left, right) => {
      const priorityDelta = priorityOrder.indexOf(left.priority) - priorityOrder.indexOf(right.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return Date.parse(left.discoveredAt) - Date.parse(right.discoveredAt);
    })[0];
}

export function retryFailedItems(items: ExportQueueItem[]): ExportQueueItem[] {
  return items.map((item) =>
    item.status === "failed"
      ? {
          ...item,
          status: "pending",
          priority: "retry",
          lastError: undefined,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
}

export function clearHistoricalItems(items: ExportQueueItem[]): ExportQueueItem[] {
  return items.filter((item) => item.status === "pending" || item.status === "processing");
}

export function clearItemsByStatuses(
  items: ExportQueueItem[],
  statuses: QueueItemStatus[],
  platform?: ExportQueueItem["platform"],
): ExportQueueItem[] {
  const statusSet = new Set(statuses);
  return items.filter((item) => {
    if (platform && item.platform !== platform) return true;
    return !statusSet.has(item.status);
  });
}

export function markQueueItemStatus(
  items: ExportQueueItem[],
  key: string,
  status: QueueItemStatus,
  lastError?: string,
): ExportQueueItem[] {
  return patchQueueItem(items, key, {
    status,
    lastError,
  });
}

export function removeQueueItem(items: ExportQueueItem[], key: string): ExportQueueItem[] {
  return items.filter((item) => item.key !== key);
}

export function summarizeQueueItems(items: ExportQueueItem[]): Record<string, number> {
  const summary: Record<string, number> = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };

  items.forEach((item) => {
    summary.total = (summary.total ?? 0) + 1;
    summary[item.status] = (summary[item.status] ?? 0) + 1;
  });

  return summary;
}
