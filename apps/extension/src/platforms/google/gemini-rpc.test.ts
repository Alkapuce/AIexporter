import { describe, expect, it } from "vitest";
import { buildGeminiConversationRpcPayload, GEMINI_CONVERSATION_FETCH_LIMIT } from "./gemini-rpc";

describe("gemini rpc helpers", () => {
  it("requests substantially more than the last 10 Gemini turns", () => {
    const payload = JSON.parse(buildGeminiConversationRpcPayload("98c617fa8bc7844f")) as unknown[];
    expect(Array.isArray(payload)).toBe(true);

    const rpcEntry = Array.isArray(payload[0]) && Array.isArray(payload[0][0]) ? payload[0][0] : [];
    const requestArgs = typeof rpcEntry[1] === "string" ? (JSON.parse(rpcEntry[1]) as unknown[]) : [];

    expect(requestArgs[0]).toBe("c_98c617fa8bc7844f");
    expect(requestArgs[1]).toBe(GEMINI_CONVERSATION_FETCH_LIMIT);
    expect(requestArgs[1]).toBeGreaterThan(10);
  });
});
