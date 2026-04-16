import {
  aiStudioAdapter,
  extractAiStudioConversationFromDom,
  extractAiStudioConversationFromResolvedPromptPayload,
  extractAiStudioPayloadsFromListPromptsResponse,
  extractAiStudioPayloadsFromDocument,
  extractAiStudioPromptIdFromUrl,
} from "@aiexporter/adapters-gemini";
import { normalizeConversationTitle, normalizeConversationUrl, type ConversationBundle } from "@aiexporter/core-schema";
import type { BridgeNetworkPayload } from "@aiexporter/adapter-sdk";
import type { DebugLogLevel } from "@aiexporter/adapter-sdk";
import { mountGoogleContentRuntime } from "../google/content-runtime";

type RuntimeLogger = (
  level: DebugLogLevel,
  message: string,
  details?: Record<string, unknown>,
) => Promise<void>;

const AISTUDIO_RESOLVE_DRIVE_RESOURCE_ENDPOINT =
  "https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource";
const AISTUDIO_LIST_PROMPTS_ENDPOINT =
  "https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ListPrompts";
const AISTUDIO_PUBLIC_API_KEY = "AIzaSyDdP816MREB3SkjZO04QXbjsigfcI0GWOs";
const AISTUDIO_HISTORY_API_PAGE_LIMIT = 40;
const AISTUDIO_RESOLVE_TIMEOUT_MS = 15_000;
const AISTUDIO_LIST_PROMPTS_TIMEOUT_MS = 12_000;
const AISTUDIO_DOM_IMAGE_MERGE_LIMIT = 12;

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function buildAiStudioAuthorizationHeader(): Promise<string> {
  const sapisid = readCookie("SAPISID") ?? readCookie("__Secure-1PAPISID") ?? readCookie("__Secure-3PAPISID");
  if (!sapisid) {
    throw new Error("AI Studio auth cookies were not available in the page context.");
  }

  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const hash = await sha1Hex(`${timestamp} ${sapisid} ${window.location.origin}`);
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchAiStudioResolvedPromptPayload(sourceId: string): Promise<unknown> {
  const authorization = await buildAiStudioAuthorizationHeader();
  const response = await fetchWithTimeout(
    AISTUDIO_RESOLVE_DRIVE_RESOURCE_ENDPOINT,
    {
      method: "POST",
      credentials: "include",
      headers: {
        authorization,
        "content-type": "application/json+protobuf",
      "x-goog-api-key": AISTUDIO_PUBLIC_API_KEY,
      "x-goog-authuser": "0",
        "x-user-agent": "grpc-web-javascript/0.1",
      },
      body: JSON.stringify([sourceId]),
    },
    AISTUDIO_RESOLVE_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`AI Studio ResolveDriveResource responded with ${response.status}.`);
  }

  return JSON.parse(await response.text()) as unknown;
}

async function fetchAiStudioListPromptsPage(cursor?: string): Promise<string> {
  const authorization = await buildAiStudioAuthorizationHeader();
  const response = await fetchWithTimeout(
    AISTUDIO_LIST_PROMPTS_ENDPOINT,
    {
      method: "POST",
      credentials: "include",
      headers: {
        authorization,
        "content-type": "application/json+protobuf",
      "x-goog-api-key": AISTUDIO_PUBLIC_API_KEY,
      "x-goog-authuser": "0",
        "x-user-agent": "grpc-web-javascript/0.1",
      },
      body: JSON.stringify(cursor ? [null, cursor] : []),
    },
    AISTUDIO_LIST_PROMPTS_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`AI Studio ListPrompts responded with ${response.status}.`);
  }

  return await response.text();
}

async function collectAiStudioHistoryViaApi(
  log: RuntimeLogger,
  options: {
    mode?: "best-effort" | "full-bootstrap";
  } = {},
): Promise<BridgeNetworkPayload[]> {
  const collected = new Map<string, BridgeNetworkPayload>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < AISTUDIO_HISTORY_API_PAGE_LIMIT) {
    const responseText = await fetchAiStudioListPromptsPage(cursor);
    const parsed = extractAiStudioPayloadsFromListPromptsResponse(responseText);
    pageCount += 1;

    parsed.payloads.forEach((payload) => {
      collected.set(payload.sourceId, payload);
    });

    await log("debug", "Fetched AI Studio history page via ListPrompts.", {
      code: "discovery.api_page_fetched",
      platform: "aistudio",
      mode: options.mode,
      page: pageCount,
      pageItems: parsed.payloads.length,
      totalDiscovered: collected.size,
      hasNextCursor: Boolean(parsed.nextCursor),
    });

    if (!parsed.nextCursor || seenCursors.has(parsed.nextCursor)) {
      break;
    }

    seenCursors.add(parsed.nextCursor);
    cursor = parsed.nextCursor;
  }

  return Array.from(collected.values());
}

function isLikelyTitleOnlyBundle(bundle: ConversationBundle): boolean {
  if (bundle.messages.length !== 1) return false;
  const [message] = bundle.messages;
  if (!message || message.role !== "user") return false;
  const normalizedTitle = bundle.title?.trim();
  return Boolean(normalizedTitle) && message.markdown.trim() === normalizedTitle;
}

function countImageMarkdown(markdown: string): number {
  return markdown.match(/!\[[^\]]*]\([^)]+\)/g)?.length ?? 0;
}

function countDriveAttachmentLinks(markdown: string): number {
  return markdown.match(/\[Google Drive resource [^\]]+\]\(https:\/\/drive\.google\.com\/open\?id=[^)]+\)/g)?.length ?? 0;
}

function collectImageMarkdownLines(markdown: string): string[] {
  return Array.from(new Set(markdown.match(/!\[[^\]]*]\([^)]+\)/g) ?? []));
}

function shouldAttemptAiStudioDomImageMerge(bundle: ConversationBundle): boolean {
  return bundle.messages.some((message) => {
    const driveAttachmentCount = countDriveAttachmentLinks(message.markdown);
    if (driveAttachmentCount === 0) return false;
    return countImageMarkdown(message.markdown) < Math.min(driveAttachmentCount, AISTUDIO_DOM_IMAGE_MERGE_LIMIT);
  });
}

function mergeAiStudioDomImages(
  rpcBundle: ConversationBundle,
  domBundle: ConversationBundle,
): ConversationBundle {
  const domMessagesById = new Map(domBundle.messages.map((message) => [message.id, message]));
  let mergedImages = 0;

  const messages = rpcBundle.messages.map((message) => {
    const domMessage = domMessagesById.get(message.id);
    if (!domMessage) return message;

    const imageLines = collectImageMarkdownLines(domMessage.markdown);
    if (imageLines.length === 0) return message;

    const existingImages = new Set(collectImageMarkdownLines(message.markdown));
    const newImages = imageLines.filter((line) => !existingImages.has(line));
    if (newImages.length === 0) return message;

    mergedImages += newImages.length;
    return {
      ...message,
      markdown: `${newImages.join("\n\n")}\n\n${message.markdown}`.trim(),
    };
  });

  return {
    ...rpcBundle,
    messages,
    meta: {
      ...(rpcBundle.meta ?? {}),
      source: mergedImages > 0 ? "resolve-drive-resource+dom-image-merge" : rpcBundle.meta?.source,
      domMergedImageCount: mergedImages,
    },
  };
}

async function extractCurrentAiStudioConversation(log: RuntimeLogger): Promise<ConversationBundle> {
  const normalizedUrl = normalizeConversationUrl(window.location.href);
  const sourceId = extractAiStudioPromptIdFromUrl(normalizedUrl);
  if (!sourceId) {
    throw new Error("Current page is not an AI Studio prompt URL.");
  }

  try {
    await log("debug", "Attempting AI Studio ResolveDriveResource extraction.", {
      code: "extract.rpc_started",
      sourceId,
      url: normalizedUrl,
    });
    const payload = await fetchAiStudioResolvedPromptPayload(sourceId);
    let bundle = extractAiStudioConversationFromResolvedPromptPayload(payload, normalizedUrl, sourceId);
    if (shouldAttemptAiStudioDomImageMerge(bundle)) {
      await log("debug", "Attempting AI Studio DOM image merge for deferred attachments.", {
        code: "extract.dom_image_merge_started",
        sourceId,
      });
      try {
        const domBundle = await extractAiStudioConversationFromDom(document, normalizedUrl, sourceId);
        bundle = mergeAiStudioDomImages(bundle, domBundle);
        await log("info", "Merged AI Studio DOM images into ResolveDriveResource export.", {
          code: "extract.dom_image_merge_success",
          sourceId,
          mergedImageCount: bundle.meta?.domMergedImageCount,
        });
      } catch (error) {
        await log("warn", "AI Studio DOM image merge failed, keeping RPC-only export.", {
          code: "extract.dom_image_merge_failed",
          sourceId,
          error: error instanceof Error ? error.message : "AI Studio DOM image merge failed",
        });
      }
    }
    await log("info", "Extracted AI Studio conversation via ResolveDriveResource.", {
      code: "extract.rpc_success",
      sourceId,
      messageCount: bundle.messages.length,
      hasImages: bundle.meta?.hasImages,
    });
    return bundle;
  } catch (error) {
    await log("warn", "AI Studio ResolveDriveResource extraction failed, falling back to DOM.", {
      code: "extract.rpc_failed",
      sourceId,
        error: error instanceof Error ? error.message : "AI Studio ResolveDriveResource extraction failed",
    });
  }

  await log("info", "Falling back to AI Studio DOM extraction.", {
    code: "extract.dom_started",
    sourceId,
    url: normalizedUrl,
  });
  const bundle = await aiStudioAdapter.extractCurrentConversation({
    document,
    window,
    location,
  });
  if (isLikelyTitleOnlyBundle(bundle)) {
    await log("warn", "AI Studio DOM extraction fell back to a title-only bundle.", {
      code: "extract.dom_title_only",
      sourceId,
      title: bundle.title,
    });
  } else {
    await log("info", "Extracted AI Studio conversation via DOM fallback.", {
      code: "extract.dom_success",
      sourceId,
      messageCount: bundle.messages.length,
    });
  }
  return bundle;
}

export async function mountAiStudioContentRuntime(log: RuntimeLogger): Promise<void> {
  await mountGoogleContentRuntime(
    {
      platform: "aistudio",
      siteName: "Google AI Studio",
      historyOrigin: "https://aistudio.google.com",
      historyLinkSelector: 'a[href*="/prompts/"]',
      preferredHistoryContainerSelectors: [
        ".lib-table-wrapper",
        ".history-list-container",
        ".history-panel",
        '.view-all-history-link[href="/library"]',
      ],
      historyReadyLinkCount: 20,
      historyReadyTimeoutMs: 8_000,
      historySweepMaxSteps: 36,
      historySweepSettleMs: 350,
      historySweepStableRounds: 2,
      collectHistoryPayloadsApi: (runtimeLog, options) => collectAiStudioHistoryViaApi(runtimeLog, options),
      extractSourceId: extractAiStudioPromptIdFromUrl,
      resolveTitle: (document) =>
        normalizeConversationTitle(document.title.replace(/\s*\|\s*Google AI Studio\s*$/i, "").trim()) || undefined,
      collectHistoryPayloads: extractAiStudioPayloadsFromDocument,
      extractCurrentConversation: () => extractCurrentAiStudioConversation(log),
    },
    log,
  );
}
