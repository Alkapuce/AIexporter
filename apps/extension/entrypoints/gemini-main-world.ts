import { extractGeminiPayloadsFromBatchedResponse } from "@aiexporter/adapters-gemini";
import type { MainWorldBridgeMessage } from "@aiexporter/adapter-sdk";
import { buildGeminiConversationRpcPayload } from "../src/platforms/google/gemini-rpc";

declare global {
  interface Window {
    __aiexporterGeminiBridgeInstalled?: boolean;
  }

  interface XMLHttpRequest {
    __aiexporterUrl?: string;
  }
}

function postDiscoveryPayloads(responseText: string): void {
  const events = extractGeminiPayloadsFromBatchedResponse(responseText, window.location.origin);
  events.forEach((event) => {
    window.postMessage(
      {
        source: "aiexporter",
        type: "gemini-network-discovery",
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
  return url.includes("/_/BardChatUi/data/batchexecute") && url.includes("rpcids=MaZiqc");
}

function getGeminiGlobalData(): Record<string, unknown> | null {
  const candidate = (window as typeof window & { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function buildGeminiConversationRpcUrl(sourceId: string): string {
  const globals = getGeminiGlobalData();
  const bl = typeof globals?.cfb2h === "string" ? globals.cfb2h : "";
  const fSid = typeof globals?.FdrFJe === "string" ? globals.FdrFJe : "";
  const basePath = typeof globals?.eptZe === "string" ? globals.eptZe : "/_/BardChatUi/";
  const hl = document.documentElement.lang || navigator.language || "en";
  const url = new URL(`${basePath}data/batchexecute`, window.location.origin);
  url.searchParams.set("rpcids", "hNvQHb");
  url.searchParams.set("source-path", `/app/${sourceId}`);
  if (bl) url.searchParams.set("bl", bl);
  if (fSid) url.searchParams.set("f.sid", fSid);
  url.searchParams.set("hl", hl);
  url.searchParams.set("_reqid", String(Math.floor(1_500_000 + Math.random() * 100_000)));
  url.searchParams.set("rt", "c");
  return url.toString();
}

function buildGeminiConversationRpcBody(sourceId: string): URLSearchParams {
  const globals = getGeminiGlobalData();
  const at = typeof globals?.SNlM0e === "string" ? globals.SNlM0e : "";
  const params = new URLSearchParams();
  params.set("f.req", buildGeminiConversationRpcPayload(sourceId));
  if (at) {
    params.set("at", at);
  }
  return params;
}

export default defineUnlistedScript(() => {
  if (window.__aiexporterGeminiBridgeInstalled) return;
  window.__aiexporterGeminiBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = normalizeUrl(args[0]);

    if (shouldInspect(url)) {
      const cloned = response.clone();
      void cloned
        .text()
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
      postDiscoveryPayloads(this.responseText);
    });

    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; requestId?: string; sourceId?: string } | undefined;
    const messageType = typeof data?.type === "string" ? data.type : "";
    if (data?.source !== "aiexporter" || messageType !== "aiexporter.gemini.fetch-conversation") return;

    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const sourceId = typeof data.sourceId === "string" ? data.sourceId : "";
    if (!requestId || !sourceId) return;

    void fetch(buildGeminiConversationRpcUrl(sourceId), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: buildGeminiConversationRpcBody(sourceId),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Gemini hNvQHb responded with ${response.status}.`);
        }
        return response.text();
      })
      .then((data) => {
        window.postMessage(
          {
            source: "aiexporter",
            type: "gemini-page-api-response",
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
            type: "gemini-page-api-response",
            requestId,
            sourceId,
            response: {
              ok: false,
              error: error instanceof Error ? error.message : "Gemini hNvQHb request failed.",
            },
          },
          window.location.origin,
        );
      });
  });
});
