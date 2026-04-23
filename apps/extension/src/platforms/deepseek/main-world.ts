import { extractDiscoveryPayloadsFromResponse } from "@aiexporter/adapters-deepseek";
import { buildDeepSeekApiHeaders } from "./browser-context";

declare global {
  interface Window {
    __aiexporterDeepSeekBridgeInstalled?: boolean;
  }

  interface XMLHttpRequest {
    __aiexporterUrl?: string;
  }
}

const DEEPSEEK_API_BASE = "https://chat.deepseek.com/api/v0";

function postDiscoveryPayloads(payload: unknown): void {
  const events = extractDiscoveryPayloadsFromResponse(payload);
  events.forEach((event) => {
    window.postMessage(
      {
        source: "aiexporter",
        type: "deepseek-network-discovery",
        payload: event,
      },
      window.location.origin,
    );
  });
}

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, window.location.origin).toString();
  if (input instanceof URL) return input.toString();
  return input.url;
}

function shouldInspectDeepSeekUrl(url: string): boolean {
  return url.includes("/api/v0/chat/");
}

export function installDeepSeekMainWorldBridge(): void {
  if (window.__aiexporterDeepSeekBridgeInstalled) return;
  window.__aiexporterDeepSeekBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = normalizeUrl(args[0]);

    if (shouldInspectDeepSeekUrl(url)) {
      const cloned = response.clone();
      void cloned
        .json()
        .then((payload) => {
          postDiscoveryPayloads(payload);
        })
        .catch(() => undefined);
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const invokeOpen = originalOpen as (...args: any[]) => void;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    this.__aiexporterUrl = typeof url === "string" ? new URL(url, window.location.origin).toString() : String(url);
    if (async === undefined && username === undefined && password === undefined) {
      return invokeOpen.call(this, method, url);
    }
    return invokeOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      const url = this.__aiexporterUrl;
      if (!url || !shouldInspectDeepSeekUrl(url) || typeof this.responseText !== "string") return;

      try {
        postDiscoveryPayloads(JSON.parse(this.responseText));
      } catch {
        return;
      }
    });

    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "aiexporter") return;
    if (event.data?.type !== "aiexporter.deepseek.fetch-file-preview") return;

    const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
    const fileId = typeof event.data.fileId === "string" ? event.data.fileId : "";
    const sessionId = typeof event.data.sessionId === "string" ? event.data.sessionId : "";
    const messageId = typeof event.data.messageId === "string" ? event.data.messageId : "";
    if (!requestId || !fileId || !sessionId) return;

    const previewUrl = `${DEEPSEEK_API_BASE}/file/preview?file_id=${encodeURIComponent(fileId)}&chat_session_id=${encodeURIComponent(sessionId)}${messageId ? `&message_id=${encodeURIComponent(messageId)}` : ""}`;
    const previewXhr = new XMLHttpRequest();
    previewXhr.open("GET", previewUrl, true);
    previewXhr.withCredentials = true;
    const previewHeaders = buildDeepSeekApiHeaders();
    Object.entries(previewHeaders).forEach(([k, v]) => previewXhr.setRequestHeader(k, v));
    previewXhr.onload = () => {
      if (previewXhr.status < 200 || previewXhr.status >= 300) {
        window.postMessage(
          {
            source: "aiexporter",
            type: "deepseek-page-file-preview-response",
            requestId,
            fileId,
            response: { ok: false, error: `DeepSeek file preview API responded with ${previewXhr.status}.` },
          },
          window.location.origin,
        );
        return;
      }
      window.postMessage(
        {
          source: "aiexporter",
          type: "deepseek-page-file-preview-response",
          requestId,
          fileId,
          response: { ok: true, text: previewXhr.responseText },
        },
        window.location.origin,
      );
    };
    previewXhr.onerror = () => {
      window.postMessage(
        {
          source: "aiexporter",
          type: "deepseek-page-file-preview-response",
          requestId,
          fileId,
          response: { ok: false, error: "Failed to fetch file preview." },
        },
        window.location.origin,
      );
    };
    previewXhr.send();
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "aiexporter") return;
    if (event.data?.type !== "aiexporter.deepseek.fetch-history") return;

    const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
    const sourceId = typeof event.data.sourceId === "string" ? event.data.sourceId : "";
    if (!requestId || !sourceId) return;

    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${DEEPSEEK_API_BASE}/chat/history_messages?chat_session_id=${encodeURIComponent(sourceId)}`, true);
    xhr.withCredentials = true;
    const headers = buildDeepSeekApiHeaders();
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        window.postMessage(
          {
            source: "aiexporter",
            type: "deepseek-page-api-response",
            requestId,
            sourceId,
            response: { ok: false, error: `DeepSeek history API responded with ${xhr.status}.` },
          },
          window.location.origin,
        );
        return;
      }
      window.postMessage(
        {
          source: "aiexporter",
          type: "deepseek-page-api-response",
          requestId,
          sourceId,
          response: { ok: true, text: xhr.responseText },
        },
        window.location.origin,
      );
    };
    xhr.onerror = () => {
      window.postMessage(
        {
          source: "aiexporter",
          type: "deepseek-page-api-response",
          requestId,
          sourceId,
          response: { ok: false, error: "Failed to fetch DeepSeek history." },
        },
        window.location.origin,
      );
    };
    xhr.send();
  });
}
