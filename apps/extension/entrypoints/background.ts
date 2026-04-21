import type { RuntimeMessage } from "@aiexporter/adapter-sdk";
import { runPeriodicSchedulerWork } from "../src/background/automatic-artifact-sync";
import { loadArtifactSyncState } from "../src/background/artifact-sync-state";
import { createBackgroundRuntimeRouter } from "../src/background/runtime-router";
import { createBackgroundServiceRuntime } from "../src/background/service-runtime";
import { ensureInitialized, recordManualExportDebug, syncDownloadUiWithSettings } from "../src/background/state-access";
import { PERIODIC_ALARM_NAME, SUPPORTED_PLATFORMS, getPlatformAlarmName } from "../src/background/shared";
import { writeBackgroundLog } from "../src/runtime/logger";
import { loadQueueState } from "../src/runtime/storage";

const serviceRuntime = createBackgroundServiceRuntime();
const handleRuntimeMessage = createBackgroundRuntimeRouter(serviceRuntime);

export default defineBackground(() => {
  void ensureInitialized().then((state) => {
    void syncDownloadUiWithSettings(state.settings);
    void writeBackgroundLog("background.lifecycle", "info", "Background script initialized.", {
      settings: state.settings,
    });

    if (state.settings.scheduler.autoStartOnBrowserLaunch) {
      SUPPORTED_PLATFORMS.forEach((platform) => {
        serviceRuntime.requestPlatformStartupCatchup(platform);
      });
    }
  });

  browser.alarms.create(PERIODIC_ALARM_NAME, { periodInMinutes: 1 });

  browser.runtime.onInstalled.addListener(() => {
    void ensureInitialized().then((state) => {
      void syncDownloadUiWithSettings(state.settings);
      void writeBackgroundLog("background.lifecycle", "info", "Extension installed or updated.");
      SUPPORTED_PLATFORMS.forEach((platform) => {
        serviceRuntime.requestPlatformTick(platform);
      });
    });
  });

  browser.runtime.onStartup.addListener(() => {
    void ensureInitialized().then((state) => {
      void syncDownloadUiWithSettings(state.settings);
      void writeBackgroundLog("background.lifecycle", "info", "Browser startup detected.");
      if (state.settings.scheduler.autoStartOnBrowserLaunch) {
        SUPPORTED_PLATFORMS.forEach((platform) => {
          serviceRuntime.requestPlatformStartupCatchup(platform);
        });
      }
    });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PERIODIC_ALARM_NAME) {
      void writeBackgroundLog("background.lifecycle", "debug", "Periodic scheduler alarm triggered.");
      void runPeriodicSchedulerWork({
        loadQueueState,
        loadArtifactSyncState,
        runArtifactSync: async () => {
          await handleRuntimeMessage({ type: "artifact-sync-run" }, {} as browser.runtime.MessageSender);
        },
        requestPlatformTick: (platform) => {
          serviceRuntime.requestPlatformTick(platform);
        },
        writeBackgroundLog,
      });
      return;
    }

    const platform = SUPPORTED_PLATFORMS.find((candidate) => alarm.name === getPlatformAlarmName(candidate));
    if (platform) {
      void writeBackgroundLog("background.lifecycle", "debug", "Platform scheduler alarm triggered.", {
        platform,
        alarmName: alarm.name,
      });
      serviceRuntime.requestPlatformTick(platform);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void serviceRuntime.handleTabRemoved(tabId);
  });

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    void handleRuntimeMessage(message, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown background error";
        void writeBackgroundLog("background.error", "error", "Runtime message handling failed.", {
          requestType: message.type,
          senderTabId: sender.tab?.id,
          errorMessage,
        });
        void recordManualExportDebug({
          request: message,
          senderTabId: sender.tab?.id,
          error: errorMessage,
        });
        sendResponse({
          __aiexporterError: errorMessage,
        });
      });

    return true;
  });
});
