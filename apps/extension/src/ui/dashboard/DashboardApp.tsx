import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { DebugLogLevel, ExtensionSettings, PlatformRuntimeConfig, UiLocale } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { useI18n } from "../i18n/useI18n";
import {
  cancelQueueItem,
  clearLogs,
  clearPlatformLocalRecords,
  clearQueueStatuses,
  exportLogs,
  forceExportQueueItem,
  openDashboard,
  openLatestArtifact,
  openSourceUrl,
  pausePlatform,
  processQueue,
  removeQueueItem,
  resumePlatform,
  retryFailed,
  retryQueueItem,
  runDiscovery,
  runFullBootstrap,
  showArtifactFolder,
  updatePlatformSettings,
  updateSettings,
} from "../services/dashboard-api";
import {
  buildAvailableLogCodes,
  buildAvailableLogScopes,
  buildDashboardArtifactState,
  buildDashboardConversationIndexMap,
  filterDashboardLogs,
  filterDashboardQueueItems,
  sortDashboardQueueItems,
  type DashboardQueueSortKey,
  type DashboardSortDirection,
  updateDownloadsSettingDraft,
  updateGlobalSettingDraft,
  updatePlatformSettingDraft,
  updateSchedulerSettingDraft,
} from "./controllers";
import { ActionButton } from "./components/ActionButton";
import { LogsTab } from "./components/LogsTab";
import { OverviewTab } from "./components/OverviewTab";
import { QueueTab } from "./components/QueueTab";
import { SettingsTab } from "./components/SettingsTab";
import { useDashboardSnapshot, type DashboardMode } from "./useDashboardSnapshot";

type DashboardTab = "overview" | "queue" | "logs" | "settings";

const popupPlatform: SourcePlatform = "deepseek";
const dashboardPlatforms: SourcePlatform[] = ["deepseek", "gemini", "aistudio", "chatgpt"];
const platformLabels: Record<SourcePlatform, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  aistudio: "AI Studio",
  chatgpt: "ChatGPT",
};

const containerStyle: CSSProperties = {
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  padding: 16,
  color: "#111827",
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#ffffff",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

function formatTimestamp(value: string | undefined): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

export function DashboardApp({ mode }: { mode: DashboardMode }) {
  const { queueState, debugState, artifactIndex, conversationIndex, settingsDraft, setSettingsDraft, refresh } =
    useDashboardSnapshot(mode);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [selectedPlatform, setSelectedPlatform] = useState<SourcePlatform>("deepseek");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const [queueSortKey, setQueueSortKey] = useState<DashboardQueueSortKey>("updatedAt");
  const [queueSortDirection, setQueueSortDirection] = useState<DashboardSortDirection>("desc");
  const [logLevels, setLogLevels] = useState<Record<DebugLogLevel, boolean>>({
    debug: true,
    info: true,
    warn: true,
    error: true,
  });
  const [logSearch, setLogSearch] = useState("");
  const [logScopeFilter, setLogScopeFilter] = useState("all");
  const [logCodeFilter, setLogCodeFilter] = useState("all");
  const [hoveredLogId, setHoveredLogId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [copiedDetails, setCopiedDetails] = useState(false);

  const locale: UiLocale = settingsDraft?.uiLocale ?? queueState?.settings.uiLocale ?? "zh-CN";
  const { t } = useI18n(locale);
  const debugLogs = debugState?.logs ?? [];

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const setGlobalSetting = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    setSettingsDraft((current) => (current ? updateGlobalSettingDraft(current, key, value) : current));
  };

  const setSchedulerSetting = <K extends keyof ExtensionSettings["scheduler"]>(
    key: K,
    value: ExtensionSettings["scheduler"][K],
  ) => {
    setSettingsDraft((current) => (current ? updateSchedulerSettingDraft(current, key, value) : current));
  };

  const setDownloadsSetting = <K extends keyof ExtensionSettings["downloads"]>(
    key: K,
    value: ExtensionSettings["downloads"][K],
  ) => {
    setSettingsDraft((current) => (current ? updateDownloadsSettingDraft(current, key, value) : current));
  };

  const setDeepSeekSetting = <K extends keyof PlatformRuntimeConfig>(key: K, value: PlatformRuntimeConfig[K]) => {
    setSettingsDraft((current) =>
      current ? updatePlatformSettingDraft(current, selectedPlatform, key, value) : current,
    );
  };

  const applyLocale = async (nextLocale: UiLocale) => {
    setGlobalSetting("uiLocale", nextLocale);
    await runAction(() => updateSettings({ uiLocale: nextLocale }));
  };

  useEffect(() => {
    setLogScopeFilter("all");
    setLogCodeFilter("all");
    setHoveredLogId(null);
    setSelectedLogId(null);
  }, [selectedPlatform]);

  const platformLogs = useMemo(
    () =>
      filterDashboardLogs(debugLogs, {
        logLevels: { debug: true, info: true, warn: true, error: true },
        logSearch: "",
        logScopeFilter: "all",
        logPlatformFilter: selectedPlatform,
        logCodeFilter: "all",
      }),
    [debugLogs, selectedPlatform],
  );
  const availableLogScopes = useMemo(() => buildAvailableLogScopes(platformLogs), [platformLogs]);
  const availableLogCodes = useMemo(() => buildAvailableLogCodes(platformLogs), [platformLogs]);
  const filteredLogs = useMemo(
    () =>
      filterDashboardLogs(debugLogs, {
        logLevels,
        logSearch,
        logScopeFilter,
        logPlatformFilter: selectedPlatform,
        logCodeFilter,
      }),
    [debugLogs, logCodeFilter, logLevels, logScopeFilter, logSearch, selectedPlatform],
  );
  const artifactState = useMemo(
    () => buildDashboardArtifactState(artifactIndex, selectedPlatform),
    [artifactIndex, selectedPlatform],
  );
  const conversationIndexMap = useMemo(
    () => buildDashboardConversationIndexMap(conversationIndex, selectedPlatform),
    [conversationIndex, selectedPlatform],
  );
  const filteredQueueItems = useMemo(
    () =>
      queueState
        ? sortDashboardQueueItems(
            filterDashboardQueueItems(
              queueState,
              {
                queueSearch,
                queueStatusFilter,
              },
              selectedPlatform,
              conversationIndexMap,
            ),
            conversationIndexMap,
            artifactState.latestArtifacts,
            queueSortKey,
            queueSortDirection,
          )
        : [],
    [
      artifactState.latestArtifacts,
      conversationIndexMap,
      queueSearch,
      queueSortDirection,
      queueSortKey,
      queueState,
      queueStatusFilter,
      selectedPlatform,
    ],
  );

  if (!queueState || !debugState || !settingsDraft) {
    return <div style={containerStyle}>{t("common.loading")}</div>;
  }

  const popupService = queueState.services[popupPlatform];
  const selectedService = queueState.services[selectedPlatform];
  const selectedPlatformLabel = platformLabels[selectedPlatform];
  const missingLocalQueueKeys = filteredQueueItems
    .filter((item) => !(settingsDraft.downloads.openFileActionsEnabled && artifactState.openableSourceIds.has(item.event.sourceId)))
    .filter((item) => item.status !== "processing")
    .map((item) => item.key);

  const reExportMissingLocal = async () => {
    for (const key of missingLocalQueueKeys) {
      await forceExportQueueItem(key);
    }
    await processQueue();
  };

  const handleOpenLatest = (sourceId: string) => {
    setActionError(null);
    const artifact = artifactState.latestArtifacts.get(sourceId);
    if (!artifact || typeof artifact.markdownDownloadId !== "number") {
      setActionError("No local markdown artifact was found for this conversation.");
      return;
    }
    void openLatestArtifact(selectedPlatform, sourceId).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to open latest markdown.");
    });
  };

  const handleShowFolder = (sourceId: string) => {
    setActionError(null);
    const artifact = artifactState.latestArtifacts.get(sourceId);
    if (!artifact || typeof artifact.markdownDownloadId !== "number") {
      setActionError("No local markdown artifact was found for this conversation.");
      return;
    }
    void showArtifactFolder(selectedPlatform, sourceId).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to show export folder.");
    });
  };

  const popupSummary = (
    <div style={{ ...containerStyle, minWidth: 520, maxWidth: 620, background: "#f3f4f6" }}>
      {actionError ? (
        <div style={{ marginBottom: 12, borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "10px 12px", fontSize: 12 }}>
          {actionError}
        </div>
      ) : null}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t("popup.title")}</div>
            <div style={{ color: "#4b5563", marginTop: 6, fontSize: 13 }}>
              {t("popup.subtitle")}
            </div>
          </div>
          <ActionButton disabled={busy} style={{ background: "#0f766e" }} onClick={() => void openDashboard()}>
            {t("common.openDashboard")}
          </ActionButton>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 16 }}>
          {dashboardPlatforms.map((platform) => {
            const service = queueState.services[platform];
            const label = platformLabels[platform];
            return (
              <div
                key={platform}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: 12,
                  background: platform === popupPlatform ? "#eff6ff" : "#f8fafc",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{label}</div>
                    <div style={{ color: "#475569", fontSize: 12 }}>
                      {t("overview.status")}: {service.status}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background: service.desiredRunning ? "#dcfce7" : "#e5e7eb",
                      color: service.desiredRunning ? "#166534" : "#475569",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {service.desiredRunning ? t("popup.running") : t("popup.paused")}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {[
                    [t("overview.pending"), service.stats.pending],
                    [t("overview.processing"), service.stats.processing],
                    [t("overview.failed"), service.stats.failed],
                    [t("overview.discovered"), service.stats.discoveredTotal],
                  ].map(([metricLabel, metricValue]) => (
                    <div key={metricLabel} style={{ borderRadius: 10, background: "#ffffff", padding: 8, border: "1px solid #e5e7eb" }}>
                      <div style={{ color: "#6b7280", fontSize: 11 }}>{metricLabel}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{metricValue}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gap: 4, fontSize: 11, color: "#475569" }}>
                  <div>{t("overview.lastDiscovery")}: {formatTimestamp(service.lastDiscoveryAt)}</div>
                  <div>{t("overview.lastExport")}: {formatTimestamp(service.lastExportAt)}</div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <ActionButton
                    disabled={busy}
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => void runAction(() => resumePlatform(platform))}
                  >
                    {t("common.resume")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy}
                    style={{ background: "#7c2d12", padding: "6px 10px", fontSize: 12 }}
                    onClick={() => void runAction(() => pausePlatform(platform))}
                  >
                    {t("common.pause")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy}
                    style={{ background: "#0f766e", padding: "6px 10px", fontSize: 12 }}
                    onClick={() => void runAction(() => runDiscovery(platform))}
                  >
                    {t("common.runDiscovery")}
                  </ActionButton>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <ActionButton disabled={busy} style={{ background: "#1d4ed8" }} onClick={() => void runAction(() => processQueue())}>
            {t("common.processQueue")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#475569" }} onClick={() => void refresh()}>
            {t("common.refresh")}
          </ActionButton>
        </div>
      </div>
    </div>
  );

  if (mode === "popup") {
    return popupSummary;
  }

  const tabs: DashboardTab[] = ["overview", "queue", "logs", "settings"];

  return (
    <div style={{ ...containerStyle, minWidth: 980 }}>
      <div style={{ display: "grid", gap: 16 }}>
        {actionError ? (
          <div style={{ borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "10px 12px", fontSize: 12 }}>
            {actionError}
          </div>
        ) : null}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{t("dashboard.title")}</div>
              <div style={{ color: "#4b5563", marginTop: 6 }}>{t("dashboard.subtitle")}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <ActionButton disabled={busy} style={{ background: locale === "zh-CN" ? "#111827" : "#475569" }} onClick={() => void applyLocale("zh-CN")}>
                {t("common.languageChinese")}
              </ActionButton>
              <ActionButton disabled={busy} style={{ background: locale === "en" ? "#111827" : "#475569" }} onClick={() => void applyLocale("en")}>
                {t("common.languageEnglish")}
              </ActionButton>
              <ActionButton disabled={busy} style={{ background: "#0f766e" }} onClick={() => void refresh()}>
                {t("common.refresh")}
              </ActionButton>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {dashboardPlatforms.map((platform) => (
              <ActionButton
                key={platform}
                style={{ background: selectedPlatform === platform ? "#0f172a" : "#64748b" }}
                onClick={() => setSelectedPlatform(platform)}
              >
                {platformLabels[platform]}
              </ActionButton>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {tabs.map((nextTab) => (
              <ActionButton
                key={nextTab}
                style={{ background: tab === nextTab ? "#111827" : "#475569" }}
                onClick={() => setTab(nextTab)}
              >
                {t(`tabs.${nextTab}` as const)}
              </ActionButton>
            ))}
          </div>
        </div>

        {tab === "overview" ? (
          <OverviewTab
            busy={busy}
            platformLabel={selectedPlatformLabel}
            service={selectedService}
            t={t}
            onResume={() => void runAction(() => resumePlatform(selectedPlatform))}
            onPause={() => void runAction(() => pausePlatform(selectedPlatform))}
            onRunDiscovery={() => void runAction(() => runDiscovery(selectedPlatform))}
            onRunFullDiscovery={() => void runAction(() => runFullBootstrap(selectedPlatform))}
            onProcessQueue={() => void runAction(() => processQueue())}
          />
        ) : null}

        {tab === "queue" ? (
          <QueueTab
            busy={busy}
            items={filteredQueueItems}
            conversationIndexMap={conversationIndexMap}
            latestArtifacts={artifactState.latestArtifacts}
            search={queueSearch}
            statusFilter={queueStatusFilter}
            sortKey={queueSortKey}
            sortDirection={queueSortDirection}
            t={t}
            openFileActionsEnabled={settingsDraft.downloads.openFileActionsEnabled}
            openableSourceIds={artifactState.openableSourceIds}
            onSearchChange={setQueueSearch}
            onStatusFilterChange={setQueueStatusFilter}
            onSortKeyChange={setQueueSortKey}
            onSortDirectionChange={setQueueSortDirection}
            onRetryFailed={() => void runAction(() => retryFailed())}
            onReExportMissingLocal={() => void runAction(() => reExportMissingLocal())}
            onClearCompleted={() => void runAction(() => clearQueueStatuses(["completed"], selectedPlatform))}
            onClearFailed={() => void runAction(() => clearQueueStatuses(["failed", "cancelled", "skipped"], selectedPlatform))}
            missingLocalCount={missingLocalQueueKeys.length}
            onPausePlatform={() => void runAction(() => pausePlatform(selectedPlatform))}
            onResumePlatform={() => void runAction(() => resumePlatform(selectedPlatform))}
            onOpenSource={openSourceUrl}
            onRetryItem={(key) => void runAction(() => retryQueueItem(key))}
            onCancelItem={(key) => void runAction(() => cancelQueueItem(key))}
            onRemoveItem={(key) => void runAction(() => removeQueueItem(key))}
            onForceExport={(key) => void runAction(() => forceExportQueueItem(key))}
            onOpenLatest={handleOpenLatest}
            onShowFolder={handleShowFolder}
          />
        ) : null}

        {tab === "logs" ? (
          <LogsTab
            busy={busy}
            logs={filteredLogs}
            logLevels={logLevels}
            logSearch={logSearch}
            logScopeFilter={logScopeFilter}
            logCodeFilter={logCodeFilter}
            platformLabel={selectedPlatformLabel}
            availableScopes={availableLogScopes}
            availableCodes={availableLogCodes}
            hoveredLogId={hoveredLogId}
            selectedLogId={selectedLogId}
            copiedDetails={copiedDetails}
            t={t}
            onLevelToggle={(level, checked) => setLogLevels((current) => ({ ...current, [level]: checked }))}
            onLogSearchChange={setLogSearch}
            onScopeFilterChange={setLogScopeFilter}
            onCodeFilterChange={setLogCodeFilter}
            onRefresh={() => void refresh()}
            onExportLogs={() => void runAction(() => exportLogs())}
            onClearLogs={() =>
              void runAction(async () => {
                await clearLogs();
              })
            }
            onHoverLog={setHoveredLogId}
            onSelectLog={(id) => {
              setSelectedLogId(id);
              if (!id) {
                setHoveredLogId(null);
              }
            }}
            onCopyDetails={() => {
              const detailLogEntry =
                filteredLogs.find((entry) => entry.id === selectedLogId) ??
                filteredLogs.find((entry) => entry.id === hoveredLogId) ??
                null;
              if (!detailLogEntry) return;
              void navigator.clipboard.writeText(JSON.stringify(detailLogEntry, null, 2)).then(() => {
                setCopiedDetails(true);
                window.setTimeout(() => setCopiedDetails(false), 1_200);
              });
            }}
            onCopyEntry={() => {
              const detailLogEntry =
                filteredLogs.find((entry) => entry.id === selectedLogId) ??
                filteredLogs.find((entry) => entry.id === hoveredLogId) ??
                null;
              if (!detailLogEntry) return;
              const lines = [
                detailLogEntry.timestamp,
                detailLogEntry.level.toUpperCase(),
                detailLogEntry.scope,
                detailLogEntry.code ?? "-",
                detailLogEntry.message,
                JSON.stringify(detailLogEntry.details ?? {}, null, 2),
              ];
              void navigator.clipboard.writeText(lines.join("\n"));
            }}
          />
        ) : null}

        {tab === "settings" ? (
          <SettingsTab
            busy={busy}
            locale={locale}
            platformLabel={selectedPlatformLabel}
            platformDraft={settingsDraft.platforms[selectedPlatform]}
            settingsDraft={settingsDraft}
            t={t}
            onLocaleChange={(nextLocale) => void applyLocale(nextLocale)}
            onGlobalSettingChange={setGlobalSetting}
            onSchedulerChange={setSchedulerSetting}
            onDownloadsChange={setDownloadsSetting}
            onPlatformChange={setDeepSeekSetting}
            onCommitGlobalSettings={(patch) => void runAction(() => updateSettings(patch))}
            onCommitDownloads={(patch) =>
              void runAction(() =>
                updateSettings({
                  downloads: {
                    ...settingsDraft.downloads,
                    ...patch,
                  },
                }),
              )
            }
            onCommitPlatform={(patch) => void runAction(() => updatePlatformSettings(selectedPlatform, patch))}
            onClearPlatformRecords={() => void runAction(() => clearPlatformLocalRecords(selectedPlatform))}
          />
        ) : null}

        <div style={{ color: "#64748b", fontSize: 12 }}>
          {selectedPlatformLabel} · {t("overview.lastDiscovery")}: {formatTimestamp(selectedService.lastDiscoveryAt)} · {t("overview.lastExport")}:{" "}
          {formatTimestamp(selectedService.lastExportAt)}
        </div>
      </div>
    </div>
  );
}
