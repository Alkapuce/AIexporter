import { AIEXPORTER_EXPORT_COMPATIBILITY_VERSION, type ConversationBundle } from "@aiexporter/core-schema";
import {
  formatConversationMessages,
  type ConversationFormat,
  type ConversationRenderOptions,
  type ConversationRenderPreset,
} from "./formats";
import { estimateTokens, formatTokenCount } from "./token-estimator";

export interface SerializeOptions {
  revision: string;
  includeFrontmatter?: boolean;
  format?: ConversationFormat;
  preset?: ConversationRenderPreset;
  renderOptions?: ConversationRenderOptions;
  includeConversationHeader?: boolean;
  includeMessageTimestamps?: boolean;
}

export interface SerializeResult {
  markdown: string;
  messageCount: number;
  estimatedTokens: number;
}

function getBundleMetaRecord(bundle: ConversationBundle): Record<string, unknown> {
  return bundle.meta && typeof bundle.meta === "object" ? bundle.meta : {};
}

function getBundleMetaString(bundle: ConversationBundle, key: string): string | undefined {
  const value = getBundleMetaRecord(bundle)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getBundleMetaStrings(bundle: ConversationBundle, key: string): string[] {
  const value = getBundleMetaRecord(bundle)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getAssistantName(bundle: ConversationBundle): string | undefined {
  return bundle.participants.find((participant) => participant.role === "assistant")?.name;
}

function yamlValue(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return '""';
  if (typeof value === "number") return String(value);

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "\\r").replaceAll("\n", "\\n")}"`;
}

function buildFrontmatterLines(bundle: ConversationBundle, options: SerializeOptions, messageCount: number): string[] {
  const participantNames = bundle.participants
    .map((participant) => participant.name.trim())
    .filter(Boolean)
    .join(", ");
  const assistantName = getAssistantName(bundle);
  const sourceHost = getBundleMetaString(bundle, "sourceHost");
  const sourceUpdatedLabel = getBundleMetaString(bundle, "sourceUpdatedLabel");
  const model = getBundleMetaString(bundle, "model");
  const exporterVersion = getBundleMetaString(bundle, "exporterVersion");
  const tools = getBundleMetaStrings(bundle, "tools").join(", ");

  return [
    "---",
    "aiexporter: v2",
    `export_compatibility_version: ${yamlValue(AIEXPORTER_EXPORT_COMPATIBILITY_VERSION)}`,
    `exporter_version: ${yamlValue(exporterVersion)}`,
    `platform: ${bundle.platform}`,
    `source_host: ${yamlValue(sourceHost)}`,
    `conversation_id: ${bundle.sourceId}`,
    `title: ${yamlValue(bundle.title)}`,
    `assistant: ${yamlValue(assistantName)}`,
    `model: ${yamlValue(model)}`,
    `participants: ${yamlValue(participantNames)}`,
    `tools: ${yamlValue(tools)}`,
    `source_url: ${yamlValue(bundle.url)}`,
    `source_updated_at: ${yamlValue(bundle.sourceUpdatedAt)}`,
    `source_updated_label: ${yamlValue(sourceUpdatedLabel)}`,
    `exported_at: ${yamlValue(bundle.extractedAt)}`,
    `message_count: ${messageCount}`,
    `revision: ${options.revision}`,
    `format: ${options.format ?? "full"}`,
    "---",
  ];
}

function buildConversationHeader(
  bundle: ConversationBundle,
  options: SerializeOptions,
  messageCount: number,
  estimatedTokens: number,
): string {
  const title = bundle.title?.trim() || bundle.sourceId;
  const assistantName = getAssistantName(bundle);
  const sourceHost = getBundleMetaString(bundle, "sourceHost");
  const model = getBundleMetaString(bundle, "model");
  const sourceUpdatedLabel = getBundleMetaString(bundle, "sourceUpdatedLabel");

  const identityParts = [
    `Source: ${bundle.platform}`,
    `Conversation ID: ${bundle.sourceId}`,
    assistantName ? `Assistant: ${assistantName}` : undefined,
    sourceHost ? `Host: ${sourceHost}` : undefined,
  ].filter((part): part is string => Boolean(part));
  const summaryParts = [
    `Messages: ${messageCount}`,
    `Tokens: ${formatTokenCount(estimatedTokens)}`,
    model ? `Model: ${model}` : undefined,
  ].filter((part): part is string => Boolean(part));

  if (bundle.url) {
    summaryParts.push(`URL: ${bundle.url}`);
  }

  const timelineParts = [`Exported: ${bundle.extractedAt}`];
  if (bundle.sourceUpdatedAt) {
    timelineParts.push(`Updated: ${bundle.sourceUpdatedAt}`);
  }
  if (sourceUpdatedLabel) {
    timelineParts.push(`Updated Label: ${sourceUpdatedLabel}`);
  }
  timelineParts.push(`Revision: ${options.revision}`);
  timelineParts.push(`Compatibility: ${AIEXPORTER_EXPORT_COMPATIBILITY_VERSION}`);

  return [
    `# ${title}`,
    `> ${identityParts.join(" | ")}`,
    `> ${summaryParts.join(" | ")}`,
    `> ${timelineParts.join(" | ")}`,
  ].join("\n\n");
}

export function serializeConversation(bundle: ConversationBundle, options: SerializeOptions): SerializeResult {
  const sections: string[] = [];
  const includeFrontmatter = options.includeFrontmatter ?? true;
  const format = options.format ?? "full";
  const preset = options.preset ?? "complete";
  const bodySections = formatConversationMessages(
    bundle,
    format,
    options.includeMessageTimestamps ?? true,
    preset,
    options.renderOptions,
  );
  const messageCount = bodySections.length;
  const body = bodySections.length > 0 ? bodySections.join("\n\n") : "_(empty conversation)_";
  const bodyWithHeader =
    (options.includeConversationHeader ?? true)
      ? `${buildConversationHeader(bundle, { ...options, format }, messageCount, estimateTokens(body))}\n\n${body}`
      : body;

  if (includeFrontmatter) {
    sections.push(buildFrontmatterLines(bundle, { ...options, format }, messageCount).join("\n"));
  }

  sections.push(bodyWithHeader);

  const markdown = sections.join("\n\n").trim() + "\n";
  const estimatedTokens = estimateTokens(markdown);

  return {
    markdown,
    messageCount,
    estimatedTokens,
  };
}
