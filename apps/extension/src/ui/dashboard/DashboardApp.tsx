import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  DebugLogEntry,
  DebugLogLevel,
  ExtensionSettings,
  ExportArtifactEntry,
  PlatformRuntimeConfig,
  QueueItemStatus,
  QueueState,
  UiLocale,
} from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import { useI18n } from "../i18n/useI18n";
import {
  cancelQueueItem,
  clearLogs,
  clearPlatformLocalRecords,
  clearQueueStatuses,
  exportLogs,
  fetchDashboardState,
  forceExportQueueItem,
  openDashboard,
  openLatestArtifact,
  openSourceUrl,
  pausePlatform,
  processQueue,
  removeQueueItem,
  requestDebugState,
  requestQueueState,
  resumePlatform,
  retryFailed,
  retryQueueItem,
  runDiscovery,
  runFullBootstrap,
  showArtifactFolder,
  updatePlatformSettings,
  updateSettings,
} from "../services/dashboard-api";
import { findLatestOpenableArtifactForConversation } from "../../runtime/artifacts";
import { ActionButton } from "./components/ActionButton";
import { LogsTab } from "./components/LogsTab";
import { OverviewTab } from "./components/OverviewTab";
import { QueueTab } from "./components/QueueTab";
import { SettingsTab } from "./components/SettingsTab";

export type DashboardMode = "popup" | "options" | "dashboard";
type DashboardTab = "overview" | "queue" | "logs" | "settings";

const deepseekPlatform: SourcePlatform = "deepseek";

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

function cloneSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    ...settings,
    scheduler: { ...settings.scheduler },
    downloads: { ...settings.downloads },
    platforms: {
      chatgpt: { ...settings.platforms.chatgpt },
      gemini: { ...settings.platforms.gemini },
      deepseek: { ...settings.platforms.deepseek },
    },
  };
}

function normalizeLogPlatform(entry: DebugLogEntry): SourcePlatform | undefined {
  if (entry.platform) return entry.platform;
  if (typeof entry.details?.platform === "string") {
    return entry.details.platform as SourcePlatform;
  }
  if (entry.scope.includes("deepseek")) return "deepseek";
  if (entry.scope.includes("chatgpt")) return "chatgpt";
  if (entry.scope.includes("gemini")) return "gemini";
  return undefined;
}

function isStatusFilterMatch(filter: string, status: QueueItemStatus): boolean {
  return filter === "all" || filter === status;
}

export function DashboardApp({ mode }: { mode: DashboardMode }) {
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [debugState, setDebugState] = useState<Awaited<ReturnType<typeof requestDebugState>> | null>(null);
  const [artifactIndex, setArtifactIndex] = useState<ExportArtifactEntry[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<ExtensionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const [logLevels, setLogLevels] = useState<Record<DebugLogLevel, boolean>>({
    debug: true,
    info: true,
    warn: true,
    error: true,
  });
  const [logSearch, setLogSearch] = useState("");
  const [logScopeFilter, setLogScopeFilter] = useState("all");
  const [logPlatformFilter, setLogPlatformFilter] = useState<SourcePlatform | "all">("all");
  const [logCodeFilter, setLogCodeFilter] = useState("all");
  const [hoveredLogId, setHoveredLogId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [copiedDetails, setCopiedDetails] = useState(false);

  const locale: UiLocale = settingsDraft?.uiLocale ?? queueState?.settings.uiLocale ?? "zh-CN";
  const { t } = useI18n(locale);
  const debugLogs = debugState?.logs ?? [];

  const refresh = async () => {
    const snapshot = await fetchDashboardState();
    setQueueState(snapshot.queueState);
    setDebugState(snapshot.debugState);
    setArtifactIndex(snapshot.artifactIndex);
    setSettingsDraft((current) => current ?? cloneSettings(snapshot.queueState.settings));
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, mode === "popup" ? 3_000 : 4_000);
    return () => window.clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    if (queueState) {
      setSettingsDraft(cloneSettings(queueState.settings));
    }
  }, [queueState?.settings]);

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
    setSettingsDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const setSchedulerSetting = <K extends keyof ExtensionSettings["scheduler"]>(
    key: K,
    value: ExtensionSettings["scheduler"][K],
  ) => {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            scheduler: {
              ...current.scheduler,
              [key]: value,
            },
          }
        : current,
    );
  };

  const setDownloadsSetting = <K extends keyof ExtensionSettings["downloads"]>(
    key: K,
    value: ExtensionSettings["downloads"][K],
  ) => {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            downloads: {
              ...current.downloads,
              [key]: value,
            },
          }
        : current,
    );
  };

  const setDeepSeekSetting = <K extends keyof PlatformRuntimeConfig>(key: K, value: PlatformRuntimeConfig[K]) => {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            platforms: {
              ...current.platforms,
              deepseek: {
                ...current.platforms.deepseek,
                [key]: value,
              },
            },
          }
        : current,
    );
  };

  const applyLocale = async (nextLocale: UiLocale) => {
    setGlobalSetting("uiLocale", nextLocale);
    await runAction(() => updateSettings({ uiLocale: nextLocale }));
  };

  const availableLogScopes = useMemo(
    () => ["all", ...Array.from(new Set(debugLogs.map((entry) => entry.scope))).sort()],
    [debugLogs],
  );
  const availableLogCodes = useMemo(
    () => ["all", ...Array.from(new Set(debugLogs.map((entry) => entry.code).filter(Boolean) as string[])).sort()],
    [debugLogs],
  );
  const filteredLogs = debugLogs.filter((entry) => {
    const matchesLevel = logLevels[entry.level];
    const entryPlatform = normalizeLogPlatform(entry);
    const matchesScope = logScopeFilter === "all" || entry.scope === logScopeFilter;
    const matchesPlatform = logPlatformFilter === "all" || entryPlatform === logPlatformFilter;
    const matchesCode = logCodeFilter === "all" || entry.code === logCodeFilter;
    const haystack = [entry.scope, entry.code, entry.message, JSON.stringify(entry.details ?? {})]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !logSearch || haystack.includes(logSearch.toLowerCase());
    return matchesLevel && matchesScope && matchesPlatform && matchesCode && matchesSearch;
  });

  const latestArtifacts = useMemo(() => {
    const sourceIds = new Set(
      artifactIndex.filter((entry) => entry.platform === deepseekPlatform).map((entry) => entry.sourceId),
    );

    return new Map(
      Array.from(sourceIds)
        .map(
          (sourceId) =>
            [
              sourceId,
              findLatestOpenableArtifactForConversation(artifactIndex, deepseekPlatform, sourceId),
            ] as const,
        )
        .filter((entry): entry is readonly [string, ExportArtifactEntry] => Boolean(entry[1])),
    );
  }, [artifactIndex]);

  const openableSourceIds = useMemo(
    () => new Set(latestArtifacts.keys()),
    [latestArtifacts],
  );

  if (!queueState || !debugState || !settingsDraft) {
    return <div style={containerStyle}>{t("common.loading")}</div>;
  }

  const deepseekService = queueState.services.deepseek;
  const platformQueueItems = queueState.items.filter((item) => item.platform === deepseekPlatform);

  const filteredQueueItems = platformQueueItems.filter((item) => {
    const matchesStatus = isStatusFilterMatch(queueStatusFilter, item.status);
    const haystack = [
      item.event.title,
      item.event.sourceId,
      item.lastError,
      item.event.url,
      item.errorCode,
      item.skipReason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !queueSearch || haystack.includes(queueSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleOpenLatest = (sourceId: string) => {
    setActionError(null);
    const artifact = latestArtifacts.get(sourceId);
    if (!artifact || typeof artifact.markdownDownloadId !== "number") {
      setActionError("No local markdown artifact was found for this conversation.");
      return;
    }
    void openLatestArtifact(deepseekPlatform, sourceId).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to open latest markdown.");
    });
  };

  const handleShowFolder = (sourceId: string) => {
    setActionError(null);
    const artifact = latestArtifacts.get(sourceId);
    if (!artifact || typeof artifact.markdownDownloadId !== "number") {
      setActionError("No local markdown artifact was found for this conversation.");
      return;
    }
    void showArtifactFolder(deepseekPlatform, sourceId).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to show export folder.");
    });
  };

  const popupSummary = (
    <div style={{ ...containerStyle, minWidth: 380 }}>
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
              {t("overview.status")}: {deepseekService.status}
            </div>
          </div>
          <ActionButton disabled={busy} style={{ background: "#0f766e" }} onClick={() => void openDashboard()}>
            {t("common.openDashboard")}
          </ActionButton>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>{t("overview.pending")}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{deepseekService.stats.pending}</div>
          </div>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>{t("overview.workers")}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{deepseekService.activeWorkers}</div>
          </div>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>{t("overview.failed")}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{deepseekService.stats.failed}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <ActionButton disabled={busy} onClick={() => void runAction(() => resumePlatform(deepseekPlatform))}>
            {t("common.resume")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#7c2d12" }} onClick={() => void runAction(() => pausePlatform(deepseekPlatform))}>
            {t("common.pause")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#1d4ed8" }} onClick={() => void runAction(() => processQueue())}>
            {t("common.processQueue")}
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
            service={deepseekService}
            t={t}
            onResume={() => void runAction(() => resumePlatform(deepseekPlatform))}
            onPause={() => void runAction(() => pausePlatform(deepseekPlatform))}
            onRunDiscovery={() => void runAction(() => runDiscovery(deepseekPlatform))}
            onRunFullDiscovery={() => void runAction(() => runFullBootstrap(deepseekPlatform))}
            onProcessQueue={() => void runAction(() => processQueue())}
          />
        ) : null}

        {tab === "queue" ? (
          <QueueTab
            busy={busy}
            items={filteredQueueItems}
            search={queueSearch}
            statusFilter={queueStatusFilter}
            t={t}
            openFileActionsEnabled={settingsDraft.downloads.openFileActionsEnabled}
            openableSourceIds={openableSourceIds}
            onSearchChange={setQueueSearch}
            onStatusFilterChange={setQueueStatusFilter}
            onRetryFailed={() => void runAction(() => retryFailed())}
            onClearCompleted={() => void runAction(() => clearQueueStatuses(["completed"], deepseekPlatform))}
            onClearFailed={() => void runAction(() => clearQueueStatuses(["failed", "cancelled", "skipped"], deepseekPlatform))}
            onPausePlatform={() => void runAction(() => pausePlatform(deepseekPlatform))}
            onResumePlatform={() => void runAction(() => resumePlatform(deepseekPlatform))}
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
            logPlatformFilter={logPlatformFilter}
            logCodeFilter={logCodeFilter}
            availableScopes={availableLogScopes}
            availableCodes={availableLogCodes}
            hoveredLogId={hoveredLogId}
            selectedLogId={selectedLogId}
            copiedDetails={copiedDetails}
            t={t}
            onLevelToggle={(level, checked) => setLogLevels((current) => ({ ...current, [level]: checked }))}
            onLogSearchChange={setLogSearch}
            onScopeFilterChange={setLogScopeFilter}
            onPlatformFilterChange={setLogPlatformFilter}
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
            settingsDraft={settingsDraft}
            t={t}
            onLocaleChange={(nextLocale) => void applyLocale(nextLocale)}
            onGlobalSettingChange={setGlobalSetting}
            onSchedulerChange={setSchedulerSetting}
            onDownloadsChange={setDownloadsSetting}
            onDeepSeekChange={setDeepSeekSetting}
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
            onCommitDeepSeek={(patch) => void runAction(() => updatePlatformSettings(deepseekPlatform, patch))}
            onClearDeepSeekRecords={() => void runAction(() => clearPlatformLocalRecords(deepseekPlatform))}
          />
        ) : null}

        <div style={{ color: "#64748b", fontSize: 12 }}>
          {t("overview.lastDiscovery")}: {formatTimestamp(deepseekService.lastDiscoveryAt)} · {t("overview.lastExport")}:{" "}
          {formatTimestamp(deepseekService.lastExportAt)}
        </div>
      </div>
    </div>
  );
}
