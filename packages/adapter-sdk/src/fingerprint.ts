import type { ConversationBundle } from "@aiexporter/core-schema";
import type { BridgeNetworkPayload } from "./types";

const encoder = new TextEncoder();

async function toSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildDiscoveryFingerprint(
  platform: string,
  payload: BridgeNetworkPayload,
): Promise<string> {
  return toSha256Hex([platform, payload.sourceId, payload.sourceUpdatedAt ?? ""].join("::"));
}

export async function buildBundleRevision(bundle: ConversationBundle): Promise<string> {
  const messageSignature = bundle.messages
    .map((message) => `${message.id}:${message.role}:${message.markdown}`)
    .join("\n");
  return toSha256Hex(
    [
      bundle.platform,
      bundle.sourceId,
      bundle.url,
      bundle.title ?? "",
      bundle.sourceUpdatedAt ?? "",
      messageSignature,
    ].join("::"),
  );
}
