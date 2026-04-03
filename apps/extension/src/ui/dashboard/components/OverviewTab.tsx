import type { CSSProperties } from "react";
import type { PlatformServiceState } from "@aiexporter/adapter-sdk";
import type { MessageKey } from "../../i18n/useI18n";
import { ActionButton } from "./ActionButton";

interface OverviewTabProps {
  busy: boolean;
  platformLabel: string;
  service: PlatformServiceState;
  t: (key: MessageKey) => string;
  onResume: () => void;
  onPause: () => void;
  onRunDiscovery: () => void;
  onRunFullDiscovery: () => void;
  onProcessQueue: () => void;
}

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

export function OverviewTab({
  busy,
  platformLabel,
  service,
  t,
  onResume,
  onPause,
  onRunDiscovery,
  onRunFullDiscovery,
  onProcessQueue,
}: OverviewTabProps) {
  const metrics = [
    [t("overview.discovered"), service.stats.discoveredTotal],
    [t("overview.exported"), service.stats.exportedTotal],
    [t("overview.pending"), service.stats.pending],
    [t("overview.processing"), service.stats.processing],
    [t("overview.failed"), service.stats.failed],
    [t("overview.workers"), service.activeWorkers],
  ] as const;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{platformLabel} {t("overview.serviceTitle")}</div>
          <div style={{ marginTop: 8, color: "#4b5563", fontSize: 14 }}>
            {t("overview.status")}: {service.status}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <ActionButton disabled={busy} onClick={onResume}>
            {t("common.resume")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#7c2d12" }} onClick={onPause}>
            {t("common.pause")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#0f766e" }} onClick={onRunDiscovery}>
            {t("common.runDiscovery")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#334155" }} onClick={onRunFullDiscovery}>
            {t("common.runFullDiscovery")}
          </ActionButton>
          <ActionButton disabled={busy} style={{ background: "#1d4ed8" }} onClick={onProcessQueue}>
            {t("common.processQueue")}
          </ActionButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginTop: 18 }}>
        {metrics.map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
            <div style={{ color: "#6b7280", fontSize: 12 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 18, fontSize: 13 }}>
        <div>{t("overview.lastDiscovery")}: {formatTimestamp(service.lastDiscoveryAt)}</div>
        <div>{t("overview.lastExport")}: {formatTimestamp(service.lastExportAt)}</div>
        <div>{t("overview.nextRun")}: {formatTimestamp(service.nextPlannedRunAt)}</div>
        <div>{t("overview.lastError")}: {service.lastError ?? t("common.notAvailable")}</div>
        <div>{t("overview.discoveryMode")}: {service.meta?.lastDiscoveryMode ?? t("common.notAvailable")}</div>
        <div>{t("overview.discoveryQuality")}: {service.meta?.lastDiscoveryQuality ?? t("common.notAvailable")}</div>
        <div>{t("overview.highestHistoricalCount")}: {service.meta?.highestHistoricalCountSeen ?? 0}</div>
      </div>
    </div>
  );
}
