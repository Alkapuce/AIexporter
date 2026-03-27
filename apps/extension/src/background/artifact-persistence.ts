import {
  buildBundleRevision,
  type ConversationIndexEntry,
  type ExportArtifactEntry,
  type ExtensionSettings,
} from "@aiexporter/adapter-sdk";
import type { ConversationBundle } from "@aiexporter/core-schema";
import { serializeConversation } from "@aiexporter/core-markdown";
import {
  downloadTextAsset,
  openDownloadedAsset,
  removeDownloadedAsset,
  showDownloadedAsset,
} from "../runtime/downloads";
import {
  findExactArtifact,
  findLatestArtifactForConversation,
  markLatestArtifacts,
  pruneOldArtifacts,
  shouldSkipPersist,
} from "../runtime/artifacts";
import { markConversationIndexExportResult, upsertArtifactEntry } from "../runtime/indexes";
import { writeBackgroundLog } from "../runtime/logger";
import { syncBundleToServer } from "../runtime/server-sync";
import { loadArtifactIndex, loadConversationIndex, updateArtifactIndex, updateConversationIndex } from "../runtime/storage";
import {
  openFileWithNativeHost,
  pingNativeHost,
  relocateFileWithNativeHost,
  showFolderWithNativeHost,
} from "../runtime/native-host";
import { buildArchivePrefix, buildArtifactBaseName, buildConversationFolderName, buildRevisionFolderName, sanitizePathSegment } from "./shared";
import { refreshQueueServices } from "./state-access";

export interface DownloadLookupResult {
  id?: number;
  filename?: string;
  finalUrl?: string;
  url?: string;
}

export interface PersistBundleResult {
  revision: string;
  files: string[];
  downloadIds: number[];
  artifactEntry: ExportArtifactEntry;
  skipped?: boolean;
}

export async function getDownloadEntry(downloadId: number | undefined): Promise<DownloadLookupResult> {
  if (typeof downloadId !== "number") {
    throw new Error("No download id was provided.");
  }
  const matches = (await browser.downloads.search({ id: downloadId })) as DownloadLookupResult[];
  const match = matches[0];
  if (!match) {
    throw new Error(`Download ${downloadId} was not found.`);
  }
  return match;
}

async function resolveArtifactBaseName(artifact: ExportArtifactEntry): Promise<string> {
  const conversationIndex = await loadConversationIndex();
  const indexedTitle = conversationIndex.find(
    (entry) => entry.platform === artifact.platform && entry.sourceId === artifact.sourceId,
  )?.title;
  const raw = indexedTitle?.trim() || artifact.sourceId;
  const compact = raw.replace(/\s+/g, " ").slice(0, 80);
  return sanitizePathSegment(compact) || sanitizePathSegment(artifact.sourceId);
}

async function resolveArtifactConversationFolder(artifact: ExportArtifactEntry): Promise<string> {
  const conversationIndex = await loadConversationIndex();
  const indexedTitle = conversationIndex.find(
    (entry) => entry.platform === artifact.platform && entry.sourceId === artifact.sourceId,
  )?.title;
  return buildConversationFolderName(indexedTitle, artifact.sourceId);
}

async function buildFallbackArtifactRelativePath(
  artifact: ExportArtifactEntry,
  kind: "markdown" | "bundle",
): Promise<string> {
  const conversationFolder = await resolveArtifactConversationFolder(artifact);
  const revisionFolder = buildRevisionFolderName(artifact.revision);
  const prefix = `AIexporter/${sanitizePathSegment(artifact.platform)}/${conversationFolder}/${revisionFolder}`;
  const basename = await resolveArtifactBaseName(artifact);
  return kind === "markdown" ? `${prefix}/${basename}.md` : `${prefix}/${basename}.bundle.json`;
}

export async function ensureArtifactFilename(
  artifact: ExportArtifactEntry,
  kind: "markdown" | "bundle",
): Promise<string | undefined> {
  const currentFilename = kind === "markdown" ? artifact.markdownFilename : artifact.bundleFilename;
  const expectedSuffix = kind === "markdown" ? ".md" : ".bundle.json";
  const expectedRelativePath = await buildFallbackArtifactRelativePath(artifact, kind);
  const normalizedExpectedPath = expectedRelativePath.replace(/\//g, "\\").toLowerCase();

  if (
    currentFilename &&
    currentFilename.toLowerCase().endsWith(expectedSuffix) &&
    currentFilename.replace(/\//g, "\\").toLowerCase().endsWith(normalizedExpectedPath)
  ) {
    return currentFilename;
  }

  const downloadId = kind === "markdown" ? artifact.markdownDownloadId : artifact.bundleDownloadId;
  const entry = await getDownloadEntry(downloadId);
  if (!entry.filename) {
    return currentFilename;
  }

  try {
    await pingNativeHost();
    const relocated = await relocateFileWithNativeHost(entry.filename, expectedRelativePath);
    if (!relocated.path) {
      return entry.filename;
    }

    await updateArtifactIndex(async (entries) =>
      entries.map((item) =>
        item.platform === artifact.platform &&
        item.sourceId === artifact.sourceId &&
        item.revision === artifact.revision
          ? {
              ...item,
              ...(kind === "markdown"
                ? { markdownFilename: relocated.path }
                : { bundleFilename: relocated.path }),
            }
          : item,
      ),
    );

    return relocated.path;
  } catch {
    return entry.filename;
  }
}

export async function getLatestArtifactOrThrow(
  platform: ExportArtifactEntry["platform"],
  sourceId: string,
): Promise<ExportArtifactEntry> {
  const artifacts = await loadArtifactIndex();
  const artifact = findLatestArtifactForConversation(artifacts, platform, sourceId);
  if (!artifact) {
    throw new Error("No local artifact was found for this conversation.");
  }
  return artifact;
}

export async function openLatestArtifact(platform: ExportArtifactEntry["platform"], sourceId: string): Promise<ExportArtifactEntry> {
  const artifact = await getLatestArtifactOrThrow(platform, sourceId);
  const filename = await ensureArtifactFilename(artifact, "markdown");
  if (!filename) {
    throw new Error("The latest markdown download has no resolved filename.");
  }

  try {
    await pingNativeHost();
    await openFileWithNativeHost(filename);
  } catch {
    await openDownloadedAsset(artifact.markdownDownloadId);
  }

  return artifact;
}

export async function showLatestArtifactFolder(
  platform: ExportArtifactEntry["platform"],
  sourceId: string,
): Promise<ExportArtifactEntry> {
  const artifact = await getLatestArtifactOrThrow(platform, sourceId);
  const filename = await ensureArtifactFilename(artifact, "markdown");
  if (!filename) {
    throw new Error("The latest markdown download has no resolved filename.");
  }

  try {
    await pingNativeHost();
    await showFolderWithNativeHost(filename);
  } catch {
    await showDownloadedAsset(artifact.markdownDownloadId);
  }

  return artifact;
}

export async function persistBundle(bundle: ConversationBundle, settings: ExtensionSettings): Promise<PersistBundleResult> {
  const revision = await buildBundleRevision(bundle);
  const serialized = serializeConversation(bundle, { revision });
  const prefix = buildArchivePrefix(bundle, revision);
  const baseName = buildArtifactBaseName(bundle);
  const manifestVersion = browser.runtime.getManifest().version;
  const artifacts = await loadArtifactIndex();
  const latestArtifact = findLatestArtifactForConversation(artifacts, bundle.platform, bundle.sourceId);
  const exactArtifact = findExactArtifact(artifacts, bundle.platform, bundle.sourceId, revision);

  await writeBackgroundLog("background.persist", "info", "Persisting conversation bundle.", {
    platform: bundle.platform,
    sourceId: bundle.sourceId,
    revision,
    messageCount: bundle.messages.length,
  });

  if (shouldSkipPersist(latestArtifact, revision, settings)) {
    const artifactEntry: ExportArtifactEntry =
      exactArtifact ??
      ({
        platform: bundle.platform,
        sourceId: bundle.sourceId,
        revision,
        exportedAt: new Date().toISOString(),
        localStatus: "skipped_existing",
        isLatestForConversation: true,
        markdownDownloadId: latestArtifact?.markdownDownloadId,
        bundleDownloadId: latestArtifact?.bundleDownloadId,
        markdownFilename: latestArtifact?.markdownFilename,
        bundleFilename: latestArtifact?.bundleFilename,
      } satisfies ExportArtifactEntry);

    await writeBackgroundLog("background.persist", "info", "Skipped existing latest artifact.", {
      code: "download.existing_latest",
      platform: bundle.platform,
      sourceId: bundle.sourceId,
      revision,
    });

    return {
      revision,
      files: [artifactEntry.markdownFilename, artifactEntry.bundleFilename].filter(
        (value): value is string => Boolean(value),
      ),
      downloadIds: [artifactEntry.markdownDownloadId, artifactEntry.bundleDownloadId].filter(
        (value): value is number => typeof value === "number",
      ),
      artifactEntry,
      skipped: true,
    };
  }

  const markdownFile = await downloadTextAsset(`${prefix}/${baseName}.md`, serialized.markdown, "text/markdown");
  const bundleFile = await downloadTextAsset(
    `${prefix}/${baseName}.bundle.json`,
    JSON.stringify(bundle, null, 2),
    "application/json",
  );
  await syncBundleToServer(bundle, settings, manifestVersion);

  const artifactEntry: ExportArtifactEntry = {
    platform: bundle.platform,
    sourceId: bundle.sourceId,
    revision,
    markdownDownloadId: markdownFile.downloadId,
    bundleDownloadId: bundleFile.downloadId,
    markdownFilename: markdownFile.filename,
    bundleFilename: bundleFile.filename,
    exportedAt: new Date().toISOString(),
    localStatus: "present",
    isLatestForConversation: true,
  };

  await updateArtifactIndex(async (entries) => {
    let nextEntries = upsertArtifactEntry(entries, artifactEntry);
    nextEntries = markLatestArtifacts(
      nextEntries,
      bundle.platform,
      bundle.sourceId,
      settings.downloads.retainLocalRevisionCount,
    );
    const pruned = pruneOldArtifacts(
      nextEntries,
      bundle.platform,
      bundle.sourceId,
      settings.downloads.retainLocalRevisionCount,
    );

    for (const prunedEntry of pruned.pruned) {
      await removeDownloadedAsset(prunedEntry.markdownDownloadId);
      await removeDownloadedAsset(prunedEntry.bundleDownloadId);
    }

    if (pruned.pruned.length > 0) {
      await writeBackgroundLog("background.artifact", "info", "Pruned old local revisions.", {
        code: "artifact.pruned_old_local_revisions",
        platform: bundle.platform,
        sourceId: bundle.sourceId,
        prunedRevisions: pruned.pruned.map((entry) => entry.revision),
        retainCount: settings.downloads.retainLocalRevisionCount,
      });
    }

    return pruned.nextEntries;
  });

  return {
    revision,
    files: [markdownFile.filename, bundleFile.filename],
    downloadIds: [markdownFile.downloadId, bundleFile.downloadId],
    artifactEntry,
  };
}

export async function markBundleExportResult(
  bundle: ConversationBundle,
  revision: string,
  exportState: ConversationIndexEntry["exportState"],
): Promise<void> {
  await updateConversationIndex((entries) => markConversationIndexExportResult(entries, bundle, revision, exportState));
  await refreshQueueServices();
}
