import type { BridgeNetworkPayload, DebugLogLevel, MainWorldBridgeMessage } from "@aiexporter/adapter-sdk";
import {
  deepseekAdapter,
  extractConversationFromDom,
  extractDiscoveryPayloadsFromDocument,
  extractSessionIdFromUrl,
  parseHistoryResponse,
  summarizeHistoryPage,
  type DeepSeekHistoryResponse,
} from "@aiexporter/adapters-deepseek";
import { buildDeepSeekApiHeaders } from "./browser-context";

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

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
const DISCOVERY_API_PAGE_LIMIT = 10;

export type HistoricalDiscoverySource = "api" | "sidebar" | "merged" | "buffered" | "empty";

export interface HistoricalDiscoveryResolution {
  payloads: BridgeNetworkPayload[];
  source: HistoricalDiscoverySource;
}

export interface HistoricalPayloadResolutionOptions {
  apiPayloads: readonly BridgeNetworkPayload[];
  sidebarPayloads: readonly BridgeNetworkPayload[];
  bufferedPayloads?: Iterable<BridgeNetworkPayload>;
  preferBufferedOnly?: boolean;
}

function mergeBridgePayloads(...groups: ReadonlyArray<readonly BridgeNetworkPayload[]>): BridgeNetworkPayload[] {
  const deduped = new Map<string, BridgeNetworkPayload>();
  groups.forEach((group) => {
    group.forEach((item) => {
      deduped.set(item.sourceId, item);
    });
  });
  return Array.from(deduped.values());
}

export function buildDeepSeekDiscoveryPagePath(cursorUpdatedAt: string | number | null): string {
  if (cursorUpdatedAt === null) {
    return "/api/v0/chat_session/fetch_page?lte_cursor.pinned=false";
  }

  return `/api/v0/chat_session/fetch_page?lte_cursor.pinned=false&lte_cursor.updated_at=${encodeURIComponent(String(cursorUpdatedAt))}`;
}

export function resolveHistoricalPayloads({
  apiPayloads,
  sidebarPayloads,
  bufferedPayloads,
  preferBufferedOnly = false,
}: HistoricalPayloadResolutionOptions): HistoricalDiscoveryResolution {
  const buffered = Array.from(bufferedPayloads ?? []);

  if (preferBufferedOnly && buffered.length > 0) {
    return {
      payloads: buffered,
      source: "buffered",
    };
  }

  if (apiPayloads.length > 0 && sidebarPayloads.length > 0) {
    return {
      payloads: mergeBridgePayloads(buffered, sidebarPayloads, apiPayloads),
      source: "merged",
    };
  }

  if (apiPayloads.length > 0) {
    return {
      payloads: mergeBridgePayloads(buffered, apiPayloads),
      source: "api",
    };
  }

  if (sidebarPayloads.length > 0) {
    return {
      payloads: mergeBridgePayloads(buffered, sidebarPayloads),
      source: "sidebar",
    };
  }

  if (buffered.length > 0) {
    return {
      payloads: buffered,
      source: "buffered",
    };
  }

  return {
    payloads: [],
    source: "empty",
  };
}

function getConversationScrollContainer(documentRef: Document): HTMLElement | null {
  const candidates = [
    documentRef.querySelector<HTMLElement>("main"),
    ...Array.from(documentRef.querySelectorAll<HTMLElement>("main *")),
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

async function waitForConversationViewportReady(documentRef: Document, locationRef: Location): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CONVERSATION_READY_TIMEOUT_MS) {
    const sourceId = extractSessionIdFromUrl(locationRef.href);
    const domConversation = extractConversationFromDom(documentRef);
    if (sourceId && domConversation.messages.length > 0) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, CONVERSATION_POLL_MS));
  }
}

async function hydrateConversationDomIfNeeded(
  documentRef: Document,
  locationRef: Location,
  log: RuntimeLogger,
): Promise<void> {
  const container = getConversationScrollContainer(documentRef);
  if (!container) {
    await log("warn", "Unable to locate DeepSeek conversation scroll container for DOM hydration.", {
      code: "extract.dom_scroll_container_missing",
      url: locationRef.href,
    });
    return;
  }

  let stableRounds = 0;
  let lastCount = extractConversationFromDom(documentRef).messages.length;

  for (let step = 0; step < MESSAGE_SCROLL_MAX_STEPS; step += 1) {
    const nextScrollTop = Math.max(0, container.scrollTop - container.clientHeight * MESSAGE_SCROLL_STEP_RATIO);
    if (nextScrollTop !== container.scrollTop) {
      container.scrollTop = nextScrollTop;
      await new Promise((resolve) => window.setTimeout(resolve, MESSAGE_SCROLL_SETTLE_MS));
    }

    const currentCount = extractConversationFromDom(documentRef).messages.length;
    stableRounds = currentCount === lastCount ? stableRounds + 1 : 0;
    lastCount = currentCount;
    if (container.scrollTop <= 4 && stableRounds >= MESSAGE_SCROLL_STABLE_ROUNDS) {
      break;
    }
  }

  await log("debug", "Hydrated DeepSeek conversation DOM before fallback extraction.", {
    code: "extract.dom_hydrated",
    url: locationRef.href,
    messageCount: extractConversationFromDom(documentRef).messages.length,
  });
}

export async function fetchDeepSeekConversationViaPageWorld(
  sourceId: string,
  log: RuntimeLogger,
  options: {
    locationRef?: Location;
    timeoutMs?: number;
  } = {},
): Promise<DeepSeekHistoryResponse> {
  const requestId = crypto.randomUUID();
  const locationRef = options.locationRef ?? window.location;

  return new Promise<DeepSeekHistoryResponse>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("DeepSeek page-world history fetch timed out."));
    }, options.timeoutMs ?? PAGE_WORLD_FETCH_TIMEOUT_MS);

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
      locationRef.origin,
    );

    void log("debug", "Requested DeepSeek history via page-world bridge.", {
      code: "extract.page_world_request_started",
      sourceId,
      requestId,
      url: locationRef.href,
    });
  });
}

export async function extractCurrentDeepSeekConversation(log: RuntimeLogger) {
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

  await waitForConversationViewportReady(document, location);
  await hydrateConversationDomIfNeeded(document, location, log);
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

function getSidebarScrollContainer(documentRef: Document): HTMLElement | null {
  const directMatch = documentRef.querySelector<HTMLElement>("div._6d215eb.ds-scroll-area");
  if (directMatch) return directMatch;

  const firstConversationLink = documentRef.querySelector<HTMLAnchorElement>(DISCOVERY_LINK_SELECTOR);
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
  log: RuntimeLogger,
  timeoutMs = DISCOVERY_LINK_WAIT_TIMEOUT_MS,
  documentRef: Document = document,
): Promise<{ container: HTMLElement | null; hrefCount: number }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const container = getSidebarScrollContainer(documentRef);
    const hrefCount = documentRef.querySelectorAll(DISCOVERY_LINK_SELECTOR).length;
    if (container && hrefCount > 0) {
      return { container, hrefCount };
    }
    await new Promise((resolve) => window.setTimeout(resolve, DISCOVERY_LINK_POLL_MS));
  }

  const fallbackContainer = getSidebarScrollContainer(documentRef);
  const fallbackCount = documentRef.querySelectorAll(DISCOVERY_LINK_SELECTOR).length;
  await log("warn", "DeepSeek discovery sidebar was not ready before timeout.", {
    hrefCount: fallbackCount,
    title: documentRef.title,
    url: window.location.href,
  });
  return {
    container: fallbackContainer,
    hrefCount: fallbackCount,
  };
}

async function collectHistoricalPayloadsViaApi(log: RuntimeLogger): Promise<BridgeNetworkPayload[]> {
  const collected = new Map<string, BridgeNetworkPayload>();
  let cursorUpdatedAt: string | number | null = null;
  let pageCount = 0;
  let hasMore = true;

  while (hasMore && pageCount < DISCOVERY_API_PAGE_LIMIT) {
    const response = await fetch(buildDeepSeekDiscoveryPagePath(cursorUpdatedAt), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: buildDeepSeekApiHeaders(),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek discovery API responded with ${response.status}.`);
    }

    const page = summarizeHistoryPage((await response.json()) as DeepSeekHistoryResponse);
    page.payloads.forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });

    hasMore = page.hasMore;
    cursorUpdatedAt = page.nextCursorUpdatedAt;
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

export async function collectHistoricalPayloads(
  log: RuntimeLogger,
  discoveryPayloadBuffer: Map<string, BridgeNetworkPayload>,
  options: { readyTimeoutMs?: number; stableRounds?: number } = {},
): Promise<BridgeNetworkPayload[]> {
  let apiPayloads: BridgeNetworkPayload[] = [];

  try {
    apiPayloads = await collectHistoricalPayloadsViaApi(log);
    apiPayloads.forEach((payload) => {
      discoveryPayloadBuffer.set(payload.sourceId, payload);
    });
  } catch (error) {
    await log("warn", "DeepSeek discovery API pagination failed, falling back to sidebar crawl.", {
      error: error instanceof Error ? error.message : "DeepSeek discovery API pagination failed",
    });
  }

  const { container, hrefCount } = await waitForDiscoverySidebarReady(log, options.readyTimeoutMs);
  if (!container) {
    const resolution = resolveHistoricalPayloads({
      apiPayloads,
      sidebarPayloads: [],
      bufferedPayloads: discoveryPayloadBuffer.values(),
      preferBufferedOnly: true,
    });
    if (resolution.payloads.length > 0) {
      return resolution.payloads;
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

  const resolution = resolveHistoricalPayloads({
    apiPayloads,
    sidebarPayloads: Array.from(collected.values()),
    bufferedPayloads: discoveryPayloadBuffer.values(),
  });

  await log("info", "Collected DeepSeek historical conversations on hidden discovery tab.", {
    discoveredCount: resolution.payloads.length,
    source: resolution.source,
  });

  return resolution.payloads;
}
