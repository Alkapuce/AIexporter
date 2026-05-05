import type { CSSProperties } from "react";
import type { ExtensionSettings, PlatformRuntimeConfig, UiLocale } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import type { MessageKey } from "../../i18n/useI18n";
import { ActionButton } from "./ActionButton";
import { THEME_MODES, type ThemeMode } from "../../theme-core";

type PlatformNumericField =
  | "maxConcurrency"
  | "minStartIntervalMs"
  | "navigationTimeoutMs"
  | "settleDelayMs"
  | "discoverySweepIntervalMs"
  | "discoveryReadyTimeoutMs"
  | "discoveryScrollStableRounds"
  | "discoveryDomMaxCycles"
  | "discoveryDomPostScrollWaitMs"
  | "discoveryDomStableCycles"
  | "discoveryDomScrollBottomAttempts"
  | "receiverReadyTimeoutMs"
  | "receiverRetryLimit";

interface SettingsTabProps {
  busy: boolean;
  locale: UiLocale;
  themeMode: ThemeMode;
  platformKey: SourcePlatform;
  platformLabel: string;
  platformDraft: PlatformRuntimeConfig;
  settingsDraft: ExtensionSettings;
  resolvedExportRoot?: string;
  t: (key: MessageKey) => string;
  onLocaleChange: (locale: UiLocale) => void;
  onThemeModeChange: (themeMode: ThemeMode) => void;
  onGlobalSettingChange: <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => void;
  onSchedulerChange: <K extends keyof ExtensionSettings["scheduler"]>(
    key: K,
    value: ExtensionSettings["scheduler"][K],
  ) => void;
  onDownloadsChange: <K extends keyof ExtensionSettings["downloads"]>(
    key: K,
    value: ExtensionSettings["downloads"][K],
  ) => void;
  onPlatformChange: <K extends keyof PlatformRuntimeConfig>(key: K, value: PlatformRuntimeConfig[K]) => void;
  onCommitGlobalSettings: (patch: Partial<ExtensionSettings>) => void;
  onCommitDownloads: (patch: Partial<ExtensionSettings["downloads"]>) => void;
  onCommitPlatform: (patch: Partial<PlatformRuntimeConfig>) => void;
  onPickExportRoot: () => void;
  onSyncArtifacts: () => void;
  onClearPlatformRecords: () => void;
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--aiexporter-border-color)",
  borderRadius: 16,
  padding: 16,
  background: "var(--aiexporter-surface-background)",
  boxShadow: "var(--aiexporter-shadow)",
};

const inputStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--aiexporter-input-border-color)",
  padding: "8px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "var(--aiexporter-input-background)",
  color: "var(--aiexporter-input-text-color)",
};

const discoverySweepIntervalPresets = [15 * 60 * 1_000, 60 * 60 * 1_000, 6 * 60 * 60 * 1_000, 24 * 60 * 60 * 1_000];

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "N/A";

  const minutes = Math.round(value / 60_000);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round((value / (60 * 60 * 1_000)) * 10) / 10;
  if (hours < 24) return `${hours} h`;

  const days = Math.round((value / (24 * 60 * 60 * 1_000)) * 10) / 10;
  return `${days} d`;
}

export function SettingsTab({
  busy,
  locale,
  themeMode,
  platformKey,
  platformLabel,
  platformDraft,
  settingsDraft,
  resolvedExportRoot,
  t,
  onLocaleChange,
  onThemeModeChange,
  onGlobalSettingChange,
  onSchedulerChange,
  onDownloadsChange,
  onPlatformChange,
  onCommitGlobalSettings,
  onCommitDownloads,
  onCommitPlatform,
  onPickExportRoot,
  onSyncArtifacts,
  onClearPlatformRecords,
}: SettingsTabProps) {
  const numericFields: Array<[MessageKey, PlatformNumericField]> = [
    ["settings.maxConcurrency", "maxConcurrency"],
    ["settings.minStartIntervalMs", "minStartIntervalMs"],
    ["settings.navigationTimeoutMs", "navigationTimeoutMs"],
    ["settings.settleDelayMs", "settleDelayMs"],
    ["settings.discoveryReadyTimeoutMs", "discoveryReadyTimeoutMs"],
    ["settings.discoveryScrollStableRounds", "discoveryScrollStableRounds"],
    ["settings.receiverReadyTimeoutMs", "receiverReadyTimeoutMs"],
    ["settings.receiverRetryLimit", "receiverRetryLimit"],
  ];

  const advancedDiscoveryFields: Array<[MessageKey, PlatformNumericField]> = [
    ["settings.discoveryDomMaxCycles", "discoveryDomMaxCycles"],
    ["settings.discoveryDomPostScrollWaitMs", "discoveryDomPostScrollWaitMs"],
    ["settings.discoveryDomStableCycles", "discoveryDomStableCycles"],
    ["settings.discoveryDomScrollBottomAttempts", "discoveryDomScrollBottomAttempts"],
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
            <select
              style={inputStyle}
              value={locale}
              onChange={(event) => onLocaleChange(event.target.value as UiLocale)}
            >
              <option value="zh-CN">{t("common.languageChinese")}</option>
              <option value="en">{t("common.languageEnglish")}</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.themeMode")}</span>
            <select
              style={inputStyle}
              value={themeMode}
              onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
            >
              {THEME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "system"
                    ? t("common.themeSystem")
                    : mode === "light"
                      ? t("common.themeLight")
                      : t("common.themeDark")}
                </option>
              ))}
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
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.downloads.exportRootPath")}</span>
            <input
              style={inputStyle}
              placeholder={t("settings.downloads.exportRootPlaceholder")}
              value={settingsDraft.downloads.exportRootPath ?? ""}
              onChange={(event) => onDownloadsChange("exportRootPath", event.target.value || undefined)}
              onBlur={() =>
                onCommitDownloads({ exportRootPath: settingsDraft.downloads.exportRootPath?.trim() || undefined })
              }
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <ActionButton
              disabled={busy}
              style={{ background: "var(--aiexporter-button-secondary-background)" }}
              onClick={onPickExportRoot}
            >
              {t("settings.downloads.browseExportRoot")}
            </ActionButton>
            <ActionButton
              disabled={busy}
              style={{ background: "var(--aiexporter-button-secondary-background)" }}
              onClick={() => {
                onDownloadsChange("exportRootPath", undefined);
                onCommitDownloads({ exportRootPath: undefined });
              }}
            >
              {t("settings.downloads.useDefaultExportRoot")}
            </ActionButton>
            <ActionButton
              disabled={busy}
              style={{ background: "var(--aiexporter-button-accent-background)" }}
              onClick={onSyncArtifacts}
            >
              {t("settings.downloads.syncLocalArtifacts")}
            </ActionButton>
          </div>
          <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
            {t("settings.downloads.exportRootResolved")}: {resolvedExportRoot ?? t("common.loading")}
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.downloads.revisionHistoryMode")}</span>
            <select
              style={inputStyle}
              value={settingsDraft.downloads.revisionHistoryMode ?? "recycle_previous"}
              onChange={(event) => {
                const value = event.target.value as NonNullable<ExtensionSettings["downloads"]["revisionHistoryMode"]>;
                onDownloadsChange("revisionHistoryMode", value);
                onCommitDownloads({ revisionHistoryMode: value });
              }}
            >
              <option value="disabled">{t("settings.downloads.revisionHistoryMode.disabled")}</option>
              <option value="recycle_previous">{t("settings.downloads.revisionHistoryMode.recycle")}</option>
              <option value="archive_then_recycle">{t("settings.downloads.revisionHistoryMode.archive")}</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.downloads.archiveRetentionDays")}</span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={String(settingsDraft.downloads.archiveRetentionDays ?? 7)}
              onChange={(event) => onDownloadsChange("archiveRetentionDays", Number(event.target.value))}
              onBlur={() =>
                onCommitDownloads({ archiveRetentionDays: settingsDraft.downloads.archiveRetentionDays ?? 7 })
              }
            />
          </label>
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
          <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
            {t("settings.downloads.retainLocalRevisionCountDeprecated")}
          </div>
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
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          {platformLabel} {t("settings.platformTitle")}
        </div>
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
          <div
            style={{
              display: "grid",
              gap: 8,
              border: "1px solid var(--aiexporter-border-color)",
              borderRadius: 12,
              padding: 12,
              background: "var(--aiexporter-surface-muted-background)",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{t("settings.discoverySweepIntervalMs")}</span>
              <span style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
                {t("settings.discoverySweepIntervalSummary")}:{" "}
                {formatDurationMs(platformDraft.discoverySweepIntervalMs)}
              </span>
              <span style={{ color: "var(--aiexporter-text-soft-color)", fontSize: 12 }}>
                {t("settings.discoverySweepIntervalHelp")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {discoverySweepIntervalPresets.map((preset) => (
                <ActionButton
                  key={preset}
                  disabled={busy}
                  style={{
                    background:
                      platformDraft.discoverySweepIntervalMs === preset
                        ? "var(--aiexporter-button-primary-background)"
                        : "var(--aiexporter-button-secondary-background)",
                  }}
                  onClick={() => {
                    onPlatformChange("discoverySweepIntervalMs", preset);
                    onCommitPlatform({ discoverySweepIntervalMs: preset });
                  }}
                >
                  {formatDurationMs(preset)}
                </ActionButton>
              ))}
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              <span>{t("settings.discoverySweepIntervalCustom")}</span>
              <input
                style={inputStyle}
                type="number"
                min={60_000}
                step={60_000}
                value={String(platformDraft.discoverySweepIntervalMs)}
                onChange={(event) => onPlatformChange("discoverySweepIntervalMs", Number(event.target.value))}
                onBlur={() =>
                  onCommitPlatform({ discoverySweepIntervalMs: Number(platformDraft.discoverySweepIntervalMs) })
                }
              />
            </label>
          </div>
          {numericFields.map(([labelKey, field]) => (
            <label key={field} style={{ display: "grid", gap: 6 }}>
              <span>{t(labelKey)}</span>
              <input
                style={inputStyle}
                type="number"
                min={field === "maxConcurrency" ? 1 : undefined}
                value={String(platformDraft[field])}
                onChange={(event) => onPlatformChange(field, Number(event.target.value))}
                onBlur={() =>
                  onCommitPlatform({ [field]: Number(platformDraft[field]) } as Partial<PlatformRuntimeConfig>)
                }
              />
            </label>
          ))}
          {platformKey === "gemini" ? (
            <details
              style={{
                border: "1px solid var(--aiexporter-border-color)",
                borderRadius: 12,
                padding: 12,
                background: "var(--aiexporter-surface-muted-background)",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>{t("settings.discoveryAdvancedTitle")}</summary>
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
                  {t("settings.discoveryAdvancedHelp")}
                </div>
                {advancedDiscoveryFields.map(([labelKey, field]) => (
                  <label key={field} style={{ display: "grid", gap: 6 }}>
                    <span>{t(labelKey)}</span>
                    <input
                      style={inputStyle}
                      type="number"
                      min={1}
                      value={String(platformDraft[field])}
                      onChange={(event) => onPlatformChange(field, Number(event.target.value))}
                      onBlur={() =>
                        onCommitPlatform({ [field]: Number(platformDraft[field]) } as Partial<PlatformRuntimeConfig>)
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <label style={{ display: "grid", gap: 6 }}>
            <span>{t("settings.apiExtractMode")}</span>
            <input
              style={{ ...inputStyle, background: "var(--aiexporter-input-muted-background)" }}
              value={platformDraft.apiExtractMode}
              readOnly
            />
          </label>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-danger-background)", justifySelf: "start" }}
            onClick={onClearPlatformRecords}
          >
            {t("settings.clearPlatformRecords")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
