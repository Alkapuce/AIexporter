import type { ConversationBundle } from "@aiexporter/core-schema";
import { formatConversationMessages, type ConversationFormat } from "./formats";
import { estimateTokens, formatTokenCount } from "./token-estimator";

export interface SerializeOptions {
  revision: string;
  includeFrontmatter?: boolean;
  format?: ConversationFormat;
  includeConversationHeader?: boolean;
  includeMessageTimestamps?: boolean;
}

export interface SerializeResult {
  markdown: string;
  messageCount: number;
  estimatedTokens: number;
}

function yamlValue(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "\"\"";
  if (typeof value === "number") return String(value);

  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}"`;
}

function buildFrontmatterLines(bundle: ConversationBundle, options: SerializeOptions, messageCount: number): string[] {
  return [
    "---",
    "aiexporter: v1",
    `platform: ${bundle.platform}`,
    `conversation_id: ${bundle.sourceId}`,
    `title: ${yamlValue(bundle.title)}`,
    `source_url: ${yamlValue(bundle.url)}`,
    `source_updated_at: ${yamlValue(bundle.sourceUpdatedAt)}`,
    `exported_at: ${yamlValue(bundle.extractedAt)}`,
    `message_count: ${messageCount}`,
    `revision: ${options.revision}`,
    `format: ${options.format ?? "full"}`,
    "---",
  ];
}

function buildConversationHeader(bundle: ConversationBundle, messageCount: number, estimatedTokens: number): string {
  const title = bundle.title?.trim() || bundle.sourceId;
  const metaParts = [
    `Source: ${bundle.platform}`,
    `Conversation ID: ${bundle.sourceId}`,
    `Messages: ${messageCount}`,
    `Tokens: ${formatTokenCount(estimatedTokens)}`,
  ];

  if (bundle.url) {
    metaParts.push(`URL: ${bundle.url}`);
  }

  const timelineParts = [`Exported: ${bundle.extractedAt}`];
  if (bundle.sourceUpdatedAt) {
    timelineParts.push(`Updated: ${bundle.sourceUpdatedAt}`);
  }

  return [`# ${title}`, `> ${metaParts.join(" | ")}`, `> ${timelineParts.join(" | ")}`].join("\n\n");
}

export function serializeConversation(
  bundle: ConversationBundle,
  options: SerializeOptions,
): SerializeResult {
  const sections: string[] = [];
  const includeFrontmatter = options.includeFrontmatter ?? true;
  const format = options.format ?? "full";
  const bodySections = formatConversationMessages(bundle, format, options.includeMessageTimestamps ?? true);
  const messageCount = bodySections.length;
  const body = bodySections.length > 0 ? bodySections.join("\n\n") : "_(empty conversation)_";
  const bodyWithHeader =
    options.includeConversationHeader ?? true
      ? `${buildConversationHeader(bundle, messageCount, estimateTokens(body))}\n\n${body}`
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
