import { describe, expect, it } from "vitest";
import { type ExtensionSettings, type PlatformRuntimeConfig } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { getPlatformConfig } from "./state-access";

function makePlatformConfig(overrides?: Partial<PlatformRuntimeConfig>): PlatformRuntimeConfig {
  return {
    enabled: true,
    autoExportEnabled: true,
    historyBackfillEnabled: true,
    discoveryMode: "background_backfill",
    maxConcurrency: 4,
    minStartIntervalMs: 8_000,
    navigationTimeoutMs: 30_000,
    settleDelayMs: 1_200,
    discoverySweepIntervalMs: 24 * 60 * 60 * 1_000,
    reuseWorkerTabs: true,
    bootstrapRequireFullHistory: true,
    bootstrapWindowMode: "background_tab",
    discoveryReadyTimeoutMs: 12_000,
    discoveryScrollStableRounds: 2,
    discoveryDomMaxCycles: 24,
    discoveryDomPostScrollWaitMs: 5_000,
    discoveryDomStableCycles: 3,
    discoveryDomScrollBottomAttempts: 4,
    receiverReadyTimeoutMs: 5_000,
    receiverRetryLimit: 2,
    apiExtractMode: "page_world_first",
    ...overrides,
  };
}

function makeSettings(overrides?: Partial<ExtensionSettings>): ExtensionSettings {
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
      exportRootPath: undefined,
      revisionHistoryMode: "recycle_previous",
      archiveRetentionDays: 7,
    },
    platforms: {
      chatgpt: makePlatformConfig(),
      gemini: makePlatformConfig(),
      aistudio: makePlatformConfig(),
      deepseek: makePlatformConfig(),
    },
    ...overrides,
  } as ExtensionSettings;
}

describe("state-access", () => {
  describe("getPlatformConfig", () => {
    it("returns platform config with bootstrapWindowMode", () => {
      const settings = makeSettings();
      const config = getPlatformConfig(settings, "chatgpt");
      expect(config.bootstrapWindowMode).toBe("background_tab");
    });

    it("returns config with all expected fields", () => {
      const settings = makeSettings();
      const config = getPlatformConfig(settings, "chatgpt");
      expect(config).toHaveProperty("maxConcurrency");
      expect(config).toHaveProperty("discoveryMode");
      expect(config).toHaveProperty("bootstrapWindowMode");
    });

    it("migrates legacy gemini passive-only config to active backfill", () => {
      const settings = makeSettings({
        platforms: {
          chatgpt: makePlatformConfig(),
          deepseek: makePlatformConfig(),
          aistudio: makePlatformConfig(),
          gemini: makePlatformConfig({
            discoveryMode: "passive_only",
            historyBackfillEnabled: false,
            bootstrapRequireFullHistory: false,
            maxConcurrency: 1,
            minStartIntervalMs: 8_000,
            navigationTimeoutMs: 30_000,
            receiverRetryLimit: 2,
          }),
        },
      });

      const config = getPlatformConfig(settings, "gemini");
      expect(config.historyBackfillEnabled).toBe(true);
      expect(config.discoveryMode).toBe("background_backfill");
      expect(config.bootstrapRequireFullHistory).toBe(true);
    });

    it("does not migrate already-configured gemini", () => {
      const settings = makeSettings({
        platforms: {
          chatgpt: makePlatformConfig(),
          deepseek: makePlatformConfig(),
          aistudio: makePlatformConfig(),
          gemini: makePlatformConfig({
            discoveryMode: "background_backfill",
            historyBackfillEnabled: true,
            maxConcurrency: 2,
          }),
        },
      });

      const config = getPlatformConfig(settings, "gemini");
      expect(config.maxConcurrency).toBe(2);
      expect(config.discoveryMode).toBe("background_backfill");
    });

    it("enforces bootstrapWindowMode on all platforms", () => {
      const platforms: SourcePlatform[] = ["chatgpt", "deepseek", "gemini", "aistudio"];
      const settings = makeSettings();

      for (const platform of platforms) {
        const config = getPlatformConfig(settings, platform);
        expect(config.bootstrapWindowMode).toBe("background_tab");
      }
    });
  });
});
