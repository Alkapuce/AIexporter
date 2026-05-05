import { describe, expect, it } from "vitest";
import type { ExtensionSettings } from "@aiexporter/adapter-sdk";
import { getConfiguredExportRoot, hasCustomExportRoot } from "./export-root";

function makeSettings(exportRootPath?: string): ExtensionSettings {
  return {
    syncToServer: false,
    serverUrl: "http://127.0.0.1:8787",
    browserLabel: "test",
    uiLocale: "en",
    uiThemeMode: "system",
    dashboardOpenBehavior: "tab",
    scheduler: {
      autoStartOnBrowserLaunch: false,
      globalPaused: false,
      logRetentionEntries: 400,
    },
    downloads: {
      mode: "downloads-api",
      hideDownloadUi: true,
      skipIfLatestExists: true,
      retainLocalRevisionCount: 1,
      openFileActionsEnabled: true,
      exportRootPath,
      revisionHistoryMode: "recycle_previous",
      archiveRetentionDays: 7,
    },
    platforms: {
      chatgpt: {} as never,
      gemini: {} as never,
      aistudio: {} as never,
      deepseek: {} as never,
    },
  } as ExtensionSettings;
}

describe("export-root", () => {
  describe("getConfiguredExportRoot", () => {
    it("returns undefined when exportRootPath is undefined", () => {
      const settings = makeSettings(undefined);
      expect(getConfiguredExportRoot(settings)).toBeUndefined();
    });

    it("returns undefined when exportRootPath is empty string", () => {
      const settings = makeSettings("");
      expect(getConfiguredExportRoot(settings)).toBeUndefined();
    });

    it("returns undefined when exportRootPath is whitespace only", () => {
      const settings = makeSettings("   ");
      expect(getConfiguredExportRoot(settings)).toBeUndefined();
    });

    it("returns trimmed path for valid input", () => {
      const settings = makeSettings("  C:\\Exports  ");
      expect(getConfiguredExportRoot(settings)).toBe("C:\\Exports");
    });

    it("returns the path as-is when already trimmed", () => {
      const settings = makeSettings("C:\\Users\\test\\AIexporter");
      expect(getConfiguredExportRoot(settings)).toBe("C:\\Users\\test\\AIexporter");
    });

    it("handles Unix-style paths", () => {
      const settings = makeSettings("/home/user/AIexporter");
      expect(getConfiguredExportRoot(settings)).toBe("/home/user/AIexporter");
    });
  });

  describe("hasCustomExportRoot", () => {
    it("returns false when no export root configured", () => {
      const settings = makeSettings(undefined);
      expect(hasCustomExportRoot(settings)).toBe(false);
    });

    it("returns true when export root is configured", () => {
      const settings = makeSettings("C:\\Exports");
      expect(hasCustomExportRoot(settings)).toBe(true);
    });

    it("returns false for whitespace-only export root", () => {
      const settings = makeSettings("   ");
      expect(hasCustomExportRoot(settings)).toBe(false);
    });
  });
});
