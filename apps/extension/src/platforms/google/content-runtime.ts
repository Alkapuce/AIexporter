import {
  buildDiscoveryFingerprint,
  type ConversationIndexEntry,
  type DebugLogLevel,
  type MainWorldBridgeMessage,
  type RuntimeMessage,
} from "@aiexporter/adapter-sdk";
import type { ConversationBundle, SourcePlatform } from "@aiexporter/core-schema";
import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import { createDiscoveryBatchSender } from "../../runtime/discovery-batch";
import { createDiscoveryUiController, type DiscoveryUiController } from "./discovery-ui";

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
  passiveDiscoveryMessageType?: MainWorldBridgeMessage["type"];
  historyOrigin: string;
  historyLinkSelector: string;
  preferredHistoryContainerSelectors?: string[];
  historyReadyLinkCount?: number;
  historyReadyTimeoutMs?: number;
  historySweepMaxSteps?: number;
  historySweepSettleMs?: number;
  historySweepStepRatio?: number;
  historySweepStableRounds?: number;
  historyNetworkGraceMs?: number;
  historyNetworkStableRounds?: number;
  historyNetworkStableSettleMs?: number;
  historyNetworkMaxWaitMs?: number;
  prepareHistoryCollection?(document: Document, controller?: DiscoveryUiController): Promise<void>;
  collectHistoryPayloadsApi?(log: RuntimeLogger, options: HistoryCollectionOptions): Promise<BridgeNetworkPayload[]>;
  extractSourceId(url: string): string | null;
  resolveTitle(document: Document): string | undefined;
  collectHistoryPayloads(document: Document, origin: string): BridgeNetworkPayload[];
  extractCurrentConversation(): Promise<ConversationBundle>;
}

interface HistoryCollectionOptions {
  mode?: "best-effort" | "full-bootstrap";
  stableRounds?: number;
  maxSteps?: number;
  settleMs?: number;
  stepRatio?: number;
  expectedCount?: number;
  domMaxCycles?: number;
  domPostScrollWaitMs?: number;
  domStableCycles?: number;
  domScrollBottomAttempts?: number;
}

const CONVERSATION_INDEX_STORAGE_KEY = "aiexporter.conversationIndex";

function isWorkerPageContext(search = window.location.search): boolean {
  return new URLSearchParams(search).get("aiexporter_worker") === "1";
}

function isDiscoveryPageContext(search = window.location.search): boolean {
  return new URLSearchParams(search).get("aiexporter_discovery") === "1";
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
    controller?: DiscoveryUiController;
  } = {},
): Promise<number> {
  const minCount = options.minCount ?? 1;
  const timeoutMs = options.timeoutMs ?? 6_000;
  const settleMs = 500;
  const startedAt = Date.now();
  let bestCount = document.querySelectorAll(selector).length;
  options.controller?.report("开始等待历史链接出现", {
    minCount,
    timeoutMs,
    currentCount: bestCount,
  });

  while (Date.now() - startedAt < timeoutMs) {
    const count = document.querySelectorAll(selector).length;
    bestCount = Math.max(bestCount, count);
    options.controller?.setMetrics({
      stage: "waitForHistoryLinks",
      currentCount: count,
      bestCount,
      minCount,
      elapsedMs: Date.now() - startedAt,
    });
    if (count >= minCount) {
      options.controller?.report("历史链接数量达到阈值", {
        count,
        minCount,
      });
      return count;
    }
    await (options.controller?.wait(settleMs, "等待下一批历史链接") ??
      new Promise((resolve) => window.setTimeout(resolve, settleMs)));
  }

  options.controller?.report("等待历史链接超时，返回当前最佳计数", {
    bestCount,
    minCount,
  });
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
  const stepRatio = Math.max(0.18, Math.min(0.95, options.stepRatio ?? 0.92));
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

    const delta = Math.max(container.clientHeight * stepRatio, 220);
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

async function collectGeminiHistoryViaNetworkBuffer(
  options: GooglePlatformRuntimeOptions,
  log: RuntimeLogger,
  bufferedPayloads: ReadonlyMap<string, BridgeNetworkPayload>,
  collectionOptions: HistoryCollectionOptions,
  controller?: DiscoveryUiController,
): Promise<BridgeNetworkPayload[]> {
  const targetCount = Math.max(0, collectionOptions.expectedCount ?? 0);

  if (options.prepareHistoryCollection) {
    controller?.report("开始准备 Gemini 历史面板与侧栏");
    await options.prepareHistoryCollection(document, controller);
    controller?.report("Gemini 历史准备完成");
  }

  await waitForHistoryLinks(options.historyLinkSelector, {
    minCount: options.historyReadyLinkCount,
    timeoutMs: Math.min(options.historyReadyTimeoutMs ?? 30_000, 30_000),
    controller,
  });

  const collected = new Map<string, BridgeNetworkPayload>();
  const mergeBuffered = () => {
    Array.from(bufferedPayloads.values()).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
  };
  const mergeVisible = () => {
    options.collectHistoryPayloads(document, options.historyOrigin).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
  };
  const getVisibleLinkCount = () => document.querySelectorAll(options.historyLinkSelector).length;
  const getContainers = () =>
    findHistoryScrollContainers(options.historyLinkSelector, options.preferredHistoryContainerSelectors ?? []);
  const hasScrollableHistoryContainer = () =>
    getContainers().some((container) => container.scrollHeight > container.clientHeight + 120);
  const scrollContainerToBottom = async (container: HTMLElement, maxAttempts = 4) => {
    let currentTop = container.scrollTop;
    let attempt = 0;

    while (attempt < maxAttempts) {
      const nextTop = Math.max(0, container.scrollHeight - container.clientHeight);
      currentTop = nextTop;
      try {
        container.scrollTo({ top: Number.MAX_SAFE_INTEGER, left: 0, behavior: "instant" as ScrollBehavior });
      } catch {
        container.scrollTop = Number.MAX_SAFE_INTEGER;
      }
      container.scrollTop = Number.MAX_SAFE_INTEGER;
      container.scrollTop = nextTop;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      try {
        container.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: Math.max(container.clientHeight * 2, 2_400),
            bubbles: true,
          }),
        );
      } catch {
        // WheelEvent is best-effort only.
      }
      if (document.scrollingElement instanceof HTMLElement) {
        document.scrollingElement.scrollTop = Number.MAX_SAFE_INTEGER;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const settledTop = container.scrollTop;
      const settledTarget = Math.max(0, container.scrollHeight - container.clientHeight);
      currentTop = settledTop;
      attempt += 1;
      if (Math.abs(settledTarget - settledTop) <= 4) {
        break;
      }
    }

    return {
      nextTop: currentTop,
      attempts: attempt,
      finalScrollHeight: container.scrollHeight,
    };
  };

  const waitForGeminiHistoryReadiness = async () => {
    const startedAt = Date.now();
    let lastLinkCount = getVisibleLinkCount();
    let stableRounds = 0;
    controller?.report("开始等待 Gemini 历史容器完全 ready", {
      initialLinks: lastLinkCount,
    });

    while (Date.now() - startedAt < 30_000) {
      await controller?.checkpoint("等待历史容器 ready");
      mergeBuffered();
      mergeVisible();

      const currentLinkCount = getVisibleLinkCount();
      if (currentLinkCount !== lastLinkCount) {
        lastLinkCount = currentLinkCount;
        stableRounds = 0;
      } else {
        stableRounds += 1;
      }

      if (hasScrollableHistoryContainer()) {
        controller?.report("检测到可滚动历史容器");
        return;
      }

      if (currentLinkCount >= Math.max(options.historyReadyLinkCount ?? 6, 18) && stableRounds >= 6) {
        controller?.report("虽然容器仍不明显可滚，但历史链接已稳定增长，继续进入滚动阶段", {
          currentLinkCount,
          stableRounds,
        });
        return;
      }

      controller?.setMetrics({
        stage: "waitForGeminiHistoryReadiness",
        currentLinkCount,
        stableRounds,
        elapsedMs: Date.now() - startedAt,
      });
      await (controller?.wait(700, "等待容器/链接继续就绪") ??
        new Promise((resolve) => window.setTimeout(resolve, 700)));
    }
    controller?.report("等待容器 ready 超时，继续尝试滚动收集");
  };

  const waitForGeminiGrowthAfterScroll = async (
    previousSize: number,
    previousLinkCount: number,
    previousScrollHeight: number,
    cycle: number,
  ) => {
    const baseWaitMs = Math.max(1_000, collectionOptions.domPostScrollWaitMs ?? 5_000);
    let deadline = Date.now() + baseWaitMs;
    let size = previousSize;
    let linkCount = previousLinkCount;
    let scrollHeight = previousScrollHeight;
    const startedAt = Date.now();

    controller?.report("已滚到底部，开始等待历史增量返回", {
      cycle,
      waitMs: baseWaitMs,
      previousSize,
      previousLinkCount,
      previousScrollHeight,
    });

    while (Date.now() < deadline) {
      await controller?.checkpoint("滚到底后等待服务器继续返回历史块");
      const sliceMs = Math.max(250, deadline - Date.now());
      await (controller?.wait(sliceMs, "滚到底后等待下一段历史返回") ??
        new Promise((resolve) => window.setTimeout(resolve, sliceMs)));

      if (controller?.takeSkipSignal()) {
        controller.report("手动结束本轮等待窗口，立即进入下一步", {
          cycle,
          remainingMs: Math.max(0, deadline - Date.now()),
        });
        break;
      }

      const extraWaitMs = controller?.takeAdditionalWaitMs() ?? 0;
      if (extraWaitMs > 0) {
        deadline += extraWaitMs;
        controller?.report("已手动延长本轮等待窗口", {
          cycle,
          extraWaitMs,
          remainingMs: Math.max(0, deadline - Date.now()),
        });
      }

      mergeBuffered();
      mergeVisible();
      const nextSize = collected.size;
      const nextLinkCount = getVisibleLinkCount();
      const nextScrollHeight = containerScrollHeightSnapshot();

      controller?.setMetrics({
        stage: "waitForGeminiGrowthAfterScroll",
        cycle,
        previousSize,
        nextSize,
        previousLinkCount,
        nextLinkCount,
        previousScrollHeight,
        nextScrollHeight,
        elapsedMs: Date.now() - startedAt,
        remainingMs: Math.max(0, deadline - Date.now()),
      });

      if (nextSize !== size || nextLinkCount !== linkCount || nextScrollHeight !== scrollHeight) {
        size = nextSize;
        linkCount = nextLinkCount;
        scrollHeight = nextScrollHeight;
        controller?.report("检测到滚到底后的新增历史块", {
          cycle,
          collectedSize: nextSize,
          visibleLinkCount: nextLinkCount,
          scrollHeight: nextScrollHeight,
        });
      }
    }
  };
  const containerScrollHeightSnapshot = () =>
    getContainers()
      .slice(0, 4)
      .map((container) => container.scrollHeight)
      .reduce((max, current) => Math.max(max, current), 0);

  mergeBuffered();
  mergeVisible();

  if (collected.size === 0) {
    const pollStartedAt = Date.now();
    while (Date.now() - pollStartedAt < 20_000 && collected.size === 0) {
      await controller?.checkpoint("等待首批历史进入视图");
      await (controller?.wait(1_000, "等待首批历史出现") ??
        new Promise((resolve) => window.setTimeout(resolve, 1_000)));
      mergeBuffered();
      mergeVisible();
    }
    if (collected.size > 0) {
      await log("debug", "Gemini fast discovery waited for history links to become visible before scrolling.", {
        code: "discovery.gemini_waited_for_visible_history",
        platform: options.platform,
        discovered: collected.size,
      });
    }
  }

  await waitForGeminiHistoryReadiness();

  const containers = getContainers();
  controller?.report("历史容器扫描完成", {
    containerCount: containers.length,
    visibleLinks: getVisibleLinkCount(),
    collected: collected.size,
  });

  if (containers.length === 0) {
    await log("warn", "Gemini fast network discovery could not find a scrollable history container, falling back to generic collection.", {
      code: "discovery.gemini_network_container_missing",
      platform: options.platform,
      discovered: collected.size,
    });
    return Array.from(collected.values());
  }

  const maxCycles = Math.max(1, Math.floor(collectionOptions.domMaxCycles ?? 200));
  const stableCycleThreshold = Math.max(1, Math.floor(collectionOptions.domStableCycles ?? 3));
  const scrollBottomAttempts = Math.max(1, Math.floor(collectionOptions.domScrollBottomAttempts ?? 4));
  const settleMs = Math.max(1_000, Math.min(collectionOptions.settleMs ?? 1_500, 1_500));

  for (const container of containers.slice(0, 4)) {
    controller?.report("开始扫描一个历史滚动容器", {
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      className: container.className,
      id: container.id,
    });
    let stableRounds = 0;
    let previousSize = collected.size;
    let previousLinkCount = getVisibleLinkCount();
    let previousScrollHeight = container.scrollHeight;
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, settleMs));
    mergeBuffered();
    mergeVisible();

    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      await controller?.checkpoint(`滚动轮次 ${cycle + 1}`);
      const scrollResult = await scrollContainerToBottom(container, scrollBottomAttempts);
      controller?.report("已执行一次滚动到底", {
        cycle: cycle + 1,
        nextTop: scrollResult.nextTop,
        attempts: scrollResult.attempts,
        finalScrollHeight: scrollResult.finalScrollHeight,
        collectedBefore: previousSize,
        visibleLinkCountBefore: previousLinkCount,
        scrollHeightBefore: previousScrollHeight,
      });
      await waitForGeminiGrowthAfterScroll(previousSize, previousLinkCount, previousScrollHeight, cycle + 1);

      const currentSize = collected.size;
      const currentLinkCount = getVisibleLinkCount();
      const currentScrollHeight = container.scrollHeight;
      const grew =
        currentSize !== previousSize ||
        currentLinkCount !== previousLinkCount ||
        currentScrollHeight !== previousScrollHeight;
      stableRounds = grew ? 0 : stableRounds + 1;
      previousSize = currentSize;
      previousLinkCount = currentLinkCount;
      previousScrollHeight = currentScrollHeight;

      controller?.setMetrics({
        stage: "containerBottomSweep",
        cycle: cycle + 1,
        collected: currentSize,
        visibleLinkCount: currentLinkCount,
        scrollHeight: currentScrollHeight,
        stableRounds,
        maxCycles,
      });

      if (stableRounds >= stableCycleThreshold) {
        controller?.report("滚动后连续多轮没有新增，结束当前容器扫描", {
          cycle: cycle + 1,
          stableCycleThreshold,
          collected: currentSize,
          visibleLinkCount: currentLinkCount,
        });
        break;
      }

      if (cycle + 1 >= maxCycles) {
        controller?.report("当前容器达到最大扫描轮次，结束本轮容器扫描", {
          cycle: cycle + 1,
          maxCycles,
          collected: currentSize,
          visibleLinkCount: currentLinkCount,
        });
      }
    }
  }

  await log("info", "Collected Gemini historical conversations via fast network-buffer sweep.", {
    code: "discovery.gemini_network_buffer_collected",
    platform: options.platform,
    discovered: collected.size,
    targetCount,
    visibleLinkCount: getVisibleLinkCount(),
    scannedContainers: Math.min(containers.length, 4),
  });

  return Array.from(collected.values());
}

async function collectHistoricalPayloads(
  options: GooglePlatformRuntimeOptions,
  log: RuntimeLogger,
  bufferedPayloads: ReadonlyMap<string, BridgeNetworkPayload> | null = null,
  collectionOptions: HistoryCollectionOptions = {},
  controller?: DiscoveryUiController,
): Promise<BridgeNetworkPayload[]> {
  const targetCount = Math.max(0, collectionOptions.expectedCount ?? 0);
  const isGeminiFullBootstrap = options.platform === "gemini" && collectionOptions.mode === "full-bootstrap";

  if (isGeminiFullBootstrap && bufferedPayloads) {
    const fastPayloads = await collectGeminiHistoryViaNetworkBuffer(options, log, bufferedPayloads, collectionOptions, controller);
    if (fastPayloads.length > 0) {
      if (targetCount > 0 && fastPayloads.length < targetCount) {
        await log("warn", "Gemini fast network-buffer sweep returned a partial history set; returning the partial batch immediately for faster recovery.", {
          code: "discovery.gemini_network_buffer_partial_returned",
          platform: options.platform,
          discovered: fastPayloads.length,
          targetCount,
        });
      }
      return fastPayloads;
    }
  }

  if (options.collectHistoryPayloadsApi) {
    try {
      const apiPayloads = await options.collectHistoryPayloadsApi(log, collectionOptions);
      if (apiPayloads.length > 0) {
        await log("info", `Collected ${options.siteName} historical conversations via platform API.`, {
          code: "discovery.api_payloads_collected",
          platform: options.platform,
          discovered: apiPayloads.length,
          mode: collectionOptions.mode,
        });
        return apiPayloads;
      }

      await log("warn", `${options.siteName} history API returned no items, falling back to DOM links.`, {
        code: "discovery.api_empty_fallback_dom",
        platform: options.platform,
        mode: collectionOptions.mode,
      });
    } catch (error) {
      await log("warn", `${options.siteName} history API collection failed, falling back to DOM links.`, {
        code: "discovery.api_failed_fallback_dom",
        platform: options.platform,
        mode: collectionOptions.mode,
        error: error instanceof Error ? error.message : `${options.siteName} history API collection failed`,
      });
    }
  }

  if (options.prepareHistoryCollection) {
    await options.prepareHistoryCollection(document, controller);
  }
  await waitForHistoryLinks(options.historyLinkSelector, {
    minCount: options.historyReadyLinkCount,
    timeoutMs: options.historyReadyTimeoutMs,
    controller,
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

  Array.from(bufferedPayloads?.values() ?? []).forEach((payload) => {
    collected.set(payload.sourceId, payload);
  });
  collectVisible();

  if (isGeminiFullBootstrap && targetCount > 0 && collected.size >= targetCount) {
    await log("info", `Collected ${options.siteName} historical conversations from network payloads before DOM sweep.`, {
      code: "discovery.network_payloads_satisfied_target",
      platform: options.platform,
      discovered: collected.size,
      targetCount,
    });
    return Array.from(collected.values());
  }

  if (
    collectionOptions.mode !== "full-bootstrap" &&
    !(await shouldSweepHistoryContainers(options.platform, Array.from(collected.values())))
  ) {
    await log("info", `Skipped ${options.siteName} deep history sweep because visible conversations are already current.`, {
      code: "discovery.visible_current_skip_sweep",
      platform: options.platform,
      visibleDiscovered: collected.size,
    });
    return Array.from(collected.values());
  }
  if (containers.length === 0) {
    return Array.from(collected.values());
  }

  for (const container of containers) {
    const before = collected.size;
    await sweepHistoryContainer(container, options.historyLinkSelector, collectVisible, {
      ...collectionOptions,
      maxSteps: options.historySweepMaxSteps ?? collectionOptions.maxSteps,
      settleMs: options.historySweepSettleMs ?? collectionOptions.settleMs,
      stepRatio: options.historySweepStepRatio ?? collectionOptions.stepRatio,
      stableRounds: options.historySweepStableRounds ?? collectionOptions.stableRounds,
    });
    collectVisible();
    Array.from(bufferedPayloads?.values() ?? []).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
    await log("debug", `Scanned ${options.siteName} history container.`, {
      platform: options.platform,
      discoveredBefore: before,
      discoveredAfter: collected.size,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      className: container.className,
      id: container.id,
    });

    if (isGeminiFullBootstrap && targetCount > 0 && collected.size >= targetCount) {
      await log("info", `Finished ${options.siteName} DOM sweep early after reaching the historical target count.`, {
        code: "discovery.target_reached_early",
        platform: options.platform,
        discovered: collected.size,
        targetCount,
      });
      break;
    }
  }

  const networkGraceMs = isGeminiFullBootstrap ? Math.min(options.historyNetworkGraceMs ?? 0, 5_000) : options.historyNetworkGraceMs ?? 0;
  if (networkGraceMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, networkGraceMs));
    Array.from(bufferedPayloads?.values() ?? []).forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });
  }

  const networkStableRounds = isGeminiFullBootstrap ? Math.min(options.historyNetworkStableRounds ?? 0, 4) : options.historyNetworkStableRounds ?? 0;
  const networkStableSettleMs = isGeminiFullBootstrap ? Math.min(options.historyNetworkStableSettleMs ?? 0, 1_200) : options.historyNetworkStableSettleMs ?? 0;
  const networkMaxWaitMs = isGeminiFullBootstrap ? Math.min(options.historyNetworkMaxWaitMs ?? 0, 15_000) : options.historyNetworkMaxWaitMs ?? 0;
  if (networkStableRounds > 0 && networkStableSettleMs > 0 && bufferedPayloads) {
    let stableRounds = 0;
    let previousSize = bufferedPayloads.size;
    const waitStartedAt = Date.now();
    while (stableRounds < networkStableRounds) {
      await new Promise((resolve) => window.setTimeout(resolve, networkStableSettleMs));
      const currentSize = bufferedPayloads.size;
      Array.from(bufferedPayloads.values()).forEach((payload) => {
        collected.set(payload.sourceId, payload);
      });
      stableRounds = currentSize === previousSize ? stableRounds + 1 : 0;
      previousSize = currentSize;
      if (isGeminiFullBootstrap && targetCount > 0 && currentSize >= targetCount && stableRounds >= 1) {
        break;
      }
      if (networkMaxWaitMs > 0 && Date.now() - waitStartedAt >= networkMaxWaitMs) {
        break;
      }
    }
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

  const batchSender = createDiscoveryBatchSender({
    platform: options.platform,
    onFlush: async ({ events, reason }) => {
      await log("debug", `${options.siteName} passive discovery batch flushed.`, {
        code: "discovery.batch_flushed",
        platform: options.platform,
        batchSize: events.length,
        reason,
      });
    },
  });

  const discoveryController =
    options.platform === "gemini" && isDiscoveryPageContext()
      ? createDiscoveryUiController(options.platform, options.siteName, {
          onLogEntry: async (uiMessage) => {
            await log("debug", `${options.siteName} discovery UI event.`, {
              code: "discovery.ui_event",
              platform: options.platform,
              url: window.location.href,
              uiMessage,
            });
          },
        })
      : undefined;

  const discoveryPayloadBuffer = new Map<string, BridgeNetworkPayload>();

  if (options.passiveDiscoveryMessageType && !isWorkerPageContext()) {
    const onWindowMessage = async (event: MessageEvent<MainWorldBridgeMessage & { source?: string }>) => {
      if (
        event.source !== window ||
        event.data?.source !== "aiexporter" ||
        event.data?.type !== options.passiveDiscoveryMessageType ||
        !event.data.payload
      ) {
        return;
      }

      const payload = event.data.payload;
      discoveryPayloadBuffer.set(payload.sourceId, payload);

      const revisionFingerprint = await buildDiscoveryFingerprint(options.platform, payload);
      await batchSender.enqueue({
        platform: options.platform,
        ...payload,
        revisionFingerprint,
      });

      await log("debug", `Queued ${options.siteName} network discovery payload.`, {
        platform: options.platform,
        sourceId: payload.sourceId,
        sourceUpdatedAt: payload.sourceUpdatedAt,
      });
    };

    window.addEventListener("message", onWindowMessage);
  }

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
      discoveryController?.report("收到 collect-platform-discovery 请求", {
        mode: message.mode,
        expectedCount: message.expectedCount,
        domMaxCycles: message.domMaxCycles,
        domPostScrollWaitMs: message.domPostScrollWaitMs,
        domStableCycles: message.domStableCycles,
        domScrollBottomAttempts: message.domScrollBottomAttempts,
      });
      void collectHistoricalPayloads(options, log, discoveryPayloadBuffer, {
        mode: message.mode,
        stableRounds: message.stableRounds,
        expectedCount: message.expectedCount,
        domMaxCycles: message.domMaxCycles,
        domPostScrollWaitMs: message.domPostScrollWaitMs,
        domStableCycles: message.domStableCycles,
        domScrollBottomAttempts: message.domScrollBottomAttempts,
      }, discoveryController)
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

  if (!isWorkerPageContext() && !isDiscoveryPageContext()) {
    await queueCurrentConversation(options, log);
  }

  installUrlChangeMonitor((nextUrl) => {
    if (isWorkerPageContext() || isDiscoveryPageContext()) return;
    void log("debug", `Detected ${options.siteName} URL change.`, {
      platform: options.platform,
      url: nextUrl,
    });
    void queueCurrentConversation(options, log);
  });
}

async function loadPlatformConversationIndex(platform: SourcePlatform): Promise<ConversationIndexEntry[]> {
  const raw = await browser.storage.local.get(CONVERSATION_INDEX_STORAGE_KEY);
  const entries = Array.isArray(raw[CONVERSATION_INDEX_STORAGE_KEY])
    ? (raw[CONVERSATION_INDEX_STORAGE_KEY] as ConversationIndexEntry[])
    : [];
  return entries.filter((entry) => entry.platform === platform);
}

async function shouldSweepHistoryContainers(
  platform: SourcePlatform,
  payloads: BridgeNetworkPayload[],
): Promise<boolean> {
  if (payloads.length === 0) return true;

  const index = await loadPlatformConversationIndex(platform);
  const indexBySourceId = new Map(index.map((entry) => [entry.sourceId, entry]));

  for (const payload of payloads) {
    const existing = indexBySourceId.get(payload.sourceId);
    if (!existing || existing.exportState !== "exported") {
      return true;
    }

    const nextFingerprint = await buildDiscoveryFingerprint(platform, payload);
    if (existing.latestDiscoveryFingerprint !== nextFingerprint) {
      return true;
    }
  }

  return false;
}
