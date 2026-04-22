import {
  AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
  buildBundleRevision,
  type ManualExportOptions,
  type ConversationIndexEntry,
  type ExportArtifactEntry,
  type ExtensionSettings,
} from "@aiexporter/adapter-sdk";
import {
  AIEXPORTER_EXPORT_SCHEMA_VERSION,
  extractFirstUserPromptTitle,
  normalizeConversationTitle,
  resolveBundleTitle,
  type ConversationBundle,
  type LinkedAttachmentDescriptor,
} from "@aiexporter/core-schema";
import { serializeConversation } from "@aiexporter/core-markdown";
import {
  downloadBinaryAsset,
  downloadRemoteAsset,
  downloadTextAsset,
  isDownloadedAssetPresent,
  openDownloadedAsset,
  removeDownloadedAsset,
  showDownloadedAsset,
} from "../runtime/downloads";
import {
  findExactArtifact,
  findLatestArtifactForConversation,
  findLatestOpenableArtifactForConversation,
  shouldSkipPersist,
} from "../runtime/artifacts";
import { markConversationIndexExportResult, upsertArtifactEntry } from "../runtime/indexes";
import { writeBackgroundLog } from "../runtime/logger";
import { syncBundleToServer } from "../runtime/server-sync";
import { loadArtifactIndex, loadConversationIndex, loadQueueState, updateArtifactIndex, updateConversationIndex } from "../runtime/storage";
import {
  checkPathExistsWithNativeHost,
  movePathWithNativeHost,
  openFileWithNativeHost,
  pingNativeHost,
  pruneOldFilesWithNativeHost,
  recyclePathWithNativeHost,
  relocateFileWithNativeHost,
  showFolderWithNativeHost,
  writeFileWithNativeHost,
} from "../runtime/native-host";
import { getConfiguredExportRoot, hasCustomExportRoot } from "./export-root";
import {
  buildArchivePrefix,
  buildArchivedRevisionPrefix,
  buildArtifactBaseName,
  buildConversationFolderName,
  sanitizePathSegment,
} from "./shared";
import { refreshQueueServices } from "./state-access";

export interface DownloadLookupResult {
  id?: number;
  filename?: string;
  finalUrl?: string;
  url?: string;
}

export interface PersistBundleResult {
  bundle: ConversationBundle;
  revision: string;
  files: string[];
  downloadIds: number[];
  artifactEntry: ExportArtifactEntry;
  skipped?: boolean;
}

function getNativeHostRequiredError(settings: ExtensionSettings): Error {
  const exportRoot = getConfiguredExportRoot(settings);
  return new Error(
    exportRoot
      ? `Custom export root requires native host: ${exportRoot}`
      : "Native host is required for the configured export root.",
  );
}

interface PersistTraceContext {
  traceId?: string;
  workerId?: string;
  sourceId?: string;
}

interface PersistBundleOptions extends Partial<ManualExportOptions> {
  exportRootPath?: string;
}

interface TargetArtifactPresenceOptions {
  latestArtifact: ExportArtifactEntry | undefined;
  settings: ExtensionSettings;
  includeMarkdown: boolean;
  includeBundleJson: boolean;
  markdownRelativePath: string;
  bundleRelativePath: string;
}

interface PreparedEmbeddedAsset {
  relativePath: string;
  markdownPath: string;
  mimeType: string;
  contentBase64?: string;
  sourceUrl?: string;
}

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+(?:\s+\"[^\"]*\")?)\)/g;
const ATTACHMENT_LINK_PATTERN = /> \[attachment\]\s+\[([^\]]+)\]\(([^)]+)\)/g;
const ATTACHMENT_RESOURCE_PATTERN = /> \[attachment\]\s+(.+?):\s+([^\s]+)\s*$/gm;
const ATTACHMENT_PLAIN_PATTERN = /> \[attachment\]\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/gm;

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
  const prefix = `AIexporter/${sanitizePathSegment(artifact.platform)}/${conversationFolder}`;
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
    const queueState = await loadQueueState();
    const exportRoot = getConfiguredExportRoot(queueState.settings);
    await pingNativeHost();
    const relocated = await relocateFileWithNativeHost(entry.filename, expectedRelativePath, exportRoot);
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
  const artifact =
    findLatestOpenableArtifactForConversation(artifacts, platform, sourceId) ??
    findLatestArtifactForConversation(artifacts, platform, sourceId);
  if (!artifact) {
    throw new Error("No local artifact was found for this conversation.");
  }
  return artifact;
}

function resolveImageExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  const slashIndex = normalized.indexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1).replace(/[^a-z0-9]+/g, "") || "bin" : "bin";
}

function buildEmbeddedImageName(rawAlt: string, index: number, mimeType: string): string {
  const normalizedAlt = rawAlt.trim().replace(/\.[a-z0-9]+$/i, "");
  const safeBase = sanitizePathSegment(normalizedAlt) || `image-${index}`;
  return `${String(index).padStart(2, "0")}-${safeBase}.${resolveImageExtension(mimeType)}`;
}

function extractMarkdownImageUrl(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const quoteIndex = trimmed.indexOf(' "');
  return (quoteIndex >= 0 ? trimmed.slice(0, quoteIndex) : trimmed).trim();
}

function getRevisionHistoryMode(settings: ExtensionSettings): "disabled" | "recycle_previous" | "archive_then_recycle" {
  const mode = settings.downloads.revisionHistoryMode;
  if (mode === "disabled" || mode === "archive_then_recycle" || mode === "recycle_previous") {
    return mode;
  }
  return "recycle_previous";
}

function getArchiveRetentionDays(settings: ExtensionSettings): number {
  const value = settings.downloads.archiveRetentionDays;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return 7;
}

function toWindowsPath(relativePath: string): string {
  return relativePath.replace(/\//g, "\\");
}

function normalizeWindowsPath(path: string | undefined): string {
  return (path ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function buildRootedWindowsPath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  return `${normalizedRoot}\\${toWindowsPath(relativePath)}`;
}

function joinRelativePath(...segments: Array<string | undefined>): string {
  return segments
    .map((segment) => (segment ?? "").trim())
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

function getDirectoryPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.replace(/\//g, "\\");
  const separatorIndex = normalized.lastIndexOf("\\");
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : undefined;
}

function collectLinkedAttachmentsFromBundle(bundle: ConversationBundle): LinkedAttachmentDescriptor[] {
  const existing = Array.isArray(bundle.meta?.["linkedAttachments"])
    ? (bundle.meta?.["linkedAttachments"] as LinkedAttachmentDescriptor[])
    : [];
  const deduped = new Map<string, LinkedAttachmentDescriptor>();
  existing.forEach((attachment) => {
    const key = [
      attachment.messageId,
      attachment.kind,
      attachment.sourceUrl ?? "",
      attachment.resourceId ?? "",
      attachment.title ?? "",
    ].join("::");
    deduped.set(key, attachment);
  });

  bundle.messages.forEach((message) => {
    ATTACHMENT_LINK_PATTERN.lastIndex = 0;
    ATTACHMENT_RESOURCE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTACHMENT_LINK_PATTERN.exec(message.markdown)) !== null) {
      const [, title = "", sourceUrl = ""] = match;
      const attachment: LinkedAttachmentDescriptor = {
        messageId: message.id,
        kind: "document",
        title: title.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      };
      const key = `${attachment.messageId}::${attachment.kind}::${attachment.sourceUrl ?? ""}::${attachment.title ?? ""}`;
      deduped.set(key, attachment);
    }
    while ((match = ATTACHMENT_RESOURCE_PATTERN.exec(message.markdown)) !== null) {
      const [, label = "", resourceId = ""] = match;
      const attachment: LinkedAttachmentDescriptor = {
        messageId: message.id,
        kind: "resource",
        title: label.trim() || undefined,
        resourceId: resourceId.trim() || undefined,
      };
      const key = `${attachment.messageId}::${attachment.kind}::${attachment.resourceId ?? ""}::${attachment.title ?? ""}`;
      deduped.set(key, attachment);
    }
    while ((match = ATTACHMENT_PLAIN_PATTERN.exec(message.markdown)) !== null) {
      const [, title = "", mimeType = ""] = match;
      if (!title.trim() || title.includes("](") || title.includes(": ")) continue;
      const attachment: LinkedAttachmentDescriptor = {
        messageId: message.id,
        kind: "document",
        title: title.trim() || undefined,
        mimeType: mimeType.trim() || undefined,
      };
      const key = `${attachment.messageId}::${attachment.kind}::${attachment.title ?? ""}::${attachment.mimeType ?? ""}`;
      deduped.set(key, attachment);
    }
  });

  return Array.from(deduped.values());
}

function inferMimeTypeFromFilename(filename: string | undefined): string {
  const normalized = filename?.trim().toLowerCase() ?? "";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

export function resolvePreferredConversationTitle(
  bundle: ConversationBundle,
  indexedTitle: string | undefined,
  queueState: Awaited<ReturnType<typeof loadQueueState>>,
): string | undefined {
  const normalizedIndexedTitle = normalizeConversationTitle(indexedTitle, bundle.sourceId);
  const queueTitle = [...queueState.items]
    .filter((item) => item.platform === bundle.platform && item.event.sourceId === bundle.sourceId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((item) => normalizeConversationTitle(item.event.title, bundle.sourceId))
    .find((title): title is string => Boolean(title));
  const promptFallbackTitle = extractFirstUserPromptTitle(bundle);

  // If the queue item's title is just the first user prompt (no real title was discovered),
  // prefer the indexed title which may have been captured from a better discovery pass.
  const queueTitleIsPromptFallback =
    Boolean(queueTitle) && Boolean(promptFallbackTitle) && queueTitle === promptFallbackTitle;

  if (queueTitleIsPromptFallback) {
    return normalizedIndexedTitle ?? queueTitle;
  }

  return queueTitle ?? normalizedIndexedTitle;
}

function buildRemoteImageAsset(
  sourceUrl: string,
  altText: string,
  index: number,
  assetRelativePrefix: string,
  assetMarkdownPrefix: string,
): PreparedEmbeddedAsset {
  const mimeType = inferMimeTypeFromFilename(altText);
  const filename = buildEmbeddedImageName(altText, index, mimeType);
  return {
    relativePath: joinRelativePath(assetRelativePrefix, filename),
    markdownPath: joinRelativePath(assetMarkdownPrefix, filename),
    mimeType,
    sourceUrl,
  };
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchRemoteAssetContentBase64(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch remote asset: ${response.status} ${response.statusText}`.trim());
  }

  const buffer = await response.arrayBuffer();
  return encodeUint8ArrayToBase64(new Uint8Array(buffer));
}

async function rewriteMarkdownEmbeddedImages(
  markdown: string,
  assetRelativePrefix: string,
  assetMarkdownPrefix: string,
  assetMap: Map<string, PreparedEmbeddedAsset>,
): Promise<string> {
  MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
  let assetIndex = assetMap.size;
  let cursor = 0;
  let output = "";
  let match: RegExpExecArray | null;

  while ((match = MARKDOWN_IMAGE_PATTERN.exec(markdown)) !== null) {
    const [fullMatch, altText = "", rawTarget = ""] = match;
    const target = extractMarkdownImageUrl(rawTarget);
    output += markdown.slice(cursor, match.index);
    cursor = match.index + fullMatch.length;

    const existing = assetMap.get(target);
    if (existing) {
      output += `![${altText}](${existing.markdownPath})`;
      continue;
    }

    const dataUriMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(target);
    if (dataUriMatch) {
      assetIndex += 1;
      const [, mimeType, contentBase64] = dataUriMatch;
      if (mimeType && contentBase64) {
        const filename = buildEmbeddedImageName(altText, assetIndex, mimeType);
        const asset: PreparedEmbeddedAsset = {
          relativePath: joinRelativePath(assetRelativePrefix, filename),
          markdownPath: joinRelativePath(assetMarkdownPrefix, filename),
          mimeType,
          contentBase64,
        };
        assetMap.set(target, asset);
        output += `![${altText}](${asset.markdownPath})`;
        continue;
      }
    }

    if (/^https?:\/\//i.test(target)) {
      assetIndex += 1;
      const asset = buildRemoteImageAsset(target, altText, assetIndex, assetRelativePrefix, assetMarkdownPrefix);
      assetMap.set(target, asset);
      output += `![${altText}](${asset.markdownPath})`;
      continue;
    }

    output += fullMatch;
  }

  output += markdown.slice(cursor);
  return output;
}

async function prepareBundleForPersistence(
  bundle: ConversationBundle,
  revision: string,
  manifestVersion: string,
  assetRelativePrefix: string,
  assetMarkdownPrefix: string,
  sourceUpdatedLabel?: string,
  preferredTitle?: string,
  options: PersistBundleOptions = {},
): Promise<{
  bundle: ConversationBundle;
  markdown: string;
  assets: PreparedEmbeddedAsset[];
}> {
  const assetMap = new Map<string, PreparedEmbeddedAsset>();
  const inheritedSourceUpdatedLabel =
    typeof bundle.meta?.["sourceUpdatedLabel"] === "string" ? bundle.meta["sourceUpdatedLabel"] : undefined;
  const rewrittenMessages = await Promise.all(
    bundle.messages.map(async (message) => ({
      ...message,
      markdown: await rewriteMarkdownEmbeddedImages(
        message.markdown,
        assetRelativePrefix,
        assetMarkdownPrefix,
        assetMap,
      ),
    })),
  );
  const resolvedTitle = resolveBundleTitle({
    ...bundle,
    messages: rewrittenMessages,
  }, preferredTitle);
  const linkedAttachments = collectLinkedAttachmentsFromBundle({
    ...bundle,
    messages: rewrittenMessages,
  });

  const preparedBundle: ConversationBundle = {
    ...bundle,
    title: resolvedTitle.title,
    messages: rewrittenMessages,
    meta: {
      ...(bundle.meta ?? {}),
      sourceUpdatedLabel: sourceUpdatedLabel ?? inheritedSourceUpdatedLabel,
      exporterVersion: manifestVersion,
      exportCompatibilityVersion: AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
      exportSchemaVersion: AIEXPORTER_EXPORT_SCHEMA_VERSION,
      revision,
      embeddedAssets: Array.from(assetMap.values()).map((asset) => ({
        path: asset.markdownPath,
        mimeType: asset.mimeType,
        sourceUrl: asset.sourceUrl,
      })),
      linkedAttachments,
    },
  };

  const serialized = serializeConversation(preparedBundle, {
    revision,
    preset: options.preset ?? "complete",
    renderOptions: options.markdownOptions,
    includeMessageTimestamps: options.markdownOptions?.includeMessageTimestamps ?? true,
  });
  return {
    bundle: preparedBundle,
    markdown: serialized.markdown,
    assets: Array.from(assetMap.values()),
  };
}

export async function openLatestArtifact(platform: ExportArtifactEntry["platform"], sourceId: string): Promise<ExportArtifactEntry> {
  const artifact = await getLatestArtifactOrThrow(platform, sourceId);
  const filename =
    (artifact.markdownFilename || typeof artifact.markdownDownloadId === "number"
      ? await ensureArtifactFilename(artifact, "markdown")
      : undefined) ??
    (artifact.bundleFilename || typeof artifact.bundleDownloadId === "number"
      ? await ensureArtifactFilename(artifact, "bundle")
      : undefined);
  if (!filename) {
    throw new Error("The latest artifact has no resolved filename.");
  }

  try {
    await pingNativeHost();
    await openFileWithNativeHost(filename);
  } catch {
    if (typeof (artifact.markdownDownloadId ?? artifact.bundleDownloadId) !== "number") {
      throw new Error(`文件由本地服务写入，需要 native host 才能打开。请确认 native host 已注册并运行。文件路径：${filename}`);
    }
    await openDownloadedAsset(artifact.markdownDownloadId ?? artifact.bundleDownloadId);
  }

  return artifact;
}

export async function showLatestArtifactFolder(
  platform: ExportArtifactEntry["platform"],
  sourceId: string,
): Promise<ExportArtifactEntry> {
  const artifact = await getLatestArtifactOrThrow(platform, sourceId);
  const filename =
    (artifact.markdownFilename || typeof artifact.markdownDownloadId === "number"
      ? await ensureArtifactFilename(artifact, "markdown")
      : undefined) ??
    (artifact.bundleFilename || typeof artifact.bundleDownloadId === "number"
      ? await ensureArtifactFilename(artifact, "bundle")
      : undefined);
  if (!filename) {
    throw new Error("The latest artifact has no resolved filename.");
  }

  try {
    await pingNativeHost();
    await showFolderWithNativeHost(filename);
  } catch {
    if (typeof (artifact.markdownDownloadId ?? artifact.bundleDownloadId) !== "number") {
      throw new Error(`文件由本地服务写入，需要 native host 才能显示目录。请确认 native host 已注册并运行。文件路径：${filename}`);
    }
    await showDownloadedAsset(artifact.markdownDownloadId ?? artifact.bundleDownloadId);
  }

  return artifact;
}

async function maybeLogNamingResolution(
  bundle: ConversationBundle,
  traceContext: PersistTraceContext,
): Promise<void> {
  const resolved = resolveBundleTitle(bundle);
  if (resolved.usedFallback) {
    await writeBackgroundLog("background.naming", "warn", "Fell back to the first user prompt for export title.", {
      code: "naming.title_fallback_used",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      originalTitle: bundle.title,
      resolvedTitle: resolved.title,
    });
  }

  if (resolved.unresolved) {
    await writeBackgroundLog("background.naming", "warn", "Conversation title remained unresolved after fallback.", {
      code: "naming.unresolved_generic_title",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      originalTitle: bundle.title,
    });
  }
}

async function recycleOrArchivePreviousConversation(
  latestArtifact: ExportArtifactEntry | undefined,
  bundle: ConversationBundle,
  revision: string,
  settings: ExtensionSettings,
  traceContext: PersistTraceContext,
): Promise<ExportArtifactEntry | undefined> {
  if (!latestArtifact || latestArtifact.revision === revision) {
    return latestArtifact;
  }

  const currentFolderPath =
    getDirectoryPath(latestArtifact.markdownFilename) ?? getDirectoryPath(latestArtifact.bundleFilename);
  if (!currentFolderPath) {
    return latestArtifact;
  }

  const mode = getRevisionHistoryMode(settings);
  if (mode === "disabled" || mode === "recycle_previous") {
    try {
      await pingNativeHost();
      await recyclePathWithNativeHost(currentFolderPath);
      await writeBackgroundLog("background.artifact", "info", "Recycled previous local revision.", {
        code: "artifact.previous_revision_recycled",
        platform: bundle.platform,
        sourceId: traceContext.sourceId ?? bundle.sourceId,
        workerId: traceContext.workerId,
        traceId: traceContext.traceId,
        previousRevision: latestArtifact.revision,
        folderPath: currentFolderPath,
      });
      return {
        ...latestArtifact,
        localStatus: "deleted",
      };
    } catch (error) {
      await writeBackgroundLog("background.artifact", "warn", "Failed to recycle previous local revision.", {
        code: "artifact.previous_revision_recycle_failed",
        platform: bundle.platform,
        sourceId: traceContext.sourceId ?? bundle.sourceId,
        workerId: traceContext.workerId,
        traceId: traceContext.traceId,
        previousRevision: latestArtifact.revision,
        folderPath: currentFolderPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return latestArtifact;
  }

  const archivePrefix = buildArchivedRevisionPrefix(bundle, latestArtifact.revision);
  const exportRoot = getConfiguredExportRoot(settings);
  const rootMarkerIndex = currentFolderPath.toLowerCase().indexOf("\\aiexporter\\");
  const inferredExportRoot = rootMarkerIndex >= 0 ? currentFolderPath.slice(0, rootMarkerIndex) : exportRoot;
  const archiveTargetFolder = `${(inferredExportRoot ?? exportRoot ?? "").replace(/[\\/]+$/, "")}\\${toWindowsPath(archivePrefix)}`.replace(
    /^\\+/,
    "",
  );
  try {
    await pingNativeHost();
    await movePathWithNativeHost(currentFolderPath, archiveTargetFolder);
    const pruned = await pruneOldFilesWithNativeHost(
      `${(inferredExportRoot ?? exportRoot ?? "").replace(/[\\/]+$/, "")}\\AIexporter\\Archive`.replace(/^\\+/, ""),
      "*",
      true,
      getArchiveRetentionDays(settings),
    );
    await writeBackgroundLog("background.artifact", "info", "Archived previous local revision.", {
      code: "artifact.previous_revision_archived",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      previousRevision: latestArtifact.revision,
      archiveTargetFolder,
    });
    if ((pruned.paths ?? []).length > 0) {
      await writeBackgroundLog("background.artifact", "info", "Pruned archived local revisions older than retention.", {
        code: "artifact.previous_revision_archive_pruned",
        platform: bundle.platform,
        sourceId: traceContext.sourceId ?? bundle.sourceId,
        workerId: traceContext.workerId,
        traceId: traceContext.traceId,
        prunedCount: (pruned.paths ?? []).length,
      });
    }
    const archivedMarkdownFilename = latestArtifact.markdownFilename
      ? `${archiveTargetFolder}\\${latestArtifact.markdownFilename.split(/[/\\]/).pop()}`
      : undefined;
    const archivedBundleFilename = latestArtifact.bundleFilename
      ? `${archiveTargetFolder}\\${latestArtifact.bundleFilename.split(/[/\\]/).pop()}`
      : undefined;
    return {
      ...latestArtifact,
      markdownFilename: archivedMarkdownFilename,
      bundleFilename: archivedBundleFilename,
      localStatus: "archived",
      archivedAt: new Date().toISOString(),
      isLatestForConversation: false,
    };
  } catch (error) {
    await writeBackgroundLog("background.artifact", "warn", "Failed to archive previous local revision.", {
      code: "artifact.previous_revision_archive_failed",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      previousRevision: latestArtifact.revision,
      archiveTargetFolder,
      error: error instanceof Error ? error.message : String(error),
    });
    return latestArtifact;
  }
}

export async function persistBundle(
  bundle: ConversationBundle,
  settings: ExtensionSettings,
  traceContext: PersistTraceContext = {},
  options: PersistBundleOptions = {},
): Promise<PersistBundleResult> {
  const queueState = await loadQueueState();
  const conversationIndex = await loadConversationIndex();
  const indexedConversation = conversationIndex.find(
    (entry) => entry.platform === bundle.platform && entry.sourceId === bundle.sourceId,
  );
  const preferredTitle = resolvePreferredConversationTitle(bundle, indexedConversation?.title, queueState);
  const resolvedLiveTitle = resolveBundleTitle(bundle, preferredTitle);
  if (resolvedLiveTitle.usedFallback) {
    throw new Error(
      `无法解析对话标题，文件名将退化为用户首句（"${resolvedLiveTitle.title}"）。请等待 Gemini 生成摘要标题后重试。`,
    );
  }
  const bundleForPersistence =
    resolvedLiveTitle.title === bundle.title
      ? bundle
      : {
          ...bundle,
          title: resolvedLiveTitle.title,
        };
  const revision = await buildBundleRevision(bundleForPersistence);
  const baseName = buildArtifactBaseName(bundleForPersistence);
  const flatOutput = options.flatOutput ?? false;
  const prefix = flatOutput ? "" : buildArchivePrefix(bundleForPersistence, revision);
  const assetDirectoryName = `${baseName}.assets`;
  const assetRelativePrefix = joinRelativePath(prefix, assetDirectoryName);
  const assetMarkdownPrefix = assetDirectoryName;
  const manifestVersion = browser.runtime.getManifest().version;
  const artifacts = await loadArtifactIndex();
  const exportRootPath = options.exportRootPath?.trim() || undefined;
  const effectiveSettings = exportRootPath
    ? {
        ...settings,
        downloads: {
          ...settings.downloads,
          exportRootPath,
        },
      }
    : settings;
  const includeMarkdown = options.includeMarkdown ?? true;
  const includeBundleJson = options.includeBundleJson ?? true;
  if (!includeMarkdown && !includeBundleJson) {
    throw new Error("At least one export format must be selected.");
  }
  const prepared = await prepareBundleForPersistence(
    bundleForPersistence,
    revision,
    manifestVersion,
    assetRelativePrefix,
    assetMarkdownPrefix,
    indexedConversation?.latestSourceUpdatedLabel,
    indexedConversation?.title,
    options,
  );
  await maybeLogNamingResolution(prepared.bundle, traceContext);
  const latestArtifact = findLatestArtifactForConversation(artifacts, bundle.platform, bundle.sourceId);
  const exactArtifact = findExactArtifact(artifacts, bundle.platform, bundle.sourceId, revision);

  await writeBackgroundLog("background.persist", "info", "Persisting conversation bundle.", {
    platform: bundle.platform,
    sourceId: traceContext.sourceId ?? bundle.sourceId,
    workerId: traceContext.workerId,
    traceId: traceContext.traceId,
    revision,
    messageCount: bundle.messages.length,
  });

  const latestArtifactFilesPresent = latestArtifact
    ? await verifyArtifactFilesPresent(latestArtifact)
    : false;

  if (latestArtifact && !latestArtifactFilesPresent) {
    await updateArtifactIndex((entries) =>
      entries.map((entry) =>
        entry.platform === latestArtifact.platform &&
        entry.sourceId === latestArtifact.sourceId &&
        entry.revision === latestArtifact.revision
          ? {
              ...entry,
              localStatus: "missing",
              isLatestForConversation: false,
            }
          : entry,
      ),
    );

    await writeBackgroundLog("background.persist", "warn", "Latest artifact index entry was missing local files, forcing re-export.", {
      code: "artifact.latest_missing_local_files",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      revision: latestArtifact.revision,
      markdownFilename: latestArtifact.markdownFilename,
      bundleFilename: latestArtifact.bundleFilename,
    });
  }

  if (
    latestArtifactFilesPresent &&
    (await verifyTargetArtifactPathsPresent({
      latestArtifact,
      settings: effectiveSettings,
      includeMarkdown,
      includeBundleJson,
      markdownRelativePath: joinRelativePath(prefix, `${baseName}.md`),
      bundleRelativePath: joinRelativePath(prefix, `${baseName}.bundle.json`),
    })) &&
    (!includeMarkdown || Boolean(latestArtifact?.markdownFilename || typeof latestArtifact?.markdownDownloadId === "number")) &&
    (!includeBundleJson || Boolean(latestArtifact?.bundleFilename || typeof latestArtifact?.bundleDownloadId === "number")) &&
    shouldSkipPersist(
      latestArtifact,
      revision,
      effectiveSettings,
      indexedConversation?.latestExportCompatibilityVersion,
      AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
    )
  ) {
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
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      revision,
    });

    return {
      bundle: prepared.bundle,
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

  const previousArtifactState = await recycleOrArchivePreviousConversation(
    latestArtifact,
    prepared.bundle,
    revision,
    effectiveSettings,
    traceContext,
  );

  let markdownFile =
    includeMarkdown
      ? await persistTextArtifact(joinRelativePath(prefix, `${baseName}.md`), prepared.markdown, "text/markdown", effectiveSettings)
      : undefined;
  let bundleFile =
    includeBundleJson
      ? await persistTextArtifact(
          joinRelativePath(prefix, `${baseName}.bundle.json`),
          JSON.stringify(prepared.bundle, null, 2),
          "application/json",
          effectiveSettings,
        )
      : undefined;
  const assetFiles = await Promise.all(
    prepared.assets.map((asset) =>
      asset.sourceUrl
        ? persistRemoteArtifact(asset.relativePath, asset.sourceUrl, effectiveSettings)
        : persistBinaryArtifact(asset.relativePath, asset.contentBase64 ?? "", asset.mimeType, effectiveSettings),
    ),
  );
  try {
    await syncBundleToServer(prepared.bundle, effectiveSettings, manifestVersion);
  } catch (error) {
    await writeBackgroundLog("background.persist", "warn", "Server sync failed, continuing with local persistence.", {
      code: "artifact.server_sync_failed",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let artifactEntry: ExportArtifactEntry = {
    platform: bundle.platform,
    sourceId: bundle.sourceId,
    revision,
    markdownDownloadId: markdownFile?.downloadId,
    bundleDownloadId: bundleFile?.downloadId,
    markdownFilename: markdownFile?.filename,
    bundleFilename: bundleFile?.filename,
    exportedAt: new Date().toISOString(),
    localStatus: "present",
    isLatestForConversation: true,
  };

  if (!(await verifyArtifactFilesPresent(artifactEntry))) {
    await writeBackgroundLog("background.persist", "warn", "Downloaded artifacts were missing after initial write, retrying with forced fresh downloads.", {
      code: "artifact.retry_missing_after_write",
      platform: bundle.platform,
      sourceId: traceContext.sourceId ?? bundle.sourceId,
      workerId: traceContext.workerId,
      traceId: traceContext.traceId,
      revision,
      markdownFilename: artifactEntry.markdownFilename,
      bundleFilename: artifactEntry.bundleFilename,
    });

    markdownFile =
      includeMarkdown
        ? await persistTextArtifact(joinRelativePath(prefix, `${baseName}.md`), prepared.markdown, "text/markdown", effectiveSettings, {
            forceFresh: true,
          })
        : undefined;
    bundleFile =
      includeBundleJson
        ? await persistTextArtifact(
            joinRelativePath(prefix, `${baseName}.bundle.json`),
            JSON.stringify(prepared.bundle, null, 2),
            "application/json",
            effectiveSettings,
            {
              forceFresh: true,
            },
          )
        : undefined;
    await Promise.all(
      prepared.assets.map((asset) =>
        asset.sourceUrl
          ? persistRemoteArtifact(asset.relativePath, asset.sourceUrl, effectiveSettings, {
              forceFresh: true,
            })
          : persistBinaryArtifact(asset.relativePath, asset.contentBase64 ?? "", asset.mimeType, effectiveSettings, {
              forceFresh: true,
            }),
      ),
    );

    artifactEntry = {
      ...artifactEntry,
      markdownDownloadId: markdownFile?.downloadId,
      bundleDownloadId: bundleFile?.downloadId,
      markdownFilename: markdownFile?.filename,
      bundleFilename: bundleFile?.filename,
    };
  }

  if (!(await verifyArtifactFilesPresent(artifactEntry))) {
    throw new Error("Downloaded artifacts were not found on disk after retry.");
  }

  await updateArtifactIndex(async (entries) => {
    let nextEntries = entries.map((entry) => {
      if (entry.platform !== bundle.platform || entry.sourceId !== bundle.sourceId) {
        return entry;
      }

      if (previousArtifactState && entry.revision === previousArtifactState.revision) {
        return {
          ...entry,
          ...previousArtifactState,
        };
      }

      if (entry.revision !== revision) {
        const localStatus: ExportArtifactEntry["localStatus"] =
          getRevisionHistoryMode(effectiveSettings) === "archive_then_recycle" && entry.localStatus === "archived"
            ? "archived"
            : "deleted";
        return {
          ...entry,
          isLatestForConversation: false,
          localStatus,
        };
      }

      return entry;
    });

    nextEntries = upsertArtifactEntry(nextEntries, artifactEntry);
    nextEntries = nextEntries.map((entry) =>
      entry.platform === bundle.platform && entry.sourceId === bundle.sourceId
        ? {
            ...entry,
            isLatestForConversation: entry.revision === revision,
          }
        : entry,
    );

    if (previousArtifactState && previousArtifactState.localStatus === "deleted") {
      await removeDownloadedAsset(previousArtifactState.markdownDownloadId);
      await removeDownloadedAsset(previousArtifactState.bundleDownloadId);
    }

    return nextEntries;
  });

  return {
    bundle: prepared.bundle,
    revision,
    files: [markdownFile?.filename, bundleFile?.filename, ...assetFiles.map((asset) => asset?.filename)].filter(
      (value): value is string => Boolean(value),
    ),
    downloadIds: [markdownFile?.downloadId, bundleFile?.downloadId].filter(
      (value): value is number => typeof value === "number",
    ),
    artifactEntry,
  };
}

async function persistTextArtifact(
  relativePath: string,
  content: string,
  mimeType: string,
  settings: ExtensionSettings,
  options: { forceFresh?: boolean } = {},
) {
  const exportRoot = getConfiguredExportRoot(settings);
  try {
    await pingNativeHost();
    const response = await writeFileWithNativeHost(relativePath, content, "utf8", exportRoot);
    if (response.path) {
      return {
        downloadId: undefined,
        filename: response.path,
      };
    }
  } catch (error) {
    if (hasCustomExportRoot(settings)) {
      throw getNativeHostRequiredError(settings);
    }
    if (error instanceof Error && error.message.includes("Custom export root requires native host")) {
      throw error;
    }
  }

  return downloadTextAsset(relativePath, content, mimeType, options, exportRoot);
}

async function persistBinaryArtifact(
  relativePath: string,
  contentBase64: string,
  mimeType: string,
  settings: ExtensionSettings,
  options: { forceFresh?: boolean } = {},
) {
  const exportRoot = getConfiguredExportRoot(settings);
  try {
    await pingNativeHost();
    const response = await writeFileWithNativeHost(relativePath, contentBase64, "base64", exportRoot);
    if (response.path) {
      return {
        downloadId: undefined,
        filename: response.path,
      };
    }
  } catch {
    if (hasCustomExportRoot(settings)) {
      throw getNativeHostRequiredError(settings);
    }
  }

  return downloadBinaryAsset(relativePath, contentBase64, mimeType, options, exportRoot);
}

async function persistRemoteArtifact(
  relativePath: string,
  url: string,
  settings: ExtensionSettings,
  options: { forceFresh?: boolean } = {},
) {
  const exportRoot = getConfiguredExportRoot(settings);
  if (hasCustomExportRoot(settings)) {
    await pingNativeHost();
  }

  const downloaded = await downloadRemoteAsset(relativePath, url, options, exportRoot);
  if (hasCustomExportRoot(settings) && exportRoot) {
    const normalizedResolved = normalizeWindowsPath(downloaded.filename);
    const normalizedExpectedRoot = normalizeWindowsPath(exportRoot);
    if (!normalizedResolved.startsWith(`${normalizedExpectedRoot}\\`) && normalizedResolved !== normalizedExpectedRoot) {
      throw new Error(`Remote asset was not written under the selected export root: ${downloaded.filename}`);
    }
  }
  return downloaded;
}

async function verifyArtifactFilePath(path: string | undefined): Promise<boolean> {
  if (!path) return false;

  try {
    await pingNativeHost();
    const response = await checkPathExistsWithNativeHost(path);
    return Boolean(response.path);
  } catch {
    return false;
  }
}

export async function verifyTargetArtifactPathsPresent({
  latestArtifact,
  settings,
  includeMarkdown,
  includeBundleJson,
  markdownRelativePath,
  bundleRelativePath,
}: TargetArtifactPresenceOptions): Promise<boolean> {
  const exportRoot = getConfiguredExportRoot(settings);
  if (!exportRoot) {
    return true;
  }

  const expectedMarkdownPath = includeMarkdown ? buildRootedWindowsPath(exportRoot, markdownRelativePath) : undefined;
  const expectedBundlePath = includeBundleJson ? buildRootedWindowsPath(exportRoot, bundleRelativePath) : undefined;

  const latestMarkdownMatchesTarget =
    includeMarkdown &&
    normalizeWindowsPath(latestArtifact?.markdownFilename) === normalizeWindowsPath(expectedMarkdownPath);
  const latestBundleMatchesTarget =
    includeBundleJson &&
    normalizeWindowsPath(latestArtifact?.bundleFilename) === normalizeWindowsPath(expectedBundlePath);

  const [markdownPresent, bundlePresent] = await Promise.all([
    includeMarkdown
      ? latestMarkdownMatchesTarget
        ? verifyArtifactFilePath(latestArtifact?.markdownFilename)
        : verifyArtifactFilePath(expectedMarkdownPath)
      : Promise.resolve(true),
    includeBundleJson
      ? latestBundleMatchesTarget
        ? verifyArtifactFilePath(latestArtifact?.bundleFilename)
        : verifyArtifactFilePath(expectedBundlePath)
      : Promise.resolve(true),
  ]);

  return markdownPresent && bundlePresent;
}

export async function verifyArtifactFilesPresent(artifact: ExportArtifactEntry): Promise<boolean> {
  const requiresMarkdown = Boolean(artifact.markdownFilename || typeof artifact.markdownDownloadId === "number");
  const requiresBundle = Boolean(artifact.bundleFilename || typeof artifact.bundleDownloadId === "number");
  if (!requiresMarkdown && !requiresBundle) {
    return false;
  }

  const [markdownByPath, bundleByPath] = await Promise.all([
    verifyArtifactFilePath(artifact.markdownFilename),
    verifyArtifactFilePath(artifact.bundleFilename),
  ]);

  const markdownSatisfied = !requiresMarkdown || markdownByPath;
  const bundleSatisfied = !requiresBundle || bundleByPath;
  if (markdownSatisfied && bundleSatisfied) {
    return true;
  }

  const [markdownByDownload, bundleByDownload] = await Promise.all([
    isDownloadedAssetPresent(artifact.markdownDownloadId, artifact.markdownFilename),
    isDownloadedAssetPresent(artifact.bundleDownloadId, artifact.bundleFilename),
  ]);

  return (!requiresMarkdown || markdownByDownload) && (!requiresBundle || bundleByDownload);
}

export async function markBundleExportResult(
  bundle: ConversationBundle,
  revision: string,
  exportState: ConversationIndexEntry["exportState"],
): Promise<void> {
  await updateConversationIndex((entries) =>
    markConversationIndexExportResult(
      entries,
      bundle,
      revision,
      exportState,
      AIEXPORTER_EXPORT_COMPATIBILITY_VERSION,
    ),
  );
  await refreshQueueServices();
}
