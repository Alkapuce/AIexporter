import { IngestConversationResponseSchema, type ConversationBundle } from "@aiexporter/core-schema";
import type { ExtensionSettings } from "@aiexporter/adapter-sdk";

export async function syncBundleToServer(
  bundle: ConversationBundle,
  settings: ExtensionSettings,
  extensionVersion: string,
): Promise<void> {
  if (!settings.syncToServer) return;

  // Validate server URL is localhost-only
  if (!URL.canParse(settings.serverUrl)) {
    console.warn(`[AIexporter] Server sync blocked: invalid serverUrl "${settings.serverUrl}"`);
    return;
  }
  const parsedUrl = new URL(settings.serverUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
    console.warn(`[AIexporter] Server sync blocked: serverUrl must be localhost, got ${parsedUrl.hostname}`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${settings.serverUrl}/api/v1/ingest/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bundle,
        client: {
          extensionVersion,
          browser: settings.browserLabel,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Server sync failed with HTTP ${response.status}.`);
    }

    IngestConversationResponseSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
