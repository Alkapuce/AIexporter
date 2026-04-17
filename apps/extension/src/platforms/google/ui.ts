import { startThemeSync } from "../../ui/theme-runtime";

if (typeof document !== "undefined") {
  startThemeSync(document, { styleBody: false });
}

const BUTTON_PREFIX = "aiexporter-google-floating-export";
const STATUS_PREFIX = "aiexporter-google-floating-status";

function buttonId(platform: string): string {
  return `${BUTTON_PREFIX}-${platform}`;
}

function statusId(platform: string): string {
  return `${STATUS_PREFIX}-${platform}`;
}

export function ensureGoogleFloatingButton(platform: string): HTMLButtonElement {
  const existing = document.getElementById(buttonId(platform)) as HTMLButtonElement | null;
  if (existing) return existing;

  const wrapper = document.createElement("div");
  wrapper.id = buttonId(platform);
  wrapper.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "align-items:flex-end",
  ].join(";");

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Export Chat";
  button.style.cssText = [
    "border:none",
    "border-radius:999px",
    "padding:12px 16px",
    "font:600 14px/1.2 system-ui",
    "background:var(--aiexporter-button-primary-background)",
    "color:var(--aiexporter-button-primary-text)",
    "cursor:pointer",
    "box-shadow:0 12px 28px rgba(0,0,0,0.18)",
  ].join(";");

  const status = document.createElement("div");
  status.id = statusId(platform);
  status.style.cssText = [
    "padding:6px 10px",
    "border-radius:999px",
    "background:var(--aiexporter-button-secondary-background)",
    "color:var(--aiexporter-button-secondary-text)",
    "font:500 12px/1.2 system-ui",
    "display:none",
  ].join(";");

  wrapper.append(button, status);
  document.body.appendChild(wrapper);
  return button;
}

export function setGoogleFloatingStatus(
  platform: string,
  text: string,
  tone: "neutral" | "success" | "error" = "neutral",
): void {
  const status = document.getElementById(statusId(platform));
  if (!(status instanceof HTMLDivElement)) return;
  status.textContent = text;
  status.style.display = "block";
  status.style.background =
    tone === "success"
      ? "var(--aiexporter-success-background)"
      : tone === "error"
        ? "var(--aiexporter-danger-background)"
        : "var(--aiexporter-button-secondary-background)";
  status.style.color =
    tone === "success"
      ? "var(--aiexporter-success-text-color)"
      : tone === "error"
        ? "var(--aiexporter-danger-text-color)"
        : "var(--aiexporter-button-secondary-text)";
  window.setTimeout(() => {
    status.style.display = "none";
  }, 2_500);
}

export function summarizeGoogleManualExportResult(result: unknown): string {
  const payload = result as
    | {
        __aiexporterError?: string;
        ok?: boolean;
        revision?: string;
        files?: string[];
        downloadIds?: number[];
      }
    | undefined;

  const files = payload?.files ?? [];
  const fileCount = files.length;
  const ids = payload?.downloadIds?.filter((value): value is number => typeof value === "number") ?? [];
  const shortNames = files.map((file) => file.split(/[/\\]/).pop()).filter(Boolean).slice(0, 2);

  if (fileCount === 0) {
    const summary = JSON.stringify(result ?? null);
    return `Export finished, but no files were reported. Payload: ${summary?.slice(0, 180) ?? "null"}`;
  }

  return `Saved ${fileCount} files${shortNames.length > 0 ? `: ${shortNames.join(", ")}` : ""}${ids.length > 0 ? ` (downloads: ${ids.join(", ")})` : ""}${payload?.revision ? ` rev:${payload.revision.slice(0, 8)}` : ""}`;
}
