import {
  buildBundleRevision,
  buildDiscoveryFingerprint,
  type ConversationIndexEntry,
  type ExportArtifactEntry,
  type ExtensionSettings,
} from "@aiexporter/adapter-sdk";
import { resolveBundleTitle, type ConversationBundle, type DiscoveryEvent, type SourcePlatform } from "@aiexporter/core-schema";
import { markConversationIndexExportPending, markConversationIndexExportResult, upsertArtifactEntry, upsertConversationIndexEntry } from "../runtime/indexes";
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
import { buildArchivePrefix, buildArtifactBaseName, sanitizePathSegment } from "./shared";

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
  return `${platform}:${sourceId}:${revision}`;
}

function getParentDirectory(targetPath: string): string {
  const normalized = targetPath.replace(/\//g, "\\");
  return normalized.slice(0, normalized.lastIndexOf("\\"));
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
  const targetPlatforms: SourcePlatform[] = platform ? [platform] : ["chatgpt", "gemini", "aistudio", "deepseek"];
  let nextArtifacts = [...artifactIndex];
  let nextConversationIndex = [...conversationIndex];
  let verifiedCount = 0;
  let missingCount = 0;
  let importedCount = 0;
  const requeueEvents = new Map<string, DiscoveryEvent>();

  for (const entry of artifactIndex) {
    if (!targetPlatforms.includes(entry.platform)) continue;
    verifiedCount += 1;
    const present = await verifyArtifactFilesPresent(entry);
    if (present) {
      nextArtifacts = nextArtifacts.map((artifact) =>
        artifact.platform === entry.platform && artifact.sourceId === entry.sourceId && artifact.revision === entry.revision
          ? {
              ...artifact,
              localStatus: artifact.localStatus === "skipped_existing" ? "skipped_existing" : "present",
            }
          : artifact,
      );
      continue;
    }

    missingCount += 1;
    nextArtifacts = nextArtifacts.map((artifact) =>
      artifact.platform === entry.platform && artifact.sourceId === entry.sourceId && artifact.revision === entry.revision
        ? {
            ...artifact,
            localStatus: "missing",
            isLatestForConversation: false,
          }
        : artifact,
    );

    const conversationEntry = nextConversationIndex.find(
      (candidate) => candidate.platform === entry.platform && candidate.sourceId === entry.sourceId,
    );
    if (conversationEntry) {
      nextConversationIndex = markConversationIndexExportPending(nextConversationIndex, entry.platform, entry.sourceId);
      requeueEvents.set(`${entry.platform}:${entry.sourceId}`, {
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

  const existingKeys = new Set(nextArtifacts.map((entry) => getArtifactKey(entry.platform, entry.sourceId, entry.revision)));

  for (const nextPlatform of targetPlatforms) {
    const platformRoot = `${exportRoot}\\AIexporter\\${sanitizePathSegment(nextPlatform)}`;
    const platformRootExists = await fileExists(platformRoot);
    const bundlePaths = platformRootExists ? (await listFilesWithNativeHost(platformRoot, "*.bundle.json", true)).paths ?? [] : [];

    for (const bundlePath of bundlePaths) {
      try {
        const content = (await readFileWithNativeHost(bundlePath)).content;
        if (typeof content !== "string") continue;
        const parsed = JSON.parse(content) as unknown;
        if (!isConversationBundle(parsed)) continue;

        const bundle = parsed;
        const revision = getBundleMetaString(bundle, "revision") ?? (await buildBundleRevision(bundle));
        const desiredPrefix = `${exportRoot}\\${buildArchivePrefix(bundle, revision).replace(/\//g, "\\")}`;
        const currentFolder = getParentDirectory(bundlePath);
        let nextBundlePath = bundlePath;
        let nextMarkdownFilename = bundlePath.replace(/\.bundle\.json$/i, ".md");
        if (currentFolder.toLowerCase() !== desiredPrefix.toLowerCase()) {
          await movePathWithNativeHost(currentFolder, desiredPrefix);
          const baseName = buildArtifactBaseName(bundle);
          nextBundlePath = `${desiredPrefix}\\${baseName}.bundle.json`;
          nextMarkdownFilename = `${desiredPrefix}\\${baseName}.md`;
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
        if (!existingKeys.has(artifactKey)) {
          importedCount += 1;
          existingKeys.add(artifactKey);
        }

        nextArtifacts = upsertArtifactEntry(nextArtifacts, artifactEntry);
        const discoveryEvent = await buildDiscoveryEvent(bundle);
        nextConversationIndex = upsertConversationIndexEntry(nextConversationIndex, discoveryEvent, "complete", bundle.extractedAt);
        nextConversationIndex = markConversationIndexExportResult(
          nextConversationIndex,
          bundle,
          revision,
          markdownPresent ? "exported" : "pending",
          getBundleMetaString(bundle, "exportCompatibilityVersion") ?? getBundleMetaString(bundle, "exportSchemaVersion"),
        );

        if (!markdownPresent) {
          missingCount += 1;
          requeueEvents.set(`${bundle.platform}:${bundle.sourceId}`, discoveryEvent);
        }
      } catch {
        // Ignore unreadable bundle files during sync.
      }
    }
  }

  const latestKeys = new Set(
    nextArtifacts
      .filter(
        (entry) =>
          targetPlatforms.includes(entry.platform) &&
          entry.localStatus !== "deleted" &&
          entry.localStatus !== "archived",
      )
      .map((entry) => `${entry.platform}:${entry.sourceId}`),
  );

  for (const latestKey of latestKeys) {
    const [nextPlatform, sourceId] = latestKey.split(":") as [SourcePlatform, string];
    const conversationArtifacts = nextArtifacts
      .filter((entry) => entry.platform === nextPlatform && entry.sourceId === sourceId && entry.localStatus !== "deleted")
      .filter((entry) => entry.localStatus !== "archived")
      .sort((left, right) => Date.parse(right.exportedAt) - Date.parse(left.exportedAt));

    nextArtifacts = nextArtifacts.map((entry) =>
      entry.platform === nextPlatform && entry.sourceId === sourceId
        ? {
            ...entry,
            isLatestForConversation: conversationArtifacts[0]?.revision === entry.revision,
          }
        : entry,
    );
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
