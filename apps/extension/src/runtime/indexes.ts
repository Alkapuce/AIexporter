import { resolveBundleTitle, type ConversationBundle, type DiscoveryEvent } from "@aiexporter/core-schema";
import type { ConversationIndexEntry, ExportArtifactEntry } from "@aiexporter/adapter-sdk";

export function upsertConversationIndexEntry(
  entries: ConversationIndexEntry[],
  event: DiscoveryEvent,
  discoveryState: ConversationIndexEntry["discoveryState"],
  now = new Date().toISOString(),
): ConversationIndexEntry[] {
  const existing = entries.find((entry) => entry.platform === event.platform && entry.sourceId === event.sourceId);

  if (!existing) {
    return [
      {
        platform: event.platform,
        sourceId: event.sourceId,
        title: event.title,
        url: event.url,
        lastSeenAt: now,
        latestDiscoveryFingerprint: event.revisionFingerprint,
        latestSourceUpdatedAt: event.sourceUpdatedAt,
        latestSourceUpdatedLabel: event.sourceUpdatedLabel,
        discoveryState,
        exportState: "never_exported",
      },
      ...entries,
    ];
  }

  return entries.map((entry) =>
    entry.platform === event.platform && entry.sourceId === event.sourceId
      ? {
          ...entry,
          title: event.title ?? entry.title,
          url: event.url,
          lastSeenAt: now,
          latestDiscoveryFingerprint: event.revisionFingerprint,
          latestSourceUpdatedAt: event.sourceUpdatedAt ?? entry.latestSourceUpdatedAt,
          latestSourceUpdatedLabel: event.sourceUpdatedLabel ?? entry.latestSourceUpdatedLabel,
          discoveryState: discoveryState === "complete" ? "complete" : entry.discoveryState,
        }
      : entry,
  );
}

export function markConversationIndexExportPending(
  entries: ConversationIndexEntry[],
  platform: ConversationIndexEntry["platform"],
  sourceId: string,
): ConversationIndexEntry[] {
  return entries.map((entry) =>
    entry.platform === platform && entry.sourceId === sourceId
      ? {
          ...entry,
          exportState: "pending",
        }
      : entry,
  );
}

export function markConversationIndexExportResult(
  entries: ConversationIndexEntry[],
  bundle: ConversationBundle,
  revision: string,
  exportState: ConversationIndexEntry["exportState"],
  exportCompatibilityVersion?: string,
): ConversationIndexEntry[] {
  return entries.map((entry) =>
    entry.platform === bundle.platform && entry.sourceId === bundle.sourceId
      ? (() => {
          const resolvedTitle = resolveBundleTitle(bundle, entry.title);
          return {
            ...entry,
            title: resolvedTitle.title ?? entry.title,
            url: bundle.url,
            latestSourceUpdatedAt: bundle.sourceUpdatedAt ?? entry.latestSourceUpdatedAt,
            latestExportRevision: exportState === "exported" ? revision : entry.latestExportRevision,
            latestExportCompatibilityVersion:
              exportState === "exported"
                ? exportCompatibilityVersion ?? entry.latestExportCompatibilityVersion
                : entry.latestExportCompatibilityVersion,
            exportState,
            lastSeenAt: new Date().toISOString(),
          };
        })()
      : entry,
  );
}

export function upsertArtifactEntry(
  entries: ExportArtifactEntry[],
  nextEntry: ExportArtifactEntry,
): ExportArtifactEntry[] {
  const next = entries.filter(
    (entry) =>
      !(
        entry.platform === nextEntry.platform &&
        entry.sourceId === nextEntry.sourceId &&
        entry.revision === nextEntry.revision
      ),
  );

  return [nextEntry, ...next];
}
