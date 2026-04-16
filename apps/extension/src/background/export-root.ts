import type { ExtensionSettings } from "@aiexporter/adapter-sdk";

export function getConfiguredExportRoot(settings: ExtensionSettings): string | undefined {
  const candidate = settings.downloads.exportRootPath;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

export function hasCustomExportRoot(settings: ExtensionSettings): boolean {
  return Boolean(getConfiguredExportRoot(settings));
}
