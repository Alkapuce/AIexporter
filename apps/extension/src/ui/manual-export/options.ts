import type { ManualExportMarkdownOptions, ManualExportOptions, ManualExportPreset } from "@aiexporter/adapter-sdk";

export const DEFAULT_MANUAL_EXPORT_MARKDOWN_OPTIONS: ManualExportMarkdownOptions = {
  includeThinking: false,
  includeImages: true,
  includeAttachments: true,
  includeMessageTimestamps: true,
};

export function buildManualExportMarkdownOptions(preset: ManualExportPreset): ManualExportMarkdownOptions {
  if (preset === "complete") {
    return {
      includeThinking: true,
      includeImages: true,
      includeAttachments: true,
      includeMessageTimestamps: true,
    };
  }

  if (preset === "share") {
    return {
      includeThinking: false,
      includeImages: false,
      includeAttachments: false,
      includeMessageTimestamps: true,
    };
  }

  return { ...DEFAULT_MANUAL_EXPORT_MARKDOWN_OPTIONS };
}

export function applyManualExportPreset(
  current: ManualExportOptions,
  preset: ManualExportPreset,
): ManualExportOptions {
  return {
    ...current,
    preset,
    markdownOptions: buildManualExportMarkdownOptions(preset),
  };
}

export function createDefaultManualExportOptions(exportRootPath?: string): ManualExportOptions {
  return {
    preset: "standard",
    includeMarkdown: true,
    includeBundleJson: false,
    markdownOptions: buildManualExportMarkdownOptions("standard"),
    exportRootPath,
    flatOutput: true,
  };
}

export function describeManualExportPreset(preset: ManualExportPreset): string {
  if (preset === "complete") {
    return "完整：保留 thinking、图片、附件和消息时间。";
  }
  if (preset === "share") {
    return "分享：去掉 thinking、图片和附件，只保留正文、代码和消息时间。";
  }
  return "标准：去掉 thinking，保留图片、附件和消息时间。";
}
