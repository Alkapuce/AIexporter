import type { CSSProperties } from "react";
import type { ExtensionSettings, PlatformRuntimeConfig, UiLocale } from "@aiexporter/adapter-sdk";
import type { MessageKey } from "../../i18n/useI18n";
import { ActionButton } from "./ActionButton";

type PlatformNumericField =
  | "maxConcurrency"
  | "minStartIntervalMs"
  | "navigationTimeoutMs"
  | "settleDelayMs"
  | "discoverySweepIntervalMs"
  | "discoveryReadyTimeoutMs"
  | "discoveryScrollStableRounds"
  | "receiverReadyTimeoutMs"
  | "receiverRetryLimit";

interface SettingsTabProps {
  busy: boolean;
  locale: UiLocale;
  platformLabel: string;
  platformDraft: PlatformRuntimeConfig;
  settingsDraft: ExtensionSettings;
  t: (key: MessageKey) => string;
  onLocaleChange: (locale: UiLocale) => void;
  onGlobalSettingChange: <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => void;
  onSchedulerChange: <K extends keyof ExtensionSettings["scheduler"]>(key: K, value: ExtensionSettings["scheduler"][K]) => void;
  onDownloadsChange: <K extends keyof ExtensionSettings["downloads"]>(key: K, value: ExtensionSettings["downloads"][K]) => void;
  onPlatformChange: <K extends keyof PlatformRuntimeConfig>(key: K, value: PlatformRuntimeConfig[K]) => void;
  onCommitGlobalSettings: (patch: Partial<ExtensionSettings>) => void;
  onCommitDownloads: (patch: Partial<ExtensionSettings["downloads"]>) => void;
  onCommitPlatform: (patch: Partial<PlatformRuntimeConfig>) => void;
  onClearPlatformRecords: () => void;
}

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#ffffff",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

const inputStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "8px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

export function SettingsTab({
  busy,
  locale,
  platformLabel,
  platformDraft,
  settingsDraft,
  t,
  onLocaleChange,
  onGlobalSettingChange,
  onSchedulerChange,
  onDownloadsChange,
  onPlatformChange,
  onCommitGlobalSettings,
  onCommitDownloads,
  onCommitPlatform,
  onClearPlatformRecords,
}: SettingsTabProps) {
  const numericFields: Array<[MessageKey, PlatformNumericField]> = [
    ["settings.maxConcurrency", "maxConcurrency"],
    ["settings.minStartIntervalMs", "minStartIntervalMs"],
    ["settings.navigationTimeoutMs", "navigationTimeoutMs"],
    ["settings.settleDelayMs", "settleDelayMs"],
    ["settings.discoverySweepIntervalMs", "discoverySweepIntervalMs"],
    ["settings.discoveryReadyTimeoutMs", "discoveryReadyTimeoutMs"],
    ["settings.discoveryScrollStableRounds", "discoveryScrollStableRounds"],
    ["settings.receiverReadyTimeoutMs", "receiverReadyTimeoutMs"],
    ["settings.receiverRetryLimit", "receiverRetryLimit"],
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{t("settings.globalTitle")}</div>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.syncToServer")}</span>
            <input
              type="checkbox"
              checked={settingsDraft.syncToServer}
              onChange={(event) => {
                onGlobalSettingChange("syncToServer", event.target.checked);
                onCommitGlobalSettings({ syncToServer: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.autoStartOnLaunch")}</span>
            <input
              type="checkbox"
              checked={settingsDraft.scheduler.autoStartOnBrowserLaunch}
              onChange={(event) => {
                onSchedulerChange("autoStartOnBrowserLaunch", event.target.checked);
                onCommitGlobalSettings({
                  scheduler: {
                    ...settingsDraft.scheduler,
                    autoStartOnBrowserLaunch: event.target.checked,
                  },
                });
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.language")}</span>
            <select style={inputStyle} value={locale} onChange={(event) => onLocaleChange(event.target.value as UiLocale)}>
              <option value="zh-CN">{t("common.languageChinese")}</option>
              <option value="en">{t("common.languageEnglish")}</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.serverUrl")}</span>
            <input
              style={inputStyle}
              value={settingsDraft.serverUrl}
              onChange={(event) => onGlobalSettingChange("serverUrl", event.target.value)}
              onBlur={() => onCommitGlobalSettings({ serverUrl: settingsDraft.serverUrl })}
            />
          </label>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{t("settings.downloadsTitle")}</div>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.downloads.hideDownloadUi")}</span>
            <input
              type="checkbox"
              checked={settingsDraft.downloads.hideDownloadUi}
              onChange={(event) => {
                onDownloadsChange("hideDownloadUi", event.target.checked);
                onCommitDownloads({ hideDownloadUi: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.downloads.skipIfLatestExists")}</span>
            <input
              type="checkbox"
              checked={settingsDraft.downloads.skipIfLatestExists}
              onChange={(event) => {
                onDownloadsChange("skipIfLatestExists", event.target.checked);
                onCommitDownloads({ skipIfLatestExists: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.downloads.retainLocalRevisionCount")}</span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={String(settingsDraft.downloads.retainLocalRevisionCount)}
              onChange={(event) => onDownloadsChange("retainLocalRevisionCount", Number(event.target.value))}
              onBlur={() => onCommitDownloads({ retainLocalRevisionCount: settingsDraft.downloads.retainLocalRevisionCount })}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.downloads.openFileActionsEnabled")}</span>
            <input
              type="checkbox"
              checked={settingsDraft.downloads.openFileActionsEnabled}
              onChange={(event) => {
                onDownloadsChange("openFileActionsEnabled", event.target.checked);
                onCommitDownloads({ openFileActionsEnabled: event.target.checked });
              }}
            />
          </label>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{platformLabel} {t("settings.platformTitle")}</div>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.serviceEnabled")}</span>
            <input
              type="checkbox"
              checked={platformDraft.enabled}
              onChange={(event) => {
                onPlatformChange("enabled", event.target.checked);
                onCommitPlatform({ enabled: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.autoExportEnabled")}</span>
            <input
              type="checkbox"
              checked={platformDraft.autoExportEnabled}
              onChange={(event) => {
                onPlatformChange("autoExportEnabled", event.target.checked);
                onCommitPlatform({ autoExportEnabled: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.historyBackfillEnabled")}</span>
            <input
              type="checkbox"
              checked={platformDraft.historyBackfillEnabled}
              onChange={(event) => {
                onPlatformChange("historyBackfillEnabled", event.target.checked);
                onCommitPlatform({ historyBackfillEnabled: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.reuseWorkerTabs")}</span>
            <input
              type="checkbox"
              checked={platformDraft.reuseWorkerTabs}
              onChange={(event) => {
                onPlatformChange("reuseWorkerTabs", event.target.checked);
                onCommitPlatform({ reuseWorkerTabs: event.target.checked });
              }}
            />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("settings.bootstrapRequireFullHistory")}</span>
            <input
              type="checkbox"
              checked={platformDraft.bootstrapRequireFullHistory}
              onChange={(event) => {
                onPlatformChange("bootstrapRequireFullHistory", event.target.checked);
                onCommitPlatform({ bootstrapRequireFullHistory: event.target.checked });
              }}
            />
          </label>
          {numericFields.map(([labelKey, field]) => (
            <label key={field} style={{ display: "grid", gap: 6 }}>
              <span>{t(labelKey)}</span>
              <input
                style={inputStyle}
                type="number"
                value={String(platformDraft[field])}
                onChange={(event) => onPlatformChange(field, Number(event.target.value))}
                onBlur={() => onCommitPlatform({ [field]: Number(platformDraft[field]) } as Partial<PlatformRuntimeConfig>)}
              />
            </label>
          ))}
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.apiExtractMode")}</span>
            <input style={{ ...inputStyle, background: "#f8fafc" }} value={platformDraft.apiExtractMode} readOnly />
          </label>
          <ActionButton disabled={busy} style={{ background: "#991b1b", justifySelf: "start" }} onClick={onClearPlatformRecords}>
            {t("settings.clearPlatformRecords")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
