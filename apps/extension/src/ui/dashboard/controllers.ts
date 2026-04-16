import type {
  ConversationIndexEntry,
  DebugLogEntry,
  DebugLogLevel,
  ExtensionSettings,
  ExportArtifactEntry,
  PlatformRuntimeConfig,
  QueueItemStatus,
  QueueState,
} from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { findLatestOpenableArtifactForConversation } from "../../runtime/artifacts";
import type { DashboardStateSnapshot } from "../services/dashboard-api";

const DEEPSEEK_PLATFORM: SourcePlatform = "deepseek";

export interface DashboardLogFilters {
  logLevels: Record<DebugLogLevel, boolean>;
  logSearch: string;
  logScopeFilter: string;
  logPlatformFilter: SourcePlatform | "all";
  logCodeFilter: string;
}

export interface DashboardQueueFilters {
  queueSearch: string;
  queueStatusFilter: string;
}

export interface DashboardArtifactState {
  latestArtifacts: Map<string, ExportArtifactEntry>;
  openableSourceIds: Set<string>;
}

export type DashboardQueueSortKey =
  | "updatedAt"
  | "discoveredAt"
  | "title"
  | "sourceId"
  | "status"
  | "priority"
  | "attempts"
  | "websiteTime"
  | "lastSeenAt"
  | "lastExportAt";

export type DashboardSortDirection = "asc" | "desc";

export interface DashboardSnapshotState {
  queueState: QueueState;
  debugState: Awaited<DashboardStateSnapshot["debugState"]>;
  artifactIndex: ExportArtifactEntry[];
  conversationIndex: ConversationIndexEntry[];
  settingsDraft: ExtensionSettings;
}

export function cloneDashboardSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    ...settings,
    scheduler: { ...settings.scheduler },
    downloads: { ...settings.downloads },
    platforms: {
      chatgpt: { ...settings.platforms.chatgpt },
      gemini: { ...settings.platforms.gemini },
      aistudio: { ...settings.platforms.aistudio },
      deepseek: { ...settings.platforms.deepseek },
    },
  };
}

export function areDashboardSettingsEqual(left: ExtensionSettings, right: ExtensionSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildDashboardSnapshotState(
  snapshot: DashboardStateSnapshot,
  currentDraft: ExtensionSettings | null,
): DashboardSnapshotState {
  return {
    queueState: snapshot.queueState,
    debugState: snapshot.debugState,
    artifactIndex: snapshot.artifactIndex,
    conversationIndex: snapshot.conversationIndex,
    settingsDraft: currentDraft ?? cloneDashboardSettings(snapshot.queueState.settings),
  };
}

export function normalizeLogPlatform(entry: DebugLogEntry): SourcePlatform | undefined {
  if (entry.platform) return entry.platform;
  if (typeof entry.details?.platform === "string") {
    return entry.details.platform as SourcePlatform;
  }
  if (entry.scope.includes("deepseek")) return "deepseek";
  if (entry.scope.includes("chatgpt")) return "chatgpt";
  if (entry.scope.includes("gemini")) return "gemini";
  if (entry.scope.includes("aistudio")) return "aistudio";
  return undefined;
}

export function getDashboardLogSourceId(entry: DebugLogEntry): string | undefined {
  if (entry.sourceId) return entry.sourceId;
  return typeof entry.details?.sourceId === "string" ? entry.details.sourceId : undefined;
}

export function getDashboardLogTraceId(entry: DebugLogEntry): string | undefined {
  if (entry.traceId) return entry.traceId;
  return typeof entry.details?.traceId === "string" ? entry.details.traceId : undefined;
}

export function getDashboardLogWorkerId(entry: DebugLogEntry): string | undefined {
  if (entry.workerId) return entry.workerId;
  return typeof entry.details?.workerId === "string" ? entry.details.workerId : undefined;
}

export function buildRelatedDashboardLogs(logs: DebugLogEntry[], target: DebugLogEntry | null): DebugLogEntry[] {
  if (!target) return [];

  const sourceId = getDashboardLogSourceId(target);
  if (sourceId) {
    return logs
      .filter((entry) => getDashboardLogSourceId(entry) === sourceId)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  }

  const traceId = getDashboardLogTraceId(target);
  if (traceId) {
    return logs
      .filter((entry) => getDashboardLogTraceId(entry) === traceId)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  }

  const workerId = getDashboardLogWorkerId(target);
  if (workerId) {
    return logs
      .filter((entry) => getDashboardLogWorkerId(entry) === workerId)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  }

  return [target];
}

function isStatusFilterMatch(filter: string, status: QueueItemStatus): boolean {
  return filter === "all" || filter === status;
}

export function filterDashboardLogs(logs: DebugLogEntry[], filters: DashboardLogFilters): DebugLogEntry[] {
  return logs.filter((entry) => {
    const matchesLevel = filters.logLevels[entry.level];
    const entryPlatform = normalizeLogPlatform(entry);
    const matchesScope = filters.logScopeFilter === "all" || entry.scope === filters.logScopeFilter;
    const matchesPlatform = filters.logPlatformFilter === "all" || entryPlatform === filters.logPlatformFilter;
    const matchesCode = filters.logCodeFilter === "all" || entry.code === filters.logCodeFilter;
    const haystack = [entry.scope, entry.code, entry.message, JSON.stringify(entry.details ?? {})]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !filters.logSearch || haystack.includes(filters.logSearch.toLowerCase());
    return matchesLevel && matchesScope && matchesPlatform && matchesCode && matchesSearch;
  });
}

export function buildAvailableLogScopes(logs: DebugLogEntry[]): string[] {
  return ["all", ...Array.from(new Set(logs.map((entry) => entry.scope))).sort()];
}

export function buildAvailableLogCodes(logs: DebugLogEntry[]): string[] {
  return ["all", ...Array.from(new Set(logs.map((entry) => entry.code).filter(Boolean) as string[])).sort()];
}

export function filterDashboardQueueItems(
  queueState: QueueState,
  filters: DashboardQueueFilters,
  platform: SourcePlatform = DEEPSEEK_PLATFORM,
  conversationIndexMap?: Map<string, ConversationIndexEntry>,
) {
  return queueState.items
    .filter((item) => item.platform === platform)
    .filter((item) => {
      const indexEntry = conversationIndexMap?.get(item.event.sourceId);
      const matchesStatus = isStatusFilterMatch(filters.queueStatusFilter, item.status);
      const haystack = [
        item.event.title,
        item.event.sourceId,
        item.lastError,
        item.event.url,
        item.errorCode,
        item.skipReason,
        indexEntry?.latestSourceUpdatedLabel,
        indexEntry?.latestSourceUpdatedAt,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !filters.queueSearch || haystack.includes(filters.queueSearch.toLowerCase());
      return matchesStatus && matchesSearch;
    });
}

export function buildDashboardConversationIndexMap(
  entries: ConversationIndexEntry[],
  platform: SourcePlatform = DEEPSEEK_PLATFORM,
): Map<string, ConversationIndexEntry> {
  return new Map(entries.filter((entry) => entry.platform === platform).map((entry) => [entry.sourceId, entry] as const));
}

export function parseRelativeTimeLabel(label: string | undefined, now = new Date()): number | null {
  if (!label) return null;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "today") return now.getTime();
  if (normalized === "yesterday") return now.getTime() - 24 * 60 * 60 * 1_000;

  const match = normalized.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    minute: 60 * 1_000,
    hour: 60 * 60 * 1_000,
    day: 24 * 60 * 60 * 1_000,
    week: 7 * 24 * 60 * 60 * 1_000,
    month: 30 * 24 * 60 * 60 * 1_000,
    year: 365 * 24 * 60 * 60 * 1_000,
  };

  const unit = match[2] as keyof typeof multipliers;
  const multiplier = multipliers[unit];
  return typeof multiplier === "number" ? now.getTime() - amount * multiplier : null;
}

function comparePrimitive(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export function sortDashboardQueueItems(
  items: QueueState["items"],
  conversationIndexMap: Map<string, ConversationIndexEntry>,
  latestArtifacts: Map<string, ExportArtifactEntry>,
  sortKey: DashboardQueueSortKey,
  sortDirection: DashboardSortDirection,
): QueueState["items"] {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...items].sort((left, right) => {
    const leftIndex = conversationIndexMap.get(left.event.sourceId);
    const rightIndex = conversationIndexMap.get(right.event.sourceId);
    const leftArtifact = latestArtifacts.get(left.event.sourceId);
    const rightArtifact = latestArtifacts.get(right.event.sourceId);

    const leftValue =
      sortKey === "title"
        ? left.event.title ?? leftIndex?.title ?? ""
        : sortKey === "sourceId"
          ? left.event.sourceId
          : sortKey === "status"
            ? left.status
            : sortKey === "priority"
              ? left.priority
              : sortKey === "attempts"
                ? left.attempts
                : sortKey === "discoveredAt"
                  ? Date.parse(left.discoveredAt)
                  : sortKey === "websiteTime"
                    ? Date.parse(leftIndex?.latestSourceUpdatedAt ?? "") ||
                      parseRelativeTimeLabel(leftIndex?.latestSourceUpdatedLabel) ||
                      0
                    : sortKey === "lastSeenAt"
                      ? Date.parse(leftIndex?.lastSeenAt ?? "") || 0
                      : sortKey === "lastExportAt"
                        ? Date.parse(leftArtifact?.exportedAt ?? "") || 0
                        : Date.parse(left.updatedAt);

    const rightValue =
      sortKey === "title"
        ? right.event.title ?? rightIndex?.title ?? ""
        : sortKey === "sourceId"
          ? right.event.sourceId
          : sortKey === "status"
            ? right.status
            : sortKey === "priority"
              ? right.priority
              : sortKey === "attempts"
                ? right.attempts
                : sortKey === "discoveredAt"
                  ? Date.parse(right.discoveredAt)
                  : sortKey === "websiteTime"
                    ? Date.parse(rightIndex?.latestSourceUpdatedAt ?? "") ||
                      parseRelativeTimeLabel(rightIndex?.latestSourceUpdatedLabel) ||
                      0
                    : sortKey === "lastSeenAt"
                      ? Date.parse(rightIndex?.lastSeenAt ?? "") || 0
                      : sortKey === "lastExportAt"
                        ? Date.parse(rightArtifact?.exportedAt ?? "") || 0
                        : Date.parse(right.updatedAt);

    const compared = comparePrimitive(leftValue, rightValue);
    if (compared !== 0) return compared * direction;

    return (Date.parse(right.updatedAt) - Date.parse(left.updatedAt)) * (sortDirection === "asc" ? -1 : 1);
  });
}

export function buildDashboardArtifactState(
  artifactIndex: ExportArtifactEntry[],
  platform: SourcePlatform = DEEPSEEK_PLATFORM,
): DashboardArtifactState {
  const sourceIds = new Set(artifactIndex.filter((entry) => entry.platform === platform).map((entry) => entry.sourceId));
  const latestArtifacts = new Map(
    Array.from(sourceIds)
      .map(
        (sourceId) =>
          [
            sourceId,
            findLatestOpenableArtifactForConversation(artifactIndex, platform, sourceId),
          ] as const,
      )
      .filter((entry): entry is readonly [string, ExportArtifactEntry] => Boolean(entry[1])),
  );

  return {
    latestArtifacts,
    openableSourceIds: new Set(latestArtifacts.keys()),
  };
}

export function updateGlobalSettingDraft<K extends keyof ExtensionSettings>(
  draft: ExtensionSettings,
  key: K,
  value: ExtensionSettings[K],
): ExtensionSettings {
  return {
    ...draft,
    [key]: value,
  };
}

export function updateSchedulerSettingDraft<K extends keyof ExtensionSettings["scheduler"]>(
  draft: ExtensionSettings,
  key: K,
  value: ExtensionSettings["scheduler"][K],
): ExtensionSettings {
  return {
    ...draft,
    scheduler: {
      ...draft.scheduler,
      [key]: value,
    },
  };
}

export function updateDownloadsSettingDraft<K extends keyof ExtensionSettings["downloads"]>(
  draft: ExtensionSettings,
  key: K,
  value: ExtensionSettings["downloads"][K],
): ExtensionSettings {
  return {
    ...draft,
    downloads: {
      ...draft.downloads,
      [key]: value,
    },
  };
}

export function updatePlatformSettingDraft<K extends keyof PlatformRuntimeConfig>(
  draft: ExtensionSettings,
  platform: SourcePlatform,
  key: K,
  value: PlatformRuntimeConfig[K],
): ExtensionSettings {
  return {
    ...draft,
    platforms: {
      ...draft.platforms,
      [platform]: {
        ...draft.platforms[platform],
        [key]: value,
      },
    },
  };
}

export const updateDeepSeekSettingDraft = <K extends keyof PlatformRuntimeConfig>(
  draft: ExtensionSettings,
  key: K,
  value: PlatformRuntimeConfig[K],
): ExtensionSettings => updatePlatformSettingDraft(draft, "deepseek", key, value);
