import type { ConversationBundle, SourcePlatform } from "@aiexporter/core-schema";

export const PERIODIC_ALARM_NAME = "aiexporter.scheduler";
export const PLATFORM_ALARM_PREFIX = "aiexporter.platform";
export const DEBUG_LAST_MANUAL_EXPORT_KEY = "aiexporter.debug.lastManualExport";
export const SUPPORTED_PLATFORMS: SourcePlatform[] = ["chatgpt", "gemini", "deepseek"];
export const ORPHANED_PROCESSING_RECOVERY_MS = 30_000;

export function getPlatformAlarmName(platform: SourcePlatform): string {
  return `${PLATFORM_ALARM_PREFIX}.${platform}`;
}

export function isConversationBundle(value: unknown): value is ConversationBundle {
  return !!value && typeof value === "object" && Array.isArray((value as ConversationBundle).messages);
}

export function isErrorResponse(value: unknown): value is { __aiexporterError?: string } {
  return !!value && typeof value === "object" && "__aiexporterError" in value;
}

export function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/^[_\s.-]+|[_\s.-]+$/g, "");
}

export function shortenIdentifier(value: string, length = 8): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, length) || value.slice(0, length);
}

export function buildConversationFolderName(title: string | undefined, sourceId: string): string {
  const rawTitle = title?.trim() || sourceId;
  const compactTitle = rawTitle.replace(/\s+/g, " ").slice(0, 48);
  const sanitizedTitle = sanitizePathSegment(compactTitle) || sanitizePathSegment(sourceId);
  return `${sanitizedTitle}__${shortenIdentifier(sourceId)}`;
}

export function buildRevisionFolderName(revision: string): string {
  return shortenIdentifier(revision, 12);
}

export function buildArchivePrefix(bundle: ConversationBundle, revision: string): string {
  const conversationFolder = buildConversationFolderName(bundle.title, bundle.sourceId);
  const revisionFolder = buildRevisionFolderName(revision);
  return `AIexporter/${sanitizePathSegment(bundle.platform)}/${conversationFolder}/${revisionFolder}`;
}

export function buildArtifactBaseName(bundle: ConversationBundle): string {
  const raw = bundle.title?.trim() || bundle.sourceId;
  const compact = raw.replace(/\s+/g, " ").slice(0, 80);
  const sanitized = sanitizePathSegment(compact);
  return sanitized || sanitizePathSegment(bundle.sourceId);
}
