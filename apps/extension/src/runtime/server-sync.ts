import { IngestConversationResponseSchema, type ConversationBundle } from "@aiexporter/core-schema";
import type { ExtensionSettings } from "@aiexporter/adapter-sdk";

export async function syncBundleToServer(
  bundle: ConversationBundle,
  settings: ExtensionSettings,
  extensionVersion: string,
): Promise<void> {
  if (!settings.syncToServer) return;

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
