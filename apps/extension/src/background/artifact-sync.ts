import {
  buildBundleRevision,
  buildDiscoveryFingerprint,
  type ExportArtifactEntry,
  type ExtensionSettings,
} from "@aiexporter/adapter-sdk";
import {
  resolveBundleTitle,
  type ConversationBundle,
  type DiscoveryEvent,
  type SourcePlatform,
} from "@aiexporter/core-schema";
import {
  markConversationIndexExportPending,
  markConversationIndexExportResult,
  upsertConversationIndexEntry,
} from "../runtime/indexes";
import { loadArtifactIndex, loadConversationIndex, saveArtifactIndex, saveConversationIndex } from "../runtime/storage";
import {
  checkPathExistsWithNativeHost,
  listFilesWithNativeHost,
  movePathWithNativeHost,
  pingNativeHost,
  readFileWithNativeHost,
  resolveExportRootWithNativeHost,
} from "../runtime/native-host";
import { verifyArtifactFilesPresent } from "./artifact-persistence";
import { getConfiguredExportRoot } from "./export-root";
import { SUPPORTED_PLATFORMS, buildArchivePrefix, buildArtifactBaseName, sanitizePathSegment } from "./shared";

export interface ArtifactSyncResult {
  exportRoot: string;
  verifiedCount: number;
  missingCount: number;
  importedCount: number;
  requeueEvents: DiscoveryEvent[];
}

function getBundleMetaString(bundle: ConversationBundle, key: string): string | undefined {
  const value = bundle.meta?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isConversationBundle(value: unknown): value is ConversationBundle {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ConversationBundle).platform === "string" &&
    typeof (value as ConversationBundle).sourceId === "string" &&
    typeof (value as ConversationBundle).url === "string" &&
    Array.isArray((value as ConversationBundle).messages),
  );
}

function isSupportedPlatform(value: string): value is SourcePlatform {
  return SUPPORTED_PLATFORMS.includes(value as SourcePlatform);
}

async function fileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  const result = await checkPathExistsWithNativeHost(path);
  return Boolean(result.path);
}

async function buildDiscoveryEvent(bundle: ConversationBundle): Promise<DiscoveryEvent> {
  const sourceUpdatedLabel = getBundleMetaString(bundle, "sourceUpdatedLabel");
  const resolvedTitle = resolveBundleTitle(bundle);
  return {
    platform: bundle.platform,
    sourceId: bundle.sourceId,
    url: bundle.url,
    title: resolvedTitle.title,
    sourceUpdatedAt: bundle.sourceUpdatedAt,
    sourceUpdatedLabel,
    revisionFingerprint: await buildDiscoveryFingerprint(bundle.platform, {
      sourceId: bundle.sourceId,
      url: bundle.url,
      title: bundle.title,
      sourceUpdatedAt: bundle.sourceUpdatedAt,
      sourceUpdatedLabel,
    }),
  };
}

function getArtifactKey(platform: SourcePlatform, sourceId: string, revision: string): string {
  return JSON.stringify([platform, sourceId, revision]);
}

function getConversationKey(platform: SourcePlatform, sourceId: string): string {
  return JSON.stringify([platform, sourceId]);
}

function getParentDirectory(targetPath: string): string {
  const normalized = targetPath.replace(/\//g, "\\");
  return normalized.slice(0, normalized.lastIndexOf("\\"));
}

function normalizeComparablePath(targetPath: string): string {
  return targetPath.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

function isPathAtOrInside(candidatePath: string, directoryPath: string): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  const directory = normalizeComparablePath(directoryPath);
  return candidate === directory || candidate.startsWith(`${directory}\\`);
}

function canSafelyMoveFolder(sourcePath: string, targetPath: string, targetExists: boolean): boolean {
  const source = normalizeComparablePath(sourcePath);
  const target = normalizeComparablePath(targetPath);
  if (source === target) return false;
  if (targetExists) return false;
  if (isPathAtOrInside(source, target)) return false;
  if (isPathAtOrInside(target, source)) return false;
  return true;
}

function isInactiveArtifact(entry: ExportArtifactEntry): boolean {
  return entry.localStatus === "deleted" || entry.localStatus === "archived";
}

function parseExportedAt(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export async function syncArtifactsWithDisk(
  settings: ExtensionSettings,
  platform?: SourcePlatform,
): Promise<ArtifactSyncResult> {
  await pingNativeHost();

  const exportRoot = (await resolveExportRootWithNativeHost(getConfiguredExportRoot(settings))).path;
  if (!exportRoot) {
    throw new Error("Failed to resolve export root.");
  }

  const [artifactIndex, conversationIndex] = await Promise.all([loadArtifactIndex(), loadConversationIndex()]);
  const targetPlatforms: SourcePlatform[] = platform ? [platform] : SUPPORTED_PLATFORMS;
  const targetPlatformSet = new Set<SourcePlatform>(targetPlatforms);
  const artifactByKey = new Map<string, ExportArtifactEntry>();
  const artifactOrder: string[] = [];
  for (const entry of artifactIndex) {
    const artifactKey = getArtifactKey(entry.platform, entry.sourceId, entry.revision);
    if (!artifactByKey.has(artifactKey)) {
      artifactOrder.push(artifactKey);
    }
    artifactByKey.set(artifactKey, entry);
  }
  let nextConversationIndex = [...conversationIndex];
  const conversationIndexByKey = new Map(
    nextConversationIndex.map((entry) => [getConversationKey(entry.platform, entry.sourceId), entry] as const),
  );
  let verifiedCount = 0;
  let missingCount = 0;
  let importedCount = 0;
  const missingArtifactKeys = new Set<string>();
  const requeueEvents = new Map<string, DiscoveryEvent>();

  function upsertSyncedArtifact(entry: ExportArtifactEntry): void {
    const artifactKey = getArtifactKey(entry.platform, entry.sourceId, entry.revision);
    if (!artifactByKey.has(artifactKey)) {
      artifactOrder.unshift(artifactKey);
    }
    artifactByKey.set(artifactKey, entry);
  }

  function patchSyncedArtifact(entry: ExportArtifactEntry, patch: Partial<ExportArtifactEntry>): void {
    const artifactKey = getArtifactKey(entry.platform, entry.sourceId, entry.revision);
    const current = artifactByKey.get(artifactKey);
    if (!current) return;
    artifactByKey.set(artifactKey, {
      ...current,
      ...patch,
    });
  }

  function recordMissingArtifact(entry: ExportArtifactEntry): void {
    const artifactKey = getArtifactKey(entry.platform, entry.sourceId, entry.revision);
    if (!missingArtifactKeys.has(artifactKey)) {
      missingArtifactKeys.add(artifactKey);
      missingCount += 1;
    }
  }

  for (const entry of artifactIndex) {
    if (!targetPlatformSet.has(entry.platform) || isInactiveArtifact(entry)) continue;
    verifiedCount += 1;
    const present = await verifyArtifactFilesPresent(entry);
    if (present) {
      patchSyncedArtifact(entry, {
        localStatus: entry.localStatus === "skipped_existing" ? "skipped_existing" : "present",
      });
      continue;
    }

    recordMissingArtifact(entry);
    patchSyncedArtifact(entry, {
      localStatus: "missing",
      isLatestForConversation: false,
    });

    const conversationEntry = conversationIndexByKey.get(getConversationKey(entry.platform, entry.sourceId));
    const missingLatestArtifact =
      entry.isLatestForConversation || conversationEntry?.latestExportRevision === entry.revision;
    if (conversationEntry && missingLatestArtifact) {
      nextConversationIndex = markConversationIndexExportPending(nextConversationIndex, entry.platform, entry.sourceId);
      requeueEvents.set(getConversationKey(entry.platform, entry.sourceId), {
        platform: entry.platform,
        sourceId: entry.sourceId,
        url: conversationEntry.url,
        title: conversationEntry.title,
        sourceUpdatedAt: conversationEntry.latestSourceUpdatedAt,
        sourceUpdatedLabel: conversationEntry.latestSourceUpdatedLabel,
        revisionFingerprint: conversationEntry.latestDiscoveryFingerprint,
      });
    }
  }

  for (const nextPlatform of targetPlatforms) {
    const platformRoot = `${exportRoot}\\AIexporter\\${sanitizePathSegment(nextPlatform)}`;
    const bundlePaths = (await listFilesWithNativeHost(platformRoot, "*.bundle.json", true)).paths ?? [];

    for (const bundlePath of bundlePaths) {
      try {
        const content = (await readFileWithNativeHost(bundlePath)).content;
        if (typeof content !== "string") continue;
        const parsed = JSON.parse(content) as unknown;
        if (!isConversationBundle(parsed)) continue;

        const bundle = parsed;
        if (!isSupportedPlatform(bundle.platform) || !targetPlatformSet.has(bundle.platform)) {
          continue;
        }

        const revision = getBundleMetaString(bundle, "revision") ?? (await buildBundleRevision(bundle));
        const desiredPrefix = `${exportRoot}\\${buildArchivePrefix(bundle, revision).replace(/\//g, "\\")}`;
        const currentFolder = getParentDirectory(bundlePath);
        let nextBundlePath = bundlePath;
        let nextMarkdownFilename = bundlePath.replace(/\.bundle\.json$/i, ".md");
        if (currentFolder.toLowerCase() !== desiredPrefix.toLowerCase()) {
          const targetExists = await fileExists(desiredPrefix);
          if (canSafelyMoveFolder(currentFolder, desiredPrefix, targetExists)) {
            await movePathWithNativeHost(currentFolder, desiredPrefix);
            const baseName = buildArtifactBaseName(bundle);
            nextBundlePath = `${desiredPrefix}\\${baseName}.bundle.json`;
            nextMarkdownFilename = `${desiredPrefix}\\${baseName}.md`;
          }
        }
        const markdownFilename = nextMarkdownFilename;
        const markdownPresent = await fileExists(markdownFilename);
        const artifactEntry: ExportArtifactEntry = {
          platform: bundle.platform,
          sourceId: bundle.sourceId,
          revision,
          bundleFilename: nextBundlePath,
          markdownFilename,
          exportedAt: bundle.extractedAt,
          localStatus: markdownPresent ? "present" : "missing",
          isLatestForConversation: true,
        };

        const artifactKey = getArtifactKey(bundle.platform, bundle.sourceId, revision);
        if (!artifactByKey.has(artifactKey)) {
          importedCount += 1;
        }

        upsertSyncedArtifact(artifactEntry);
        const discoveryEvent = await buildDiscoveryEvent(bundle);
        nextConversationIndex = upsertConversationIndexEntry(
          nextConversationIndex,
          discoveryEvent,
          "complete",
          bundle.extractedAt,
        );
        nextConversationIndex = markConversationIndexExportResult(
          nextConversationIndex,
          bundle,
          revision,
          markdownPresent ? "exported" : "pending",
          getBundleMetaString(bundle, "exportCompatibilityVersion") ??
            getBundleMetaString(bundle, "exportSchemaVersion"),
        );

        if (!markdownPresent) {
          recordMissingArtifact(artifactEntry);
          requeueEvents.set(getConversationKey(bundle.platform, bundle.sourceId), discoveryEvent);
        } else {
          requeueEvents.delete(getConversationKey(bundle.platform, bundle.sourceId));
        }
      } catch {
        // Ignore unreadable bundle files during sync.
      }
    }
  }

  const latestRevisionByConversation = new Map<string, { exportedAt: number; revision: string }>();
  for (const entry of artifactByKey.values()) {
    if (!targetPlatformSet.has(entry.platform) || isInactiveArtifact(entry)) continue;
    const conversationKey = getConversationKey(entry.platform, entry.sourceId);
    const currentLatest = latestRevisionByConversation.get(conversationKey);
    const exportedAt = parseExportedAt(entry.exportedAt);
    if (!currentLatest || exportedAt > currentLatest.exportedAt) {
      latestRevisionByConversation.set(conversationKey, {
        exportedAt,
        revision: entry.revision,
      });
    }
  }

  const nextArtifacts = artifactOrder.map((artifactKey) => {
    const entry = artifactByKey.get(artifactKey)!;
    if (!targetPlatformSet.has(entry.platform)) return entry;
    const latest = latestRevisionByConversation.get(getConversationKey(entry.platform, entry.sourceId));
    return {
      ...entry,
      isLatestForConversation: latest?.revision === entry.revision,
    };
  });

  for (const [conversationKey] of requeueEvents) {
    const latestArtifact = nextArtifacts.find(
      (entry) =>
        targetPlatformSet.has(entry.platform) &&
        getConversationKey(entry.platform, entry.sourceId) === conversationKey &&
        entry.isLatestForConversation,
    );
    if (latestArtifact && latestArtifact.localStatus !== "missing") {
      requeueEvents.delete(conversationKey);
    }
  }

  await Promise.all([saveArtifactIndex(nextArtifacts), saveConversationIndex(nextConversationIndex)]);

  return {
    exportRoot,
    verifiedCount,
    missingCount,
    importedCount,
    requeueEvents: Array.from(requeueEvents.values()),
  };
}
