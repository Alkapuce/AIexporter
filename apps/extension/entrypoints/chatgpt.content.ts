import { buildDiscoveryFingerprint, type MainWorldBridgeMessage, type RuntimeMessage } from "@aiexporter/adapter-sdk";
import { chatgptAdapter, extractConversationIdFromUrl } from "@aiexporter/adapters-chatgpt";
import { createRuntimeLogger } from "../src/runtime/logger";

const BUTTON_ID = "aiexporter-floating-export";
const STATUS_ID = "aiexporter-floating-status";

function ensureFloatingButton(): HTMLButtonElement {
  const existing = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (existing) return existing;

  const wrapper = document.createElement("div");
  wrapper.id = BUTTON_ID;
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
  status.id = STATUS_ID;
  status.style.cssText = [
    "padding:6px 10px",
    "border-radius:999px",
    "background:rgba(17,24,39,0.85)",
    "color:#fff",
    "font:500 12px/1.2 system-ui",
    "display:none",
  ].join(";");

  wrapper.append(button, status);
  document.body.appendChild(wrapper);
  return button;
}

function setStatus(text: string, tone: "neutral" | "success" | "error" = "neutral"): void {
  const status = document.getElementById(STATUS_ID);
  if (!(status instanceof HTMLDivElement)) return;
  status.textContent = text;
  status.style.display = "block";
  status.style.background =
    tone === "success" ? "rgba(22, 101, 52, 0.9)" : tone === "error" ? "rgba(127, 29, 29, 0.92)" : "rgba(17,24,39,0.85)";
  window.setTimeout(() => {
    status.style.display = "none";
  }, 2500);
}

function summarizeManualExportResult(result: unknown): string {
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

async function queueCurrentConversation(): Promise<void> {
  const sourceId = extractConversationIdFromUrl(window.location.href);
  if (!sourceId) return;

  const payload = {
    sourceId,
    url: window.location.href,
    title: document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim() || undefined,
    sourceUpdatedAt: undefined,
  };

  const revisionFingerprint = await buildDiscoveryFingerprint("chatgpt", payload);
  const message: RuntimeMessage = {
    type: "queue-discovery",
    event: {
      platform: "chatgpt",
      ...payload,
      revisionFingerprint,
    },
  };

  await browser.runtime.sendMessage(message);
}

function unwrapRuntimeResponse<T>(response: T | { __aiexporterError?: string }): T {
  if (response && typeof response === "object" && "__aiexporterError" in response) {
    throw new Error((response as { __aiexporterError?: string }).__aiexporterError ?? "Unknown background error");
  }
  return response as T;
}

export default defineContentScript({
  matches: ["https://chatgpt.com/*"],
  async main() {
    const log = createRuntimeLogger("content.chatgpt");
    await log("info", "ChatGPT content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await injectScript("/chatgpt-main-world.js", {
      keepInDom: true,
    });
    await log("debug", "Injected ChatGPT main-world bridge.");

    const button = ensureFloatingButton();
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Exporting...";
      await log("info", "Manual export button clicked.", {
        url: window.location.href,
      });
      try {
        const result = unwrapRuntimeResponse(
          await browser.runtime.sendMessage({
            type: "manual-export-current",
            url: window.location.href,
          } satisfies RuntimeMessage),
        );
        await log("info", "Manual export completed.", {
          result: result as Record<string, unknown>,
        });
        setStatus(summarizeManualExportResult(result), "success");
      } catch (error) {
        await log("error", "Manual export failed.", {
          error: error instanceof Error ? error.message : "Manual export failed",
        });
        setStatus(error instanceof Error ? error.message : "Manual export failed", "error");
      } finally {
        button.disabled = false;
        button.textContent = "Export Chat";
      }
    });

    const onWindowMessage = async (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "chatgpt-network-discovery") return;
      if (!event.data.payload) return;

      await log("debug", "Received main-world discovery payload.", {
        payload: event.data.payload,
      });
      const revisionFingerprint = await buildDiscoveryFingerprint("chatgpt", event.data.payload);
      unwrapRuntimeResponse(
        await browser.runtime.sendMessage({
          type: "queue-discovery",
          event: {
            platform: "chatgpt",
            ...event.data.payload,
            revisionFingerprint,
          },
        } satisfies RuntimeMessage),
      );
    };

    window.addEventListener("message", onWindowMessage);

    browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      if (message.type === "worker-ready-ping") {
        sendResponse({
          ok: true,
          title: document.title,
          url: window.location.href,
        });
        return undefined;
      }

      if (message.type !== "extract-current-conversation") {
        return undefined;
      }

      void log("debug", "Received extract-current-conversation request.", {
        url: window.location.href,
      });
      void chatgptAdapter
        .extractCurrentConversation({
          document,
          window,
          location,
        })
        .then((bundle) => {
          void log("info", "Extracted current ChatGPT conversation.", {
            sourceId: bundle.sourceId,
            messageCount: bundle.messages.length,
          });
          sendResponse(bundle);
        })
        .catch((error) => {
          void log("error", "Failed to extract current ChatGPT conversation.", {
            error: error instanceof Error ? error.message : "Failed to extract current conversation",
          });
          sendResponse({
            __aiexporterError: error instanceof Error ? error.message : "Failed to extract current conversation",
          });
        });

      return true;
    });

    await queueCurrentConversation();
    await log("debug", "Queued current conversation from initial page load.", {
      url: window.location.href,
    });

    let lastUrl = window.location.href;
    window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        void log("debug", "Detected ChatGPT URL change.", {
          url: lastUrl,
        });
        void queueCurrentConversation();
      }
    }, 1200);
  },
});
