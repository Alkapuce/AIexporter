export function normalizeConversationUrl(input: string): string {
  const normalized = new URL(input);
  normalized.searchParams.delete("aiexporter_worker");
  normalized.searchParams.delete("aiexporter_discovery");
  return normalized.toString();
}
