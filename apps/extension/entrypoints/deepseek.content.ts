import {
  buildDiscoveryFingerprint,
  type BridgeNetworkPayload,
  type MainWorldBridgeMessage,
  type RuntimeMessage,
} from "@aiexporter/adapter-sdk";
import {
  deepseekAdapter,
  extractConversationFromDom,
  extractDiscoveryPayloadsFromResponse,
  extractDiscoveryPayloadsFromDocument,
  extractSessionIdFromUrl,
  parseHistoryResponse,
} from "@aiexporter/adapters-deepseek";
import type { DeepSeekHistoryResponse } from "@aiexporter/adapters-deepseek";
import { createRuntimeLogger } from "../src/runtime/logger";

const BUTTON_ID = "aiexporter-deepseek-floating-export";
const STATUS_ID = "aiexporter-deepseek-floating-status";
const DISCOVERY_LINK_SELECTOR = 'a[href*="/a/chat/s/"]';
const DISCOVERY_LINK_POLL_MS = 250;
const DISCOVERY_LINK_WAIT_TIMEOUT_MS = 12_000;
const SIDEBAR_SCROLL_STEP_RATIO = 0.72;
const SIDEBAR_SCROLL_SETTLE_MS = 1_100;
const SIDEBAR_SCROLL_MAX_STEPS = 220;
const PAGE_WORLD_FETCH_TIMEOUT_MS = 15_000;
const CONVERSATION_READY_TIMEOUT_MS = 12_000;
const CONVERSATION_POLL_MS = 300;
const MESSAGE_SCROLL_STEP_RATIO = 0.9;
const MESSAGE_SCROLL_SETTLE_MS = 500;
const MESSAGE_SCROLL_MAX_STEPS = 60;
const MESSAGE_SCROLL_STABLE_ROUNDS = 2;
const discoveryPayloadBuffer = new Map<string, BridgeNetworkPayload>();
const DISCOVERY_API_PAGE_LIMIT = 10;

function getStoredValue<T = string>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as { value?: T } | T;
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value;
    }
    return parsed as T;
  } catch {
    return raw as T;
  }
}

function buildDeepSeekApiHeaders(): Record<string, string> {
  const token = getStoredValue<string>("userToken");
  const localePreference = getStoredValue<string>("__appKit_@deepseek/chat_localePreference");
  const locale =
    localePreference && localePreference !== "system"
      ? localePreference.replace("-", "_")
      : navigator.language.replace("-", "_");

  return {
    Accept: "*/*",
    Authorization: token ? `Bearer ${token}` : "",
    "x-client-locale": locale || "en_US",
    "x-client-platform": "web",
    "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
    "x-client-version": "1.7.1",
    "x-app-version": "20241129.1",
  };
}

function isWorkerPageContext(): boolean {
  return new URLSearchParams(window.location.search).get("aiexporter_worker") === "1";
}

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
    "background:#0f172a",
    "color:#fff",
    "cursor:pointer",
    "box-shadow:0 12px 28px rgba(0,0,0,0.18)",
  ].join(";");

  const status = document.createElement("div");
  status.id = STATUS_ID;
  status.style.cssText = [
    "padding:6px 10px",
    "border-radius:999px",
    "background:rgba(15,23,42,0.88)",
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
    tone === "success" ? "rgba(22, 101, 52, 0.9)" : tone === "error" ? "rgba(127, 29, 29, 0.92)" : "rgba(15,23,42,0.88)";
  window.setTimeout(() => {
    status.style.display = "none";
  }, 2_500);
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

function unwrapRuntimeResponse<T>(response: T | { __aiexporterError?: string }): T {
  if (response && typeof response === "object" && "__aiexporterError" in response) {
    throw new Error((response as { __aiexporterError?: string }).__aiexporterError ?? "Unknown background error");
  }
  return response as T;
}

function getConversationScrollContainer(): HTMLElement | null {
  const candidates = [
    document.querySelector<HTMLElement>("main"),
    ...Array.from(document.querySelectorAll<HTMLElement>("main *")),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const style = window.getComputedStyle(candidate);
    if (
      candidate.scrollHeight > candidate.clientHeight + 300 &&
      (style.overflowY === "auto" || style.overflowY === "scroll")
    ) {
      return candidate;
    }
  }

  return null;
}

async function waitForConversationViewportReady(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CONVERSATION_READY_TIMEOUT_MS) {
    const sourceId = extractSessionIdFromUrl(window.location.href);
    const domConversation = extractConversationFromDom(document);
    if (sourceId && domConversation.messages.length > 0) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, CONVERSATION_POLL_MS));
  }
}

async function hydrateConversationDomIfNeeded(log: ReturnType<typeof createRuntimeLogger>): Promise<void> {
  const container = getConversationScrollContainer();
  if (!container) {
    await log("warn", "Unable to locate DeepSeek conversation scroll container for DOM hydration.", {
      code: "extract.dom_scroll_container_missing",
      url: window.location.href,
    });
    return;
  }

  let stableRounds = 0;
  let lastCount = extractConversationFromDom(document).messages.length;

  for (let step = 0; step < MESSAGE_SCROLL_MAX_STEPS; step += 1) {
    const nextScrollTop = Math.max(0, container.scrollTop - container.clientHeight * MESSAGE_SCROLL_STEP_RATIO);
    if (nextScrollTop !== container.scrollTop) {
      container.scrollTop = nextScrollTop;
      await new Promise((resolve) => window.setTimeout(resolve, MESSAGE_SCROLL_SETTLE_MS));
    }

    const currentCount = extractConversationFromDom(document).messages.length;
    stableRounds = currentCount === lastCount ? stableRounds + 1 : 0;
    lastCount = currentCount;
    if (container.scrollTop <= 4 && stableRounds >= MESSAGE_SCROLL_STABLE_ROUNDS) {
      break;
    }
  }

  await log("debug", "Hydrated DeepSeek conversation DOM before fallback extraction.", {
    code: "extract.dom_hydrated",
    url: window.location.href,
    messageCount: extractConversationFromDom(document).messages.length,
  });
}

async function fetchDeepSeekConversationViaPageWorld(
  sourceId: string,
  log: ReturnType<typeof createRuntimeLogger>,
  timeoutMs = PAGE_WORLD_FETCH_TIMEOUT_MS,
): Promise<DeepSeekHistoryResponse> {
  const requestId = crypto.randomUUID();

  return new Promise<DeepSeekHistoryResponse>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("DeepSeek page-world history fetch timed out."));
    }, timeoutMs);

    const listener = (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "deepseek-page-api-response") return;
      if (event.data.requestId !== requestId || event.data.sourceId !== sourceId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", listener);

      if (!event.data.response) {
        reject(new Error("DeepSeek page-world bridge returned an empty response."));
        return;
      }

      if (!event.data.response.ok) {
        reject(new Error(event.data.response.error));
        return;
      }

      resolve(event.data.response.data as DeepSeekHistoryResponse);
    };

    window.addEventListener("message", listener);
    window.postMessage(
      {
        source: "aiexporter",
        type: "aiexporter.deepseek.fetch-history",
        requestId,
        sourceId,
      },
      window.location.origin,
    );

    void log("debug", "Requested DeepSeek history via page-world bridge.", {
      code: "extract.page_world_request_started",
      sourceId,
      requestId,
      url: window.location.href,
    });
  });
}

async function extractCurrentDeepSeekConversation(
  log: ReturnType<typeof createRuntimeLogger>,
) {
  const sourceId = extractSessionIdFromUrl(window.location.href);
  if (!sourceId) {
    throw new Error("Current page is not a DeepSeek conversation URL.");
  }

  try {
    const payload = await fetchDeepSeekConversationViaPageWorld(sourceId, log);
    const bundle = parseHistoryResponse(payload, window.location.href, sourceId);
    await log("info", "Extracted current DeepSeek conversation via page-world API.", {
      code: "extract.page_world_success",
      sourceId,
      messageCount: bundle.messages.length,
      url: window.location.href,
    });
    return bundle;
  } catch (error) {
    await log("warn", "DeepSeek page-world API extraction failed, falling back to DOM.", {
      code: "extract.api_failed",
      sourceId,
      url: window.location.href,
      error: error instanceof Error ? error.message : "DeepSeek page-world API extraction failed",
    });
  }

  await waitForConversationViewportReady();
  await hydrateConversationDomIfNeeded(log);
  const bundle = await deepseekAdapter.extractCurrentConversation({
    document,
    window,
    location,
  });
  await log("warn", "Extracted current DeepSeek conversation via DOM fallback.", {
    code: "extract.dom_fallback_used",
    sourceId,
    messageCount: bundle.messages.length,
    url: window.location.href,
  });
  return bundle;
}

async function queueCurrentConversation(log: ReturnType<typeof createRuntimeLogger>): Promise<void> {
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

function getSidebarScrollContainer(): HTMLElement | null {
  const directMatch = document.querySelector<HTMLElement>("div._6d215eb.ds-scroll-area");
  if (directMatch) return directMatch;

  const firstConversationLink = document.querySelector<HTMLAnchorElement>(DISCOVERY_LINK_SELECTOR);
  if (!firstConversationLink) return null;

  let current: HTMLElement | null = firstConversationLink.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (current.scrollHeight > current.clientHeight + 200 && (style.overflowY === "auto" || style.overflowY === "scroll")) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

async function waitForDiscoverySidebarReady(
  log: ReturnType<typeof createRuntimeLogger>,
  timeoutMs = DISCOVERY_LINK_WAIT_TIMEOUT_MS,
): Promise<{ container: HTMLElement | null; hrefCount: number }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const container = getSidebarScrollContainer();
    const hrefCount = document.querySelectorAll(DISCOVERY_LINK_SELECTOR).length;
    if (container && hrefCount > 0) {
      return { container, hrefCount };
    }
    await new Promise((resolve) => window.setTimeout(resolve, DISCOVERY_LINK_POLL_MS));
  }

  const fallbackContainer = getSidebarScrollContainer();
  const fallbackCount = document.querySelectorAll(DISCOVERY_LINK_SELECTOR).length;
  await log("warn", "DeepSeek discovery sidebar was not ready before timeout.", {
    hrefCount: fallbackCount,
    title: document.title,
    url: window.location.href,
  });
  return {
    container: fallbackContainer,
    hrefCount: fallbackCount,
  };
}

async function collectHistoricalPayloadsViaApi(
  log: ReturnType<typeof createRuntimeLogger>,
): Promise<BridgeNetworkPayload[]> {
  const collected = new Map<string, BridgeNetworkPayload>();
  let cursorUpdatedAt: string | number | null = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore && pageCount < DISCOVERY_API_PAGE_LIMIT) {
    const query =
      cursorUpdatedAt === null
        ? "/api/v0/chat_session/fetch_page?lte_cursor.pinned=false"
        : `/api/v0/chat_session/fetch_page?lte_cursor.pinned=false&lte_cursor.updated_at=${encodeURIComponent(String(cursorUpdatedAt))}`;

    const response = await fetch(query, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: buildDeepSeekApiHeaders(),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek discovery API responded with ${response.status}.`);
    }

    const payload = (await response.json()) as DeepSeekHistoryResponse & {
      data?: {
        biz_data?: {
          chat_sessions?: Array<{
            id?: string;
            updated_at?: string | number;
          }>;
          has_more?: boolean;
        };
      };
    };

    extractDiscoveryPayloadsFromResponse(payload).forEach((item) => {
      collected.set(item.sourceId, item);
    });

    const sessions = payload.data?.biz_data?.chat_sessions ?? [];
    hasMore = Boolean(payload.data?.biz_data?.has_more);
    cursorUpdatedAt = sessions.length > 0 ? sessions[sessions.length - 1]?.updated_at ?? null : null;
    pageCount += 1;

    if (!hasMore || cursorUpdatedAt === null) {
      break;
    }
  }

  await log("info", "Collected DeepSeek historical conversations via fetch_page API.", {
    pageCount,
    collected: collected.size,
  });

  return Array.from(collected.values());
}

async function collectHistoricalPayloads(
  log: ReturnType<typeof createRuntimeLogger>,
  options: { readyTimeoutMs?: number; stableRounds?: number } = {},
): Promise<BridgeNetworkPayload[]> {
  try {
    const apiPayloads = await collectHistoricalPayloadsViaApi(log);
    if (apiPayloads.length > 0) {
      apiPayloads.forEach((payload) => {
        discoveryPayloadBuffer.set(payload.sourceId, payload);
      });
    }
  } catch (error) {
    await log("warn", "DeepSeek discovery API pagination failed, falling back to sidebar crawl.", {
      error: error instanceof Error ? error.message : "DeepSeek discovery API pagination failed",
    });
  }

  const { container, hrefCount } = await waitForDiscoverySidebarReady(log, options.readyTimeoutMs);
  if (!container) {
    const buffered = Array.from(discoveryPayloadBuffer.values());
    if (buffered.length > 0) {
      return buffered;
    }
    throw new Error("Unable to locate DeepSeek sidebar scroll container.");
  }

  const originalScrollTop = container.scrollTop;
  const collected = new Map<string, BridgeNetworkPayload>();
  let stableRounds = 0;
  let lastCount = 0;
  let lastScrollHeight = container.scrollHeight;
  const stableRoundTarget = Math.max(4, options.stableRounds ?? 2);

  const collectVisiblePayloads = () => {
    discoveryPayloadBuffer.forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
    extractDiscoveryPayloadsFromDocument(document, window.location.origin).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
  };

  await log("debug", "Starting hidden DeepSeek discovery crawl.", {
    initialHrefCount: hrefCount,
    scrollHeight: container.scrollHeight,
    title: document.title,
  });
  collectVisiblePayloads();

  for (let step = 0; step < SIDEBAR_SCROLL_MAX_STEPS; step += 1) {
    const nextScrollTop = Math.min(container.scrollHeight, container.scrollTop + container.clientHeight * SIDEBAR_SCROLL_STEP_RATIO);
    if (nextScrollTop !== container.scrollTop) {
      container.scrollTop = nextScrollTop;
      await new Promise((resolve) => window.setTimeout(resolve, SIDEBAR_SCROLL_SETTLE_MS));
      collectVisiblePayloads();
    }

    const scrollHeightStable = container.scrollHeight === lastScrollHeight;
    stableRounds = collected.size === lastCount && scrollHeightStable ? stableRounds + 1 : 0;
    lastCount = collected.size;
    lastScrollHeight = container.scrollHeight;
    const reachedBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    if (reachedBottom && stableRounds >= stableRoundTarget) {
      break;
    }

    if (reachedBottom && stableRounds < stableRoundTarget) {
      await new Promise((resolve) => window.setTimeout(resolve, SIDEBAR_SCROLL_SETTLE_MS));
      collectVisiblePayloads();
      lastScrollHeight = container.scrollHeight;
    }
  }

  container.scrollTop = originalScrollTop;
  await log("info", "Collected DeepSeek historical conversations on hidden discovery tab.", {
    discoveredCount: collected.size,
  });
  return Array.from(collected.values());
}

export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  async main() {
    const log = createRuntimeLogger("content.deepseek");
    await log("info", "DeepSeek content script initialized.", {
      url: window.location.href,
      title: document.title,
    });
    await injectScript("/deepseek-main-world.js", {
      keepInDom: true,
    });
    await log("debug", "Injected DeepSeek main-world bridge.");

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
      if (isWorkerPageContext()) return;
      if (event.source !== window) return;
      if (event.data?.source !== "aiexporter" || event.data?.type !== "deepseek-network-discovery") return;
      if (!event.data.payload) return;
      discoveryPayloadBuffer.set(event.data.payload.sourceId, event.data.payload);

      const revisionFingerprint = await buildDiscoveryFingerprint("deepseek", event.data.payload);
      await browser.runtime.sendMessage({
        type: "queue-discovery",
        event: {
          platform: "deepseek",
          ...event.data.payload,
          revisionFingerprint,
        },
      } satisfies RuntimeMessage);

      await log("debug", "Queued DeepSeek network discovery payload.", {
        sourceId: event.data.payload.sourceId,
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
        void collectHistoricalPayloads(log, {
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

    if (!isWorkerPageContext()) {
      await queueCurrentConversation(log);
    }

    let lastUrl = window.location.href;
    window.setInterval(() => {
      if (isWorkerPageContext()) return;
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        void log("debug", "Detected DeepSeek URL change.", {
          url: lastUrl,
        });
        void queueCurrentConversation(log);
      }
    }, 1_200);
  },
});
