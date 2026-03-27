import { describe, expect, it } from "vitest";
import { parseHistoryResponse } from "./adapter";
import { extractDiscoveryPayloadsFromResponse, extractSessionIdFromUrl } from "./discovery";

describe("deepseek discovery", () => {
  it("extracts the session id from a DeepSeek conversation URL", () => {
    expect(extractSessionIdFromUrl("https://chat.deepseek.com/a/chat/s/demo-123")).toBe("demo-123");
  });

  it("extracts discovery payloads from history responses", () => {
    const payloads = extractDiscoveryPayloadsFromResponse({
      code: 0,
      data: {
        biz_data: {
          chat_session: {
            id: "session-1",
            title: "DeepSeek test",
          },
          chat_messages: [{ role: "USER", content: "Hi", inserted_at: "2026-03-18T10:00:00.000Z" }],
        },
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.sourceId).toBe("session-1");
    expect(payloads[0]?.url).toContain("/a/chat/s/session-1");
  });

  it("normalizes numeric timestamps from history responses", () => {
    const payloads = extractDiscoveryPayloadsFromResponse({
      code: 0,
      data: {
        biz_data: {
          chat_session: {
            id: "session-2",
            title: "Numeric time",
            updated_at: 1740334194.343,
          },
        },
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.sourceUpdatedAt).toBe("2025-02-23T18:09:54.343Z");
  });

  it("parses history responses into a bundle", () => {
    const bundle = parseHistoryResponse(
      {
        code: 0,
        data: {
          biz_data: {
            chat_session: {
              id: "session-1",
              title: "DeepSeek test",
            },
            chat_messages: [
              {
                message_id: 1,
                role: "USER",
                content: "Hello",
                inserted_at: "2026-03-18T10:00:00.000Z",
              },
              {
                message_id: 2,
                role: "ASSISTANT",
                content: "Hi there",
                inserted_at: "2026-03-18T10:00:01.000Z",
              },
            ],
          },
        },
      },
      "https://chat.deepseek.com/a/chat/s/session-1",
      "session-1",
    );

    expect(bundle.platform).toBe("deepseek");
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.sourceUpdatedAt).toBe("2026-03-18T10:00:01.000Z");
  });

  it("parses fragment-only and thinking messages into markdown", () => {
    const bundle = parseHistoryResponse(
      {
        code: 0,
        data: {
          biz_data: {
            chat_session: {
              id: "session-3",
              title: "Fragments",
            },
            chat_messages: [
              {
                message_id: 1,
                role: "USER",
                fragments: [{ type: "REQUEST", content: "Question from fragment" }],
                inserted_at: 1740334020.198,
              },
              {
                message_id: 2,
                role: "ASSISTANT",
                fragments: [
                  { type: "THINK", content: "Reasoning line 1\nReasoning line 2" },
                  { type: "TEXT", content: "Final answer" },
                ],
                inserted_at: 1740334021.198,
              },
            ],
          },
        },
      },
      "https://chat.deepseek.com/a/chat/s/session-3",
      "session-3",
    );

    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[0]?.markdown).toBe("Question from fragment");
    expect(bundle.messages[1]?.markdown).toContain("> [thinking]");
    expect(bundle.messages[1]?.markdown).toContain("Final answer");
    expect(bundle.sourceUpdatedAt).toBe("2025-02-23T18:07:01.198Z");
  });
});
