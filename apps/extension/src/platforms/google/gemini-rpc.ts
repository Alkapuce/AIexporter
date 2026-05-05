export const GEMINI_CONVERSATION_FETCH_LIMIT = 1000;

export function buildGeminiConversationRpcPayload(sourceId: string, limit = GEMINI_CONVERSATION_FETCH_LIMIT): string {
  return JSON.stringify([
    [["hNvQHb", JSON.stringify([`c_${sourceId}`, limit, null, 1, [0], [4], null, 1]), null, "generic"]],
  ]);
}
