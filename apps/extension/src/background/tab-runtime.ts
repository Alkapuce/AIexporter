import type { PlatformRuntimeConfig, RuntimeMessage, WorkerLeaseState } from "@aiexporter/adapter-sdk";
import type { ConversationBundle } from "@aiexporter/core-schema";
import { writeBackgroundLog } from "../runtime/logger";
import { isConversationBundle, isErrorResponse } from "./shared";

export async function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  const current = await browser.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for conversation tab to load."));
    }, timeoutMs);

    const listener = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    browser.tabs.onUpdated.addListener(listener);
  });
}

export async function requestTabRuntimeMessage<T>(
  tabId: number,
  message: RuntimeMessage,
  attempts = 12,
  timeoutMs = 15_000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = (await Promise.race([
        browser.tabs.sendMessage(tabId, message),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Timed out while waiting for content script response.")), timeoutMs);
        }),
      ])) as T | { __aiexporterError?: string };

      if (isErrorResponse(response)) {
        throw new Error(response.__aiexporterError ?? "Content script returned an error response.");
      }

      return response as T;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to communicate with content script.");
}

export function isReceiverUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("No tab with id") ||
    message.includes("Cannot access contents of url")
  );
}

export async function waitForWorkerReady(
  tabId: number,
  expectedUrl: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url?.startsWith(expectedUrl.split("/a/chat/")[0]!)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }

    try {
      const response = await requestTabRuntimeMessage<{ ok?: boolean; url?: string }>(
        tabId,
        { type: "worker-ready-ping" },
        1,
      );
      if (response?.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error("Worker receiver did not become ready before timeout.");
}

export async function ensureWorkerReceiver(
  worker: WorkerLeaseState,
  tabId: number,
  targetUrl: string,
  config: PlatformRuntimeConfig,
  context: { sourceId?: string; traceId?: string } = {},
): Promise<number> {
  try {
    await waitForWorkerReady(tabId, targetUrl, config.receiverReadyTimeoutMs);
    return tabId;
  } catch (error) {
    await writeBackgroundLog("background.worker", "warn", "Worker receiver was not ready on the current tab.", {
      code: "worker.receiver_unavailable",
      platform: worker.platform,
      workerId: worker.workerId,
      sourceId: context.sourceId,
      traceId: context.traceId,
      targetUrl,
      error: error instanceof Error ? error.message : "Worker receiver was not ready",
    });
    throw error;
  }
}

export async function extractConversationFromTab(tabId: number, timeoutMs: number): Promise<ConversationBundle> {
  const response = await requestTabRuntimeMessage<ConversationBundle>(
    tabId,
    { type: "extract-current-conversation" },
    3,
    timeoutMs,
  );

  if (!isConversationBundle(response)) {
    throw new Error("Content script did not return a valid conversation bundle.");
  }

  return response;
}

export function isChallengeLikeTab(tab: browser.tabs.Tab): boolean {
  const text = [tab.title, tab.url].filter(Boolean).join(" ").toLowerCase();
  return (
    text.includes("just a moment") ||
    text.includes("cloudflare") ||
    text.includes("verify") ||
    text.includes("captcha") ||
    text.includes("recaptcha") ||
    text.includes("unusual traffic") ||
    text.includes("sorry/index")
  );
}

export async function closeWorkerTab(tabId: number | undefined, intentionalWorkerTabClosures: Set<number>): Promise<void> {
  if (typeof tabId !== "number") return;

  intentionalWorkerTabClosures.add(tabId);
  try {
    await browser.tabs.remove(tabId);
  } catch {
    intentionalWorkerTabClosures.delete(tabId);
  }
}
