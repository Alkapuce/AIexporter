import { buildDiscoveryFingerprint, type DebugLogLevel, type MainWorldBridgeMessage, type RuntimeMessage } from "@aiexporter/adapter-sdk";
import { extractSessionIdFromUrl } from "@aiexporter/adapters-deepseek";
import { isDeepSeekWorkerPageContext, unwrapRuntimeResponse } from "./browser-context";
import { collectHistoricalPayloads, extractCurrentDeepSeekConversation } from "./history";
import { ensureDeepSeekFloatingButton, setDeepSeekFloatingStatus, summarizeDeepSeekManualExportResult } from "./ui";

declare global {
  interface Window {
    __aiexporterDeepSeekContentRuntimeInstalled?: boolean;
  }
}

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

export interface PassiveDiscoveryMessageCheck {
  isWorkerPage: boolean;
  eventSource: MessageEventSource | null;
  expectedSource: Window;
  data: (MainWorldBridgeMessage & { source?: string }) | null | undefined;
}

export function shouldHandleDeepSeekPassiveDiscovery({
  isWorkerPage,
  eventSource,
  expectedSource,
  data,
}: PassiveDiscoveryMessageCheck): boolean {
  return Boolean(
    !isWorkerPage &&
      eventSource === expectedSource &&
      data?.source === "aiexporter" &&
      data.type === "deepseek-network-discovery" &&
      data.payload,
  );
}

function installUrlChangeMonitor(onChange: (url: string) => void): () => void {
  let lastUrl = window.location.href;
  let disposed = false;
  const notifyIfChanged = () => {
    if (disposed) return;
    const nextUrl = window.location.href;
    if (nextUrl === lastUrl) return;
    lastUrl = nextUrl;
    onChange(nextUrl);
  };

  const historyRef = window.history as History & {
    __aiexporterOriginalPushState?: History["pushState"];
    __aiexporterOriginalReplaceState?: History["replaceState"];
  };

  if (!historyRef.__aiexporterOriginalPushState) {
    historyRef.__aiexporterOriginalPushState = historyRef.pushState.bind(historyRef);
    historyRef.pushState = ((...args: Parameters<History["pushState"]>) => {
      const result = historyRef.__aiexporterOriginalPushState!(...args);
      queueMicrotask(notifyIfChanged);
      return result;
    }) as History["pushState"];
  }

  if (!historyRef.__aiexporterOriginalReplaceState) {
    historyRef.__aiexporterOriginalReplaceState = historyRef.replaceState.bind(historyRef);
    historyRef.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      const result = historyRef.__aiexporterOriginalReplaceState!(...args);
      queueMicrotask(notifyIfChanged);
      return result;
    }) as History["replaceState"];
  }

  const onPopState = () => notifyIfChanged();
  const onHashChange = () => notifyIfChanged();
  const interval = window.setInterval(notifyIfChanged, 15_000);
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);

  return () => {
    disposed = true;
    window.clearInterval(interval);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
  };
}

async function queueCurrentConversation(log: RuntimeLogger): Promise<void> {
  const sourceId = extractSessionIdFromUrl(window.location.href);
  if (!sourceId) return;

  const payload = {
    sourceId,
    url: window.location.href,
    title: document.title.replace(/\s*\|\s*DeepSeek\s*$/i, "").trim() || undefined,
    sourceUpdatedAt: undefined,
  };

  const revisionFingerprint = await buildDiscoveryFingerprint("deepseek", payload);
  await browser.runtime.sendMessage({
    type: "queue-discovery",
    event: {
      platform: "deepseek",
      ...payload,
      revisionFingerprint,
    },
  } satisfies RuntimeMessage);

  await log("debug", "Queued current DeepSeek conversation from user page.", {
    url: window.location.href,
    sourceId,
  });
}

async function handleManualExport(log: RuntimeLogger, button: HTMLButtonElement): Promise<void> {
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
    setDeepSeekFloatingStatus(summarizeDeepSeekManualExportResult(result), "success");
  } catch (error) {
    await log("error", "Manual export failed.", {
      error: error instanceof Error ? error.message : "Manual export failed",
    });
    setDeepSeekFloatingStatus(error instanceof Error ? error.message : "Manual export failed", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Export Chat";
  }
}

export async function mountDeepSeekContentRuntime(log: RuntimeLogger): Promise<void> {
  if (window.__aiexporterDeepSeekContentRuntimeInstalled) {
    await log("debug", "Skipped duplicate DeepSeek content runtime mount.", {
      code: "content.duplicate_mount_skipped",
      url: window.location.href,
    });
    return;
  }
  window.__aiexporterDeepSeekContentRuntimeInstalled = true;

  const discoveryPayloadBuffer = new Map<string, NonNullable<MainWorldBridgeMessage["payload"]>>();

  const button = ensureDeepSeekFloatingButton();
  button.addEventListener("click", () => {
    void handleManualExport(log, button);
  });

  const onWindowMessage = async (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
    if (
      !shouldHandleDeepSeekPassiveDiscovery({
        isWorkerPage: isDeepSeekWorkerPageContext(),
        eventSource: event.source,
        expectedSource: window,
        data: event.data,
      })
    ) {
      return;
    }

    const payload = event.data?.payload;
    if (!payload) return;

    discoveryPayloadBuffer.set(payload.sourceId, payload);

    const revisionFingerprint = await buildDiscoveryFingerprint("deepseek", payload);
    await browser.runtime.sendMessage({
      type: "queue-discovery",
      event: {
        platform: "deepseek",
        ...payload,
        revisionFingerprint,
      },
    } satisfies RuntimeMessage);

    await log("debug", "Queued DeepSeek network discovery payload.", {
      sourceId: payload.sourceId,
    });
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

    if (message.type === "extract-current-conversation") {
      void log("debug", "Received extract-current-conversation request.", {
        url: window.location.href,
      });
      void extractCurrentDeepSeekConversation(log)
        .then((bundle) => {
          void log("info", "Extracted current DeepSeek conversation.", {
            sourceId: bundle.sourceId,
            messageCount: bundle.messages.length,
          });
          sendResponse(bundle);
        })
        .catch((error) => {
          void log("error", "Failed to extract current DeepSeek conversation.", {
            error: error instanceof Error ? error.message : "Failed to extract current conversation",
          });
          sendResponse({
            __aiexporterError: error instanceof Error ? error.message : "Failed to extract current conversation",
          });
        });

      return true;
    }

    if (message.type === "collect-platform-discovery" && message.platform === "deepseek") {
      void log("info", "Received hidden discovery crawl request.", {
        url: window.location.href,
        mode: message.mode,
        readyTimeoutMs: message.readyTimeoutMs,
        stableRounds: message.stableRounds,
      });
      void collectHistoricalPayloads(log, discoveryPayloadBuffer, {
        readyTimeoutMs: message.readyTimeoutMs,
        stableRounds: message.stableRounds,
      })
        .then((payloads) => {
          sendResponse(payloads);
        })
        .catch((error) => {
          sendResponse({
            __aiexporterError: error instanceof Error ? error.message : "Failed to collect discovery payloads",
          });
        });
      return true;
    }

    return undefined;
  });

  if (!isDeepSeekWorkerPageContext()) {
    await queueCurrentConversation(log);
  }

  installUrlChangeMonitor((nextUrl) => {
    if (isDeepSeekWorkerPageContext()) return;
    void log("debug", "Detected DeepSeek URL change.", {
      url: nextUrl,
    });
    void queueCurrentConversation(log);
  });
}
