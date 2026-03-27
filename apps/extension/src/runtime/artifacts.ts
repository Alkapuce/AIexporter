import type { ExportArtifactEntry, ExtensionSettings } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";

function sameConversation(
  entry: ExportArtifactEntry,
  platform: SourcePlatform,
  sourceId: string,
): boolean {
  return entry.platform === platform && entry.sourceId === sourceId;
}

export function findLatestArtifactForConversation(
  entries: ExportArtifactEntry[],
  platform: SourcePlatform,
  sourceId: string,
): ExportArtifactEntry | undefined {
  const latestMarked = entries.find(
    (entry) => sameConversation(entry, platform, sourceId) && entry.isLatestForConversation && entry.localStatus !== "deleted",
  );
  if (latestMarked) return latestMarked;

  return [...entries]
    .filter((entry) => sameConversation(entry, platform, sourceId) && entry.localStatus !== "deleted")
    .sort((left, right) => Date.parse(right.exportedAt) - Date.parse(left.exportedAt))[0];
}

export function findLatestOpenableArtifactForConversation(
  entries: ExportArtifactEntry[],
  platform: SourcePlatform,
  sourceId: string,
): ExportArtifactEntry | undefined {
  return [...entries]
    .filter(
      (entry) =>
        sameConversation(entry, platform, sourceId) &&
        entry.localStatus !== "deleted" &&
        typeof entry.markdownDownloadId === "number",
    )
    .sort((left, right) => {
      const latestRank =
        Number(Boolean(right.isLatestForConversation)) - Number(Boolean(left.isLatestForConversation));
      if (latestRank !== 0) return latestRank;
      return Date.parse(right.exportedAt) - Date.parse(left.exportedAt);
    })[0];
}

export function findExactArtifact(
  entries: ExportArtifactEntry[],
  platform: SourcePlatform,
  sourceId: string,
  revision: string,
): ExportArtifactEntry | undefined {
  return entries.find(
    (entry) =>
      sameConversation(entry, platform, sourceId) &&
      entry.revision === revision &&
      entry.localStatus !== "deleted",
  );
}

export function shouldSkipPersist(
  latestArtifact: ExportArtifactEntry | undefined,
  revision: string,
  settings: ExtensionSettings,
): boolean {
  if (!settings.downloads.skipIfLatestExists) return false;
  if (!latestArtifact) return false;
  return latestArtifact.revision === revision && latestArtifact.localStatus !== "deleted";
}

export function markLatestArtifacts(
  entries: ExportArtifactEntry[],
  platform: SourcePlatform,
  sourceId: string,
  retainCount: number,
): ExportArtifactEntry[] {
  const targetEntries = [...entries]
    .filter((entry) => sameConversation(entry, platform, sourceId))
    .sort((left, right) => Date.parse(right.exportedAt) - Date.parse(left.exportedAt));
  const retained = new Set(targetEntries.slice(0, Math.max(0, retainCount)).map((entry) => entry.revision));

  return entries.map((entry) => {
    if (!sameConversation(entry, platform, sourceId)) return entry;
    return {
      ...entry,
      isLatestForConversation: retained.has(entry.revision) && targetEntries[0]?.revision === entry.revision,
      localStatus:
        entry.localStatus === "deleted"
          ? "deleted"
          : retained.has(entry.revision)
            ? entry.localStatus ?? "present"
            : "deleted",
    };
  });
}

export function pruneOldArtifacts(
  entries: ExportArtifactEntry[],
  platform: SourcePlatform,
  sourceId: string,
  retainCount: number,
): { nextEntries: ExportArtifactEntry[]; pruned: ExportArtifactEntry[] } {
  const targetEntries = [...entries]
    .filter((entry) => sameConversation(entry, platform, sourceId) && entry.localStatus !== "deleted")
    .sort((left, right) => Date.parse(right.exportedAt) - Date.parse(left.exportedAt));

  const retained = new Set(targetEntries.slice(0, Math.max(0, retainCount)).map((entry) => entry.revision));
  const pruned = targetEntries.filter((entry) => !retained.has(entry.revision));

  return {
    pruned,
    nextEntries: entries.map((entry) => {
      if (!sameConversation(entry, platform, sourceId)) return entry;
      return {
        ...entry,
        isLatestForConversation: retained.has(entry.revision) && targetEntries[0]?.revision === entry.revision,
        localStatus: retained.has(entry.revision) ? entry.localStatus ?? "present" : "deleted",
      };
    }),
  };
}
