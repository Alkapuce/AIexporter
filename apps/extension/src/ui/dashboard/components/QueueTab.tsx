import type { CSSProperties } from "react";
import type { ConversationIndexEntry, ExportArtifactEntry, ExportQueueItem, QueueItemStatus } from "@aiexporter/adapter-sdk";
import type { MessageKey } from "../../i18n/useI18n";
import type { DashboardQueueSortKey, DashboardSortDirection } from "../controllers";
import { ActionButton } from "./ActionButton";

interface QueueTabProps {
  busy: boolean;
  items: ExportQueueItem[];
  conversationIndexMap: Map<string, ConversationIndexEntry>;
  latestArtifacts: Map<string, ExportArtifactEntry>;
  search: string;
  statusFilter: string;
  sortKey: DashboardQueueSortKey;
  sortDirection: DashboardSortDirection;
  t: (key: MessageKey) => string;
  openFileActionsEnabled: boolean;
  openableSourceIds: Set<string>;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onSortKeyChange: (value: DashboardQueueSortKey) => void;
  onSortDirectionChange: (value: DashboardSortDirection) => void;
  onRetryFailed: () => void;
  onReExportMissingLocal: () => void;
  onClearCompleted: () => void;
  onClearFailed: () => void;
  missingLocalCount: number;
  onPausePlatform: () => void;
  onResumePlatform: () => void;
  onOpenSource: (url: string) => void;
  onRetryItem: (key: string) => void;
  onCancelItem: (key: string) => void;
  onRemoveItem: (key: string) => void;
  onForceExport: (key: string) => void;
  onDiscoverExport: (key: string) => void;
  onOpenLatest: (sourceId: string) => void;
  onShowFolder: (sourceId: string) => void;
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
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

function formatTimestamp(value: string | undefined): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

function formatWebsiteTime(entry: ConversationIndexEntry | undefined): string {
  if (!entry) return "N/A";
  if (entry.latestSourceUpdatedAt) return formatTimestamp(entry.latestSourceUpdatedAt);
  return entry.latestSourceUpdatedLabel ?? "N/A";
}

function getQueueStatusLabel(status: QueueItemStatus, t: (key: MessageKey) => string): string {
  const key = `queue.status.${status}` as MessageKey;
  return t(key);
}

export function QueueTab({
  busy,
  items,
  conversationIndexMap,
  latestArtifacts,
  search,
  statusFilter,
  sortKey,
  sortDirection,
  t,
  openFileActionsEnabled,
  openableSourceIds,
  onSearchChange,
  onStatusFilterChange,
  onSortKeyChange,
  onSortDirectionChange,
  onRetryFailed,
  onReExportMissingLocal,
  onClearCompleted,
  onClearFailed,
  missingLocalCount,
  onPausePlatform,
  onResumePlatform,
  onOpenSource,
  onRetryItem,
  onCancelItem,
  onRemoveItem,
  onForceExport,
  onDiscoverExport,
  onOpenLatest,
  onShowFolder,
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: QueueTabProps) {
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = totalItems === 0 ? 0 : Math.min(totalItems, page * pageSize);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{t("queue.title")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton disabled={busy} onClick={onRetryFailed}>
            {t("queue.retryFailed")}
          </ActionButton>
          <ActionButton
            disabled={busy || missingLocalCount === 0}
            style={{ background: "var(--aiexporter-button-primary-background)" }}
            onClick={onReExportMissingLocal}
          >
            {t("queue.reExportMissingLocal")} ({missingLocalCount})
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "var(--aiexporter-button-secondary-background)" }} onClick={onClearCompleted}>
            {t("queue.clearCompleted")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "var(--aiexporter-button-danger-background)" }} onClick={onClearFailed}>
            {t("queue.clearFailed")}
          </ActionButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr 0.8fr 0.8fr 0.8fr 0.8fr", gap: 10, marginBottom: 12 }}>
        <input style={inputStyle} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t("queue.search")} />
        <select style={inputStyle} value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="all">{t("queue.allStatuses")}</option>
          <option value="pending">{t("queue.status.pending")}</option>
          <option value="processing">{t("queue.status.processing")}</option>
          <option value="failed">{t("queue.status.failed")}</option>
          <option value="completed">{t("queue.status.completed")}</option>
          <option value="skipped">{t("queue.status.skipped")}</option>
          <option value="cancelled">{t("queue.status.cancelled")}</option>
        </select>
        <select style={inputStyle} value={sortKey} onChange={(event) => onSortKeyChange(event.target.value as DashboardQueueSortKey)}>
          <option value="updatedAt">{t("queue.sort.updatedAt")}</option>
          <option value="discoveredAt">{t("queue.sort.discoveredAt")}</option>
          <option value="websiteTime">{t("queue.sort.websiteTime")}</option>
          <option value="lastSeenAt">{t("queue.sort.lastSeenAt")}</option>
          <option value="lastExportAt">{t("queue.sort.lastExportAt")}</option>
          <option value="title">{t("queue.sort.title")}</option>
          <option value="sourceId">{t("queue.sort.sourceId")}</option>
          <option value="status">{t("queue.sort.status")}</option>
          <option value="priority">{t("queue.sort.priority")}</option>
          <option value="attempts">{t("queue.sort.attempts")}</option>
        </select>
        <select style={inputStyle} value={sortDirection} onChange={(event) => onSortDirectionChange(event.target.value as DashboardSortDirection)}>
          <option value="desc">{t("queue.sort.desc")}</option>
          <option value="asc">{t("queue.sort.asc")}</option>
        </select>
        <ActionButton disabled={busy} style={{ background: "var(--aiexporter-button-accent-background)" }} onClick={onPausePlatform}>
          {t("queue.pausePlatform")}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onResumePlatform}>
          {t("queue.resumePlatform")}
        </ActionButton>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
          {t("queue.pagination.summary")}: {pageStart}-{pageEnd} / {totalItems}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--aiexporter-text-muted-color)", fontSize: 12 }}>
            <span>{t("queue.pagination.pageSize")}</span>
            <select style={{ ...inputStyle, width: 96 }} value={String(pageSize)} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
              {[50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <ActionButton disabled={busy || page <= 1} style={{ background: "var(--aiexporter-button-secondary-background)" }} onClick={() => onPageChange(page - 1)}>
            {t("queue.pagination.prev")}
          </ActionButton>
          <div style={{ color: "var(--aiexporter-text-color)", fontSize: 12, fontWeight: 600 }}>
            {t("queue.pagination.page")}: {page} / {Math.max(1, totalPages)}
          </div>
          <ActionButton disabled={busy || page >= totalPages} style={{ background: "var(--aiexporter-button-secondary-background)" }} onClick={() => onPageChange(page + 1)}>
            {t("queue.pagination.next")}
          </ActionButton>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {items.length === 0 ? (
          <div style={{ color: "var(--aiexporter-text-muted-color)" }}>{t("queue.empty")}</div>
        ) : (
          items.map((item) => {
            const conversationEntry = conversationIndexMap.get(item.event.sourceId);
            const latestArtifact = latestArtifacts.get(item.event.sourceId);
            const canOpenArtifacts = openFileActionsEnabled && openableSourceIds.has(item.event.sourceId);
            return (
              <div
                key={item.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px, 2.2fr) 0.9fr 0.9fr 0.8fr 1fr auto",
                  gap: 10,
                  alignItems: "start",
                  borderBottom: "1px solid var(--aiexporter-border-color)",
                  padding: "10px 0",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{item.event.title ?? t("queue.titleFallback")}</div>
                  <div style={{ color: "var(--aiexporter-text-soft-color)", fontSize: 11 }}>{item.event.sourceId}</div>
                  <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 11 }}>{t("queue.websiteTime")}: {formatWebsiteTime(conversationEntry)}</div>
                  <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 11 }}>{t("queue.lastSeenAt")}: {formatTimestamp(conversationEntry?.lastSeenAt)}</div>
                  <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 11 }}>{t("queue.lastExportAt")}: {formatTimestamp(latestArtifact?.exportedAt)}</div>
                  <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 11 }}>{t("queue.discoveredAt")}: {formatTimestamp(item.discoveredAt)}</div>
                  {item.resultRevision ? <div style={{ color: "var(--aiexporter-text-muted-color)", fontSize: 11 }}>{t("queue.resultRevision")}: {item.resultRevision.slice(0, 12)}</div> : null}
                  {item.skipReason === "latest_exists" ? (
                    <div style={{ color: "var(--aiexporter-button-accent-background)", fontSize: 11 }}>{t("queue.skipReason.latest_exists")}</div>
                  ) : null}
                  {item.errorCode ? <div style={{ color: "var(--aiexporter-danger-text-color)", fontSize: 11 }}>{t("queue.errorCode")}: {item.errorCode}</div> : null}
                  {item.lastError ? <div style={{ color: "var(--aiexporter-danger-text-color)", fontSize: 11 }}>{item.lastError}</div> : null}
                </div>
                <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  <div>{t("queue.priority")}: {item.priority}</div>
                  <div>{t("queue.attempts")}: {item.attempts}</div>
                </div>
                <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  <div>{t("overview.status")}: {getQueueStatusLabel(item.status, t)}</div>
                  <div>{t("queue.updatedAt")}: {formatTimestamp(item.updatedAt)}</div>
                </div>
                <div style={{ fontSize: 12 }}>{conversationEntry?.latestSourceUpdatedLabel ?? t("common.notAvailable")}</div>
                <div style={{ fontSize: 12 }}>{formatTimestamp(latestArtifact?.exportedAt)}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <ActionButton style={{ background: "var(--aiexporter-button-primary-background)" }} disabled={busy} onClick={() => onOpenSource(item.event.url)}>
                    {t("common.openSource")}
                  </ActionButton>
                  {canOpenArtifacts ? (
                    <>
                      <ActionButton
                        style={{ background: "var(--aiexporter-button-accent-background)" }}
                        onClick={() => onOpenLatest(item.event.sourceId)}
                      >
                        {t("common.openLatestMarkdown")}
                      </ActionButton>
                      <ActionButton
                        style={{ background: "var(--aiexporter-button-secondary-background)" }}
                        onClick={() => onShowFolder(item.event.sourceId)}
                      >
                        {t("common.showExportFolder")}
                      </ActionButton>
                    </>
                  ) : (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                      background: "var(--aiexporter-chip-background)",
                      color: "var(--aiexporter-chip-text-color)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                    >
                      {t("queue.noLocalFile")}
                    </div>
                  )}
                  <ActionButton
                    disabled={busy || item.status === "processing"}
                    style={{ background: "var(--aiexporter-button-primary-background)" }}
                    onClick={() => onForceExport(item.key)}
                  >
                    {t("common.reExport")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy || item.status === "processing"}
                    style={{ background: "var(--aiexporter-button-accent-background)" }}
                    onClick={() => onDiscoverExport(item.key)}
                  >
                    {t("common.discoverExport")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy || item.status !== "failed"}
                    style={{ background: "var(--aiexporter-button-accent-background)" }}
                    onClick={() => onRetryItem(item.key)}
                  >
                    {t("common.retry")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy || item.status === "processing"}
                    style={{ background: "var(--aiexporter-button-danger-background)" }}
                    onClick={() => onCancelItem(item.key)}
                  >
                    {t("common.cancel")}
                  </ActionButton>
                  <ActionButton
                    disabled={busy || item.status === "processing"}
                    style={{ background: "var(--aiexporter-button-secondary-background)" }}
                    onClick={() => onRemoveItem(item.key)}
                  >
                    {t("common.remove")}
                  </ActionButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
