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
    "background:#111827",
    "color:#fff",
    "cursor:pointer",
    "box-shadow:0 12px 28px rgba(0,0,0,0.18)",
  ].join(";");

  const status = document.createElement("div");
  status.id = statusId(platform);
  status.style.cssText = [
    "padding:6px 10px",
    "border-radius:999px",
    "background:rgba(17,24,39,0.88)",
    "color:#fff",
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
    tone === "success" ? "rgba(22, 101, 52, 0.9)" : tone === "error" ? "rgba(127, 29, 29, 0.92)" : "rgba(17,24,39,0.88)";
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
