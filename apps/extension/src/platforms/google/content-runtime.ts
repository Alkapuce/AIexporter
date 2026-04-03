import { buildDiscoveryFingerprint, type DebugLogLevel, type RuntimeMessage } from "@aiexporter/adapter-sdk";
import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import type { ConversationBundle, SourcePlatform } from "@aiexporter/core-schema";
import { ensureGoogleFloatingButton, setGoogleFloatingStatus, summarizeGoogleManualExportResult } from "./ui";

declare global {
  interface Window {
    __aiexporterGoogleRuntimeInstalled?: Partial<Record<SourcePlatform, boolean>>;
  }
}

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

export interface GooglePlatformRuntimeOptions {
  platform: SourcePlatform;
  siteName: string;
  historyOrigin: string;
  historyLinkSelector: string;
  preferredHistoryContainerSelectors?: string[];
  historyReadyLinkCount?: number;
  historyReadyTimeoutMs?: number;
  historySweepMaxSteps?: number;
  historySweepSettleMs?: number;
  historySweepStableRounds?: number;
  prepareHistoryCollection?(document: Document): Promise<void>;
  extractSourceId(url: string): string | null;
  resolveTitle(document: Document): string | undefined;
  collectHistoryPayloads(document: Document, origin: string): BridgeNetworkPayload[];
  extractCurrentConversation(): Promise<ConversationBundle>;
}

interface HistoryCollectionOptions {
  stableRounds?: number;
  maxSteps?: number;
  settleMs?: number;
}

function unwrapRuntimeResponse<T>(response: T | { __aiexporterError?: string }): T {
  if (response && typeof response === "object" && "__aiexporterError" in response) {
    throw new Error((response as { __aiexporterError?: string }).__aiexporterError ?? "Unknown background error");
  }
  return response as T;
}

function isWorkerPageContext(search = window.location.search): boolean {
  return new URLSearchParams(search).get("aiexporter_worker") === "1";
}

async function queueCurrentConversation(options: GooglePlatformRuntimeOptions, log: RuntimeLogger): Promise<void> {
  const sourceId = options.extractSourceId(window.location.href);
  if (!sourceId) return;

  const payload = {
    sourceId,
    url: window.location.href,
    title: options.resolveTitle(document),
    sourceUpdatedAt: undefined,
  };

  const revisionFingerprint = await buildDiscoveryFingerprint(options.platform, payload);
  await browser.runtime.sendMessage({
    type: "queue-discovery",
    event: {
      platform: options.platform,
      ...payload,
      revisionFingerprint,
    },
  } satisfies RuntimeMessage);

  await log("debug", `Queued ${options.siteName} conversation from current page.`, {
    platform: options.platform,
    sourceId,
    url: window.location.href,
  });
}

async function handleManualExport(
  options: GooglePlatformRuntimeOptions,
  log: RuntimeLogger,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  button.textContent = "Exporting...";
  try {
    const result = unwrapRuntimeResponse(
      await browser.runtime.sendMessage({
        type: "manual-export-current",
        url: window.location.href,
      } satisfies RuntimeMessage),
    );
    await log("info", `${options.siteName} manual export completed.`, {
      platform: options.platform,
      result: result as Record<string, unknown>,
    });
    setGoogleFloatingStatus(options.platform, summarizeGoogleManualExportResult(result), "success");
  } catch (error) {
    await log("error", `${options.siteName} manual export failed.`, {
      platform: options.platform,
      error: error instanceof Error ? error.message : `${options.siteName} manual export failed`,
    });
    setGoogleFloatingStatus(
      options.platform,
      error instanceof Error ? error.message : `${options.siteName} manual export failed`,
      "error",
    );
  } finally {
    button.disabled = false;
    button.textContent = "Export Chat";
  }
}

function isScrollableContainer(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    element.scrollHeight > element.clientHeight + 20 &&
    (style.overflowY === "auto" || style.overflowY === "scroll")
  );
}

function matchesPreferredHistoryContainer(element: HTMLElement, selectors: string[]): boolean {
  return selectors.some((selector) => element.matches(selector));
}

function scoreHistoryContainer(element: HTMLElement, selector: string, preferredSelectors: string[]): number {
  const text = `${element.id} ${element.className} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
  const anchoredDescendants = element.querySelectorAll(selector).length;
  const visibilityScore = element.clientHeight > 0 ? 1 : 0;
  const preferredScore = matchesPreferredHistoryContainer(element, preferredSelectors) ? 24 : 0;
  const scrollDeltaScore = Math.min(30, Math.round(Math.max(0, element.scrollHeight - element.clientHeight) / 25));
  const semanticScore =
    Number(text.includes("history")) * 8 +
    Number(text.includes("sidebar")) * 6 +
    Number(text.includes("nav")) * 4 +
    Number(text.includes("menu")) * 3 +
    Number(text.includes("conversation")) * 2;
  const areaScore = Math.min(10, Math.round((element.clientHeight * Math.max(1, element.clientWidth)) / 50_000));
  return anchoredDescendants * 20 + semanticScore + areaScore + visibilityScore + preferredScore + scrollDeltaScore;
}

function containsHistoryAnchors(element: HTMLElement, selector: string): boolean {
  return element.matches(selector) || element.querySelector(selector) !== null;
}

interface RankedHistoryContainer {
  element: HTMLElement;
  anchoredDescendants: number;
  scrollDelta: number;
  score: number;
}

function rankHistoryContainer(
  element: HTMLElement,
  selector: string,
  preferredSelectors: string[],
): RankedHistoryContainer {
  return {
    element,
    anchoredDescendants: element.querySelectorAll(selector).length,
    scrollDelta: Math.max(0, element.scrollHeight - element.clientHeight),
    score: scoreHistoryContainer(element, selector, preferredSelectors),
  };
}

function isRedundantNestedHistoryContainer(
  candidate: RankedHistoryContainer,
  kept: RankedHistoryContainer,
): boolean {
  if (candidate.element === kept.element) return false;
  if (!kept.element.contains(candidate.element)) return false;
  if (kept.anchoredDescendants < candidate.anchoredDescendants) return false;

  return kept.scrollDelta >= candidate.scrollDelta + 80 || (candidate.scrollDelta <= 24 && kept.scrollDelta > 160);
}

function findHistoryScrollContainers(selector: string, preferredSelectors: string[] = []): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  const anchors = Array.from(document.querySelectorAll<HTMLElement>(selector));

  preferredSelectors.forEach((preferredSelector) => {
    document.querySelectorAll<HTMLElement>(preferredSelector).forEach((element) => {
      if (isScrollableContainer(element) || containsHistoryAnchors(element, selector)) {
        candidates.add(element);
      }
    });
  });

  for (const anchor of anchors) {
    let current: HTMLElement | null = anchor.parentElement;
    let depth = 0;
    while (current && depth < 8) {
      if (isScrollableContainer(current) || matchesPreferredHistoryContainer(current, preferredSelectors)) {
        candidates.add(current);
      }
      current = current.parentElement;
      depth += 1;
    }
  }

  Array.from(document.querySelectorAll<HTMLElement>("body *"))
    .filter(
      (element) =>
        isScrollableContainer(element) &&
        (containsHistoryAnchors(element, selector) || matchesPreferredHistoryContainer(element, preferredSelectors)),
    )
    .forEach((element) => candidates.add(element));

  if (
    document.scrollingElement instanceof HTMLElement &&
    isScrollableContainer(document.scrollingElement) &&
    containsHistoryAnchors(document.scrollingElement, selector)
  ) {
    candidates.add(document.scrollingElement);
  }

  const ranked = Array.from(candidates)
    .map((element) => rankHistoryContainer(element, selector, preferredSelectors))
    .sort((left, right) => {
      if (right.anchoredDescendants !== left.anchoredDescendants) {
        return right.anchoredDescendants - left.anchoredDescendants;
      }
      if (Math.abs(right.scrollDelta - left.scrollDelta) > 80) {
        return right.scrollDelta - left.scrollDelta;
      }
      return right.score - left.score;
    });

  return ranked
    .filter((candidate, index) => !ranked.slice(0, index).some((kept) => isRedundantNestedHistoryContainer(candidate, kept)))
    .map((candidate) => candidate.element)
    .slice(0, 6);
}

function getVisibleAnchorSignature(selector: string): string {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))
    .map((anchor) => anchor.getAttribute("href") ?? "")
    .filter(Boolean)
    .slice(0, 40)
    .join("|");
}

async function waitForHistoryLinks(
  selector: string,
  options: {
    minCount?: number;
    timeoutMs?: number;
  } = {},
): Promise<number> {
  const minCount = options.minCount ?? 1;
  const timeoutMs = options.timeoutMs ?? 6_000;
  const settleMs = 500;
  const startedAt = Date.now();
  let bestCount = document.querySelectorAll(selector).length;

  while (Date.now() - startedAt < timeoutMs) {
    const count = document.querySelectorAll(selector).length;
    bestCount = Math.max(bestCount, count);
    if (count >= minCount) {
      return count;
    }
    await new Promise((resolve) => window.setTimeout(resolve, settleMs));
  }

  return bestCount;
}

async function sweepHistoryContainer(
  container: HTMLElement,
  selector: string,
  collectVisible: () => void,
  options: HistoryCollectionOptions = {},
): Promise<void> {
  const maxSteps = options.maxSteps ?? 80;
  const settleMs = options.settleMs ?? 1_000;
  const stableThreshold = options.stableRounds ?? 4;
  const originalScrollTop = container.scrollTop;
  let stableRounds = 0;
  let lastSignature = "";

  for (const scrollTop of [0, container.scrollTop]) {
    container.scrollTop = scrollTop;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, settleMs));
    collectVisible();
  }

  for (let step = 0; step < maxSteps; step += 1) {
    collectVisible();
    const signature = [
      getVisibleAnchorSignature(selector),
      String(container.scrollHeight),
      String(container.scrollTop),
    ].join("::");
    stableRounds = signature === lastSignature ? stableRounds + 1 : 0;
    lastSignature = signature;

    const delta = Math.max(container.clientHeight * 0.92, 420);
    const nextTop = Math.min(container.scrollHeight, container.scrollTop + delta);
    if (nextTop === container.scrollTop) {
      stableRounds += 1;
    } else {
      container.scrollTop = nextTop;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      try {
        container.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
      } catch {
        // WheelEvent is best-effort only.
      }
      await new Promise((resolve) => window.setTimeout(resolve, settleMs));
    }

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4 && stableRounds >= stableThreshold) {
      break;
    }
  }

  container.scrollTop = originalScrollTop;
  container.dispatchEvent(new Event("scroll", { bubbles: true }));
}

async function collectHistoricalPayloads(
  options: GooglePlatformRuntimeOptions,
  log: RuntimeLogger,
  collectionOptions: HistoryCollectionOptions = {},
): Promise<BridgeNetworkPayload[]> {
  if (options.prepareHistoryCollection) {
    await options.prepareHistoryCollection(document);
  }
  await waitForHistoryLinks(options.historyLinkSelector, {
    minCount: options.historyReadyLinkCount,
    timeoutMs: options.historyReadyTimeoutMs,
  });
  const containers = findHistoryScrollContainers(
    options.historyLinkSelector,
    options.preferredHistoryContainerSelectors ?? [],
  );
  const collected = new Map<string, BridgeNetworkPayload>();

  const collectVisible = () => {
    options.collectHistoryPayloads(document, options.historyOrigin).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
  };

  collectVisible();
  if (containers.length === 0) {
    return Array.from(collected.values());
  }

  for (const container of containers) {
    const before = collected.size;
    await sweepHistoryContainer(container, options.historyLinkSelector, collectVisible, {
      ...collectionOptions,
      maxSteps: options.historySweepMaxSteps ?? collectionOptions.maxSteps,
      settleMs: options.historySweepSettleMs ?? collectionOptions.settleMs,
      stableRounds: options.historySweepStableRounds ?? collectionOptions.stableRounds,
    });
    collectVisible();
    await log("debug", `Scanned ${options.siteName} history container.`, {
      platform: options.platform,
      discoveredBefore: before,
      discoveredAfter: collected.size,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      className: container.className,
      id: container.id,
    });
  }

  await log("info", `Collected ${options.siteName} historical conversations via DOM history links.`, {
    platform: options.platform,
    discovered: collected.size,
    scannedContainers: containers.length,
  });

  return Array.from(collected.values());
}

export async function mountGoogleContentRuntime(options: GooglePlatformRuntimeOptions, log: RuntimeLogger): Promise<void> {
  const installed = window.__aiexporterGoogleRuntimeInstalled ?? {};
  if (installed[options.platform]) {
    await log("debug", `Skipped duplicate ${options.siteName} content runtime mount.`, {
      platform: options.platform,
      url: window.location.href,
    });
    return;
  }
  window.__aiexporterGoogleRuntimeInstalled = {
    ...installed,
    [options.platform]: true,
  };

  const button = ensureGoogleFloatingButton(options.platform);
  button.addEventListener("click", () => {
    void handleManualExport(options, log, button);
  });

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
      void options.extractCurrentConversation()
        .then((bundle) => sendResponse(bundle))
        .catch((error) =>
          sendResponse({
            __aiexporterError: error instanceof Error ? error.message : `Failed to extract ${options.siteName} conversation`,
          }),
        );
      return true;
    }

    if (message.type === "collect-platform-discovery" && message.platform === options.platform) {
      void collectHistoricalPayloads(options, log, {
        stableRounds: message.stableRounds,
      })
        .then((payloads) => sendResponse(payloads))
        .catch((error) =>
          sendResponse({
            __aiexporterError: error instanceof Error ? error.message : `Failed to collect ${options.siteName} discovery payloads`,
          }),
        );
      return true;
    }

    return undefined;
  });

  if (!isWorkerPageContext()) {
    await queueCurrentConversation(options, log);
  }

  let lastUrl = window.location.href;
  window.setInterval(() => {
    if (isWorkerPageContext()) return;
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      void queueCurrentConversation(options, log);
    }
  }, 1_500);
}
