import type { SourcePlatform } from "@aiexporter/core-schema";
import { startThemeSync } from "../../ui/theme-runtime";

if (typeof document !== "undefined") {
  startThemeSync(document, { styleBody: false });
}

interface DiscoveryUiOptions {
  onLogEntry?: (message: string) => void | Promise<void>;
}

export interface DiscoveryUiController {
  report(message: string, details?: Record<string, unknown>): void;
  setMetrics(metrics: Record<string, unknown>): void;
  wait(ms: number, label: string): Promise<void>;
  checkpoint(label: string): Promise<void>;
  takeAdditionalWaitMs(): number;
  takeSkipSignal(): boolean;
}

export function createDiscoveryUiController(
  platform: SourcePlatform,
  siteName: string,
  options: DiscoveryUiOptions = {},
): DiscoveryUiController {
  const panelId = `aiexporter-discovery-panel-${platform}`;
  const existing = document.getElementById(panelId);
  if (existing) {
    existing.remove();
  }

  let paused = false;
  let skipRequested = false;
  let pendingAdditionalWaitMs = 0;
  let skipSignal = false;
  const entries: Array<{ time: string; message: string }> = [];

  const root = document.createElement("div");
  root.id = panelId;
  root.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:2147483647",
    "width:360px",
    "max-height:70vh",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "padding:12px",
    "border-radius:12px",
    "background:var(--aiexporter-log-panel-background)",
    "color:var(--aiexporter-log-panel-text-color)",
    "font:12px/1.4 system-ui, sans-serif",
    "box-shadow:0 12px 32px rgba(0,0,0,0.35)",
    "backdrop-filter:blur(8px)",
  ].join(";");

  const header = document.createElement("div");
  header.textContent = `${siteName} Discovery`;
  header.style.cssText = "font-weight:700;font-size:13px;";

  const status = document.createElement("div");
  status.textContent = "准备中";
  status.style.cssText = "color:var(--aiexporter-log-panel-muted-text-color);";

  const metrics = document.createElement("pre");
  metrics.style.cssText = [
    "margin:0",
    "padding:8px",
    "border-radius:8px",
    "background:var(--aiexporter-surface-raised-background)",
    "white-space:pre-wrap",
    "word-break:break-word",
    "color:var(--aiexporter-info-text-color)",
    "min-height:56px",
  ].join(";");

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";

  const logList = document.createElement("div");
  logList.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:4px",
    "overflow:auto",
    "padding-right:4px",
    "max-height:40vh",
  ].join(";");

  const makeButton = (label: string, onClick: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
      "border:none",
      "border-radius:999px",
      "padding:6px 10px",
      "background:var(--aiexporter-button-primary-background)",
      "color:var(--aiexporter-button-primary-text)",
      "cursor:pointer",
      "font:600 12px/1.2 system-ui, sans-serif",
    ].join(";");
    button.addEventListener("click", onClick);
    return button;
  };

  const renderEntries = () => {
    logList.innerHTML = "";
    for (const entry of entries.slice(-24).reverse()) {
      const row = document.createElement("div");
      row.textContent = `[${entry.time}] ${entry.message}`;
      row.style.cssText = "padding:6px 8px;border-radius:8px;background:var(--aiexporter-surface-muted-background);";
      logList.appendChild(row);
    }
  };

  const appendEntry = (message: string) => {
    entries.push({
      time: new Date().toLocaleTimeString(),
      message,
    });
    status.textContent = message;
    renderEntries();
    void options.onLogEntry?.(message);
  };

  actions.append(
    makeButton("延长5s", () => {
      pendingAdditionalWaitMs += 5_000;
      appendEntry("收到手动延长等待指令 (+5000ms)");
    }),
    makeButton("跳过等待", () => {
      skipRequested = true;
      skipSignal = true;
      appendEntry("收到手动跳过等待指令");
    }),
    makeButton("重试本页", () => {
      appendEntry("收到手动重试指令，正在刷新 discovery 页面");
      window.location.reload();
    }),
    makeButton("继续", () => {
      paused = false;
      appendEntry("继续执行 DOM / 历史抓取");
    }),
    makeButton("暂停", () => {
      paused = true;
      appendEntry("暂停执行，等待手动继续");
    }),
  );

  root.append(header, status, actions, metrics, logList);
  document.body.appendChild(root);

  appendEntry("已挂载 discovery 控制面板");

  return {
    report(message, details) {
      const suffix = details && Object.keys(details).length > 0 ? ` ${JSON.stringify(details, null, 0)}` : "";
      appendEntry(`${message}${suffix}`);
    },
    setMetrics(nextMetrics) {
      metrics.textContent = Object.entries(nextMetrics)
        .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("\n");
    },
    async wait(ms, label) {
      appendEntry(`等待 ${label} (${ms}ms)`);
      const startedAt = Date.now();
      while (Date.now() - startedAt < ms) {
        if (skipRequested) {
          skipRequested = false;
          appendEntry(`手动跳过等待：${label}`);
          return;
        }
        while (paused) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      appendEntry(`等待结束：${label}`);
    },
    async checkpoint(label) {
      while (paused) {
        status.textContent = `暂停中: ${label}`;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    },
    takeAdditionalWaitMs() {
      const extraMs = pendingAdditionalWaitMs;
      pendingAdditionalWaitMs = 0;
      return extraMs;
    },
    takeSkipSignal() {
      const next = skipSignal;
      skipSignal = false;
      return next;
    },
  };
}
