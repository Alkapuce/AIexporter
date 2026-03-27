import { extractDiscoveryPayloadsFromResponse } from "@aiexporter/adapters-chatgpt";

declare global {
  interface Window {
    __aiexporterBridgeInstalled?: boolean;
  }

  interface XMLHttpRequest {
    __aiexporterUrl?: string;
  }
}

function postDiscoveryPayloads(payload: unknown): void {
  const events = extractDiscoveryPayloadsFromResponse(payload);
  events.forEach((event) => {
    window.postMessage(
      {
        source: "aiexporter",
        type: "chatgpt-network-discovery",
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
  return url.includes("/backend-api/conversations") || url.includes("/backend-api/conversation/");
}

export default defineUnlistedScript(() => {
  if (window.__aiexporterBridgeInstalled) return;
  window.__aiexporterBridgeInstalled = true;

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
});
