import type { CSSProperties } from "react";
import type { DebugLogEntry, DebugLogLevel } from "@aiexporter/adapter-sdk";
import type { SourcePlatform } from "@aiexporter/core-schema";
import type { MessageKey } from "../../i18n/useI18n";
import { ActionButton } from "./ActionButton";

interface LogsTabProps {
  busy: boolean;
  logs: DebugLogEntry[];
  relatedLogs: DebugLogEntry[];
  logLevels: Record<DebugLogLevel, boolean>;
  logSearch: string;
  logScopeFilter: string;
  logCodeFilter: string;
  platformLabel: string;
  availableScopes: string[];
  availableCodes: string[];
  hoveredLogId: string | null;
  selectedLogId: string | null;
  copiedDetails: boolean;
  t: (key: MessageKey) => string;
  onLevelToggle: (level: DebugLogLevel, checked: boolean) => void;
  onLogSearchChange: (value: string) => void;
  onScopeFilterChange: (value: string) => void;
  onCodeFilterChange: (value: string) => void;
  onRefresh: () => void;
  onExportLogs: () => void;
  onClearLogs: () => void;
  onHoverLog: (id: string | null) => void;
  onSelectLog: (id: string | null) => void;
  onCopyDetails: () => void;
  onCopyEntry: () => void;
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

function getLevelColor(level: DebugLogLevel): string {
  if (level === "error") return "var(--aiexporter-danger-text-color)";
  if (level === "warn") return "var(--aiexporter-warning-text-color)";
  if (level === "info") return "var(--aiexporter-info-text-color)";
  return "var(--aiexporter-text-muted-color)";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function LogsTab({
  busy,
  logs,
  relatedLogs,
  logLevels,
  logSearch,
  logScopeFilter,
  logCodeFilter,
  platformLabel,
  availableScopes,
  availableCodes,
  hoveredLogId,
  selectedLogId,
  copiedDetails,
  t,
  onLevelToggle,
  onLogSearchChange,
  onScopeFilterChange,
  onCodeFilterChange,
  onRefresh,
  onExportLogs,
  onClearLogs,
  onHoverLog,
  onSelectLog,
  onCopyDetails,
  onCopyEntry,
}: LogsTabProps) {
  const detailLogEntry =
    logs.find((entry) => entry.id === selectedLogId) ?? logs.find((entry) => entry.id === hoveredLogId) ?? null;

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>{t("logs.title")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["debug", "info", "warn", "error"] as DebugLogLevel[]).map((level) => (
            <label key={level} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={logLevels[level]}
                onChange={(event) => onLevelToggle(level, event.target.checked)}
              />
              {level}
            </label>
          ))}
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-accent-background)" }}
            onClick={onRefresh}
          >
            {t("common.refresh")}
          </ActionButton>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-primary-background)" }}
            onClick={onExportLogs}
          >
            {t("logs.export")}
          </ActionButton>
          <ActionButton
            disabled={busy}
            style={{ background: "var(--aiexporter-button-danger-background)" }}
            onClick={onClearLogs}
          >
            {t("logs.clear")}
          </ActionButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.8fr 0.8fr", gap: 10, marginBottom: 12 }}>
        <input
          style={inputStyle}
          value={logSearch}
          onChange={(event) => onLogSearchChange(event.target.value)}
          placeholder={t("logs.search")}
        />
        <div
          style={{
            ...inputStyle,
            display: "flex",
            alignItems: "center",
            background: "var(--aiexporter-input-muted-background)",
            color: "var(--aiexporter-text-muted-color)",
            fontWeight: 600,
          }}
        >
          {platformLabel}
        </div>
        <select style={inputStyle} value={logScopeFilter} onChange={(event) => onScopeFilterChange(event.target.value)}>
          {availableScopes.map((scope) => (
            <option key={scope} value={scope}>
              {scope === "all" ? t("logs.allScopes") : scope}
            </option>
          ))}
        </select>
        <select style={inputStyle} value={logCodeFilter} onChange={(event) => onCodeFilterChange(event.target.value)}>
          {availableCodes.map((code) => (
            <option key={code} value={code}>
              {code === "all" ? t("logs.allCodes") : code}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.6fr)", gap: 12 }}>
        <div style={{ display: "grid", gap: 4, maxHeight: 520, overflowY: "auto" }}>
          {logs.length === 0 ? (
            <div style={{ color: "var(--aiexporter-text-muted-color)" }}>{t("logs.empty")}</div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                onMouseEnter={() => {
                  if (!selectedLogId) onHoverLog(entry.id);
                }}
                onMouseLeave={() => {
                  if (!selectedLogId) onHoverLog(null);
                }}
                onClick={() => onSelectLog(selectedLogId === entry.id ? null : entry.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px 60px 170px 120px 1fr",
                  gap: 10,
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 10,
                  background:
                    selectedLogId === entry.id
                      ? "var(--aiexporter-highlight-background)"
                      : hoveredLogId === entry.id
                        ? "var(--aiexporter-surface-raised-background)"
                        : "var(--aiexporter-surface-muted-background)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <span style={{ color: "var(--aiexporter-text-soft-color)" }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ color: getLevelColor(entry.level), fontWeight: 700, textTransform: "uppercase" }}>
                  {entry.level}
                </span>
                <span
                  style={{
                    color: "var(--aiexporter-text-muted-color)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.scope}
                </span>
                <span
                  style={{
                    color: "var(--aiexporter-text-muted-color)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.code ?? "-"}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            border: "1px solid var(--aiexporter-log-panel-border-color)",
            borderRadius: 12,
            background: "var(--aiexporter-log-panel-background)",
            color: "var(--aiexporter-log-panel-text-color)",
            padding: 12,
            minHeight: 220,
            maxHeight: 520,
            overflow: "auto",
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>{t("logs.detailsTitle")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ActionButton
                disabled={!detailLogEntry}
                style={{ background: "var(--aiexporter-button-primary-background)", padding: "6px 10px", fontSize: 12 }}
                onClick={onCopyDetails}
              >
                {copiedDetails ? t("common.copied") : t("common.copyJson")}
              </ActionButton>
              <ActionButton
                disabled={!detailLogEntry}
                style={{ background: "var(--aiexporter-button-accent-background)", padding: "6px 10px", fontSize: 12 }}
                onClick={onCopyEntry}
              >
                {t("logs.copyEntry")}
              </ActionButton>
              <ActionButton
                disabled={!selectedLogId}
                style={{
                  background: "var(--aiexporter-button-secondary-background)",
                  padding: "6px 10px",
                  fontSize: 12,
                }}
                onClick={() => onSelectLog(null)}
              >
                {t("logs.clearSelection")}
              </ActionButton>
            </div>
          </div>
          {detailLogEntry ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--aiexporter-log-panel-muted-text-color)" }}>
                {formatTimestamp(detailLogEntry.timestamp)} · {detailLogEntry.scope} · {detailLogEntry.code ?? "-"}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  fontSize: 11,
                  color: "var(--aiexporter-log-panel-muted-text-color)",
                }}
              >
                {detailLogEntry.sourceId ? <span>sourceId: {detailLogEntry.sourceId}</span> : null}
                {detailLogEntry.traceId ? <span>traceId: {detailLogEntry.traceId}</span> : null}
                {detailLogEntry.workerId ? <span>workerId: {detailLogEntry.workerId}</span> : null}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{detailLogEntry.message}</div>
              {relatedLogs.length > 1 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--aiexporter-log-panel-text-color)" }}>
                    Related Timeline ({relatedLogs.length})
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      border: "1px solid var(--aiexporter-log-panel-border-color)",
                      borderRadius: 10,
                      padding: 8,
                      background: "rgba(15, 23, 42, 0.35)",
                    }}
                  >
                    {relatedLogs.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "76px 48px 1fr",
                          gap: 8,
                          fontSize: 11,
                          color:
                            entry.id === detailLogEntry.id
                              ? "var(--aiexporter-log-panel-text-color)"
                              : "var(--aiexporter-log-panel-muted-text-color)",
                          opacity: entry.id === detailLogEntry.id ? 1 : 0.9,
                        }}
                      >
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        <span style={{ textTransform: "uppercase", color: getLevelColor(entry.level) }}>
                          {entry.level}
                        </span>
                        <span>
                          [{entry.scope}] {entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <pre
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  userSelect: "text",
                }}
              >
                {JSON.stringify(detailLogEntry, null, 2)}
              </pre>
            </div>
          ) : (
            <div style={{ color: "var(--aiexporter-log-panel-muted-text-color)", fontSize: 12 }}>
              {t("logs.detailsHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
