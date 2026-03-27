import { extractDiscoveryPayloadsFromResponse } from "@aiexporter/adapters-deepseek";

declare global {
  interface Window {
    __aiexporterDeepSeekBridgeInstalled?: boolean;
  }

  interface XMLHttpRequest {
    __aiexporterUrl?: string;
  }
}

const DEEPSEEK_API_BASE = "https://chat.deepseek.com/api/v0";

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

function buildHistoryHeaders(): Record<string, string> {
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

function shouldInspect(url: string): boolean {
  return url.includes("/api/v0/chat/");
}

export default defineUnlistedScript(() => {
  if (window.__aiexporterDeepSeekBridgeInstalled) return;
  window.__aiexporterDeepSeekBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = normalizeUrl(args[0]);

    if (shouldInspect(url)) {
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
      if (!url || !shouldInspect(url) || typeof this.responseText !== "string") return;

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
    if (event.data?.type !== "aiexporter.deepseek.fetch-history") return;

    const requestId = typeof event.data.requestId === "string" ? event.data.requestId : "";
    const sourceId = typeof event.data.sourceId === "string" ? event.data.sourceId : "";
    if (!requestId || !sourceId) return;

    void fetch(`${DEEPSEEK_API_BASE}/chat/history_messages?chat_session_id=${encodeURIComponent(sourceId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: buildHistoryHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`DeepSeek history API responded with ${response.status}.`);
        }
        const data = await response.json();
        window.postMessage(
          {
            source: "aiexporter",
            type: "deepseek-page-api-response",
            requestId,
            sourceId,
            response: {
              ok: true,
              data,
            },
          },
          window.location.origin,
        );
      })
      .catch((error) => {
        window.postMessage(
          {
            source: "aiexporter",
            type: "deepseek-page-api-response",
            requestId,
            sourceId,
            response: {
              ok: false,
              error: error instanceof Error ? error.message : "Failed to fetch DeepSeek history.",
            },
          },
          window.location.origin,
        );
      });
  });
});
