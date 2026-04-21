import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseGeminiConversationFromHnvQHbResponse } from "./adapter";
import {
  extractAiStudioPayloadsFromDocument,
  extractAiStudioPayloadsFromListPromptsResponse,
  extractAiStudioPromptIdFromUrl,
  extractGeminiConversationIdFromUrl,
  extractGeminiPayloadsFromBatchedResponse,
  extractGeminiPayloadsFromDocument,
} from "./discovery";

describe("google platform discovery", () => {
  it("extracts Gemini conversation ids from URLs", () => {
    expect(extractGeminiConversationIdFromUrl("https://gemini.google.com/app/abc123")).toBe("abc123");
    expect(extractGeminiConversationIdFromUrl("https://gemini.google.com/app")).toBeNull();
    expect(extractGeminiConversationIdFromUrl("https://gemini.google.com/app/mystuff")).toBeNull();
  });

  it("extracts AI Studio prompt ids from URLs", () => {
    expect(extractAiStudioPromptIdFromUrl("https://aistudio.google.com/prompts/prompt-123")).toBe("prompt-123");
    expect(extractAiStudioPromptIdFromUrl("https://aistudio.google.com/prompts/new_chat")).toBeNull();
  });

  it("extracts Gemini history payloads from DOM links", () => {
    const dom = new JSDOM(`
      <body>
        <div class="history-item">
          <a href="/app/conv-1">First Gemini Chat</a>
          <span>2 days ago</span>
        </div>
        <div class="history-item">
          <a href="/app/conv-2?aiexporter_worker=1">Second Gemini Chat</a>
          <span>Yesterday</span>
        </div>
        <a href="/app">New chat</a>
      </body>
    `);

    expect(extractGeminiPayloadsFromDocument(dom.window.document)).toEqual([
      {
        sourceId: "conv-1",
        sourceUpdatedLabel: "2 days ago",
        title: "First Gemini Chat",
        url: "https://gemini.google.com/app/conv-1",
      },
      {
        sourceId: "conv-2",
        sourceUpdatedLabel: "Yesterday",
        title: "Second Gemini Chat",
        url: "https://gemini.google.com/app/conv-2",
      },
    ]);
  });

  it("extracts AI Studio history payloads from DOM links", () => {
    const dom = new JSDOM(`
      <body>
        <div role="row" class="mat-mdc-row">
          <div class="mat-column-name"><a href="/prompts/prompt-1">Prompt One</a></div>
          <div class="mat-column-updated">6 hours ago</div>
        </div>
        <a href="/prompts/new_chat">New Prompt</a>
        <div role="row" class="mat-mdc-row">
          <div class="mat-column-name"><a href="/prompts/prompt-2">Prompt Two</a></div>
          <div class="mat-column-updated">Yesterday</div>
        </div>
      </body>
    `);

    expect(extractAiStudioPayloadsFromDocument(dom.window.document)).toEqual([
      {
        sourceId: "prompt-1",
        sourceUpdatedLabel: "6 hours ago",
        title: "Prompt One",
        url: "https://aistudio.google.com/prompts/prompt-1",
      },
      {
        sourceId: "prompt-2",
        sourceUpdatedLabel: "Yesterday",
        title: "Prompt Two",
        url: "https://aistudio.google.com/prompts/prompt-2",
      },
    ]);
  });

  it("extracts AI Studio history payloads from ListPrompts responses", () => {
    const response = JSON.stringify([
      [
        [
          "prompts/prompt-1",
          null,
          null,
          null,
          [
            "Prompt One",
            null,
            ["peijin qiu", 1, "https://example.com/avatar.png"],
            null,
            [["1775658791", 874000000], ["peijin qiu", 1, "https://example.com/avatar.png"]],
          ],
        ],
        [
          "prompts/prompt-2",
          null,
          null,
          null,
          [
            "Prompt Two",
            null,
            ["peijin qiu", 1, "https://example.com/avatar.png"],
            null,
            [["1775640848", 973000000], ["peijin qiu", 1, "https://example.com/avatar.png"]],
          ],
        ],
      ],
      "~!!~cursor-2",
    ]);

    expect(extractAiStudioPayloadsFromListPromptsResponse(response)).toEqual({
      payloads: [
        {
          sourceId: "prompt-1",
          title: "Prompt One",
          url: "https://aistudio.google.com/prompts/prompt-1",
          sourceUpdatedAt: "2026-04-08T14:33:11.874Z",
        },
        {
          sourceId: "prompt-2",
          title: "Prompt Two",
          url: "https://aistudio.google.com/prompts/prompt-2",
          sourceUpdatedAt: "2026-04-08T09:34:08.973Z",
        },
      ],
      nextCursor: "~!!~cursor-2",
    });
  });

  it("extracts Gemini history payloads from batched responses", () => {
    const response = String.raw`)]}'

1667
[["wrb.fr","MaZiqc","[null,\"token\",[[\"c_07374124195681dd\",\"导体静电平衡原理讨论\",null,null,null,[1775572077,285944000],null,null,null,2],[\"c_02becacfd54705d0\",\"充电电容器储能计算\",null,null,null,[1775572004,569120000],null,null,null,2]]",null,null,null,"generic"]]`;

    expect(extractGeminiPayloadsFromBatchedResponse(response)).toEqual([
      {
        sourceId: "07374124195681dd",
        title: "导体静电平衡原理讨论",
        url: "https://gemini.google.com/app/07374124195681dd",
        sourceUpdatedAt: "2026-04-07T14:27:57.285Z",
      },
      {
        sourceId: "02becacfd54705d0",
        title: "充电电容器储能计算",
        url: "https://gemini.google.com/app/02becacfd54705d0",
        sourceUpdatedAt: "2026-04-07T14:26:44.569Z",
      },
    ]);
  });

  it("extracts Gemini current conversation from hNvQHb batched responses", () => {
    const turns = [
      [
        ["c_abc123", "r_resp1"],
        null,
        [["第一问"], 2, null, 1, "trace-1", 0],
        [
          [
            [
              "resp-1",
              ["第一答复"],
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              [["**Thinking One**"]],
            ],
          ],
          null,
          null,
          "resp-1",
          null,
          null,
          null,
          null,
          null,
          [10, 10],
        ],
        [1775700000, 111000000],
      ],
      [
        ["c_abc123", "r_resp2"],
        null,
        [["第二问"], 2, null, 1, "trace-2", 0],
        [
          [
            [
              "resp-2",
              ["第二答复"],
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              [["**Thinking Two**"]],
            ],
          ],
          null,
          null,
          "resp-2",
          null,
          null,
          null,
          null,
          null,
          [10, 10],
        ],
        [1775700100, 222000000],
      ],
    ];
    const response = `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([turns, null, null, []]), null, null, null]])}`;

    const bundle = parseGeminiConversationFromHnvQHbResponse(
      response,
      "https://gemini.google.com/app/abc123",
      "abc123",
      "Gemini Thread",
    );

    expect(bundle.title).toBe("Gemini Thread");
    expect(bundle.messages).toHaveLength(4);
    expect(bundle.messages[0]?.markdown).toBe("第一问");
    expect(bundle.messages[1]?.markdown).toContain("第一答复");
    expect(bundle.messages[1]?.markdown).toContain("[thinking]");
  expect(bundle.messages[3]?.markdown).toContain("第二答复");
  expect(bundle.sourceUpdatedAt).toBe("2026-04-09T02:01:40.222Z");
  expect(bundle.meta?.source).toBe("page-world-rpc");
  });

  it("extracts Gemini uploaded image attachments from page-world RPC responses", () => {
    const turns = [
      [
        null,
        null,
        [
          [
            "带图提问",
            null,
            null,
            null,
            [
              [
                null,
                null,
                null,
                [
                  [
                    null,
                    1,
                    "photo-1.jpg",
                    "https://lh3.googleusercontent.com/gg/example-photo-1",
                    null,
                    "opaque-token",
                    null,
                    null,
                    6,
                    [1775700100, 111000000],
                    null,
                    "image/jpeg",
                    null,
                    null,
                    null,
                    [1000, 750, 123456],
                  ],
                ],
              ],
            ],
          ],
        ],
        [
          [
            [
              "resp-1",
              ["带图答复"],
            ],
          ],
        ],
        [1775700100, 111000000],
      ],
    ];
    const response = `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([turns, null, null, []]), null, null, null]])}`;

    const bundle = parseGeminiConversationFromHnvQHbResponse(
      response,
      "https://gemini.google.com/app/with-images",
      "with-images",
      "With Images",
    );

    expect(bundle.messages[0]?.markdown).toContain("![photo-1.jpg](https://lh3.googleusercontent.com/gg/example-photo-1)");
    expect(bundle.messages[0]?.markdown).toContain("带图提问");
  });

  it("orders Gemini RPC turns chronologically and removes inherited image attachments", () => {
    const turns = [
      [
        ["c_abc123", "r_resp2"],
        null,
        [
          [
            "第二问",
            null,
            null,
            null,
            [
              [
                null,
                null,
                null,
                [
                  [null, 1, "photo-1.jpg", "https://lh3.googleusercontent.com/gg/example-photo-1", null, "token-1", null, null, 6],
                  [null, 1, "photo-2.jpg", "https://lh3.googleusercontent.com/gg/example-photo-2", null, "token-2", null, null, 6],
                ],
              ],
            ],
          ],
        ],
        [
          [
            [
              "resp-2",
              ["第二答复"],
            ],
          ],
        ],
        [1775700200, 0],
      ],
      [
        ["c_abc123", "r_resp1"],
        null,
        [
          [
            "第一问",
            null,
            null,
            null,
            [
              [
                null,
                null,
                null,
                [
                  [null, 1, "photo-1.jpg", "https://lh3.googleusercontent.com/gg/example-photo-1", null, "token-1", null, null, 6],
                ],
              ],
            ],
          ],
        ],
        [
          [
            [
              "resp-1",
              ["第一答复"],
            ],
          ],
        ],
        [1775700100, 0],
      ],
    ];
    const response = `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([turns, null, null, []]), null, null, null]])}`;

    const bundle = parseGeminiConversationFromHnvQHbResponse(
      response,
      "https://gemini.google.com/app/abc123",
      "abc123",
      "Gemini Thread",
    );

    expect(bundle.messages).toHaveLength(4);
    expect(bundle.messages[0]?.markdown).toContain("第一问");
    expect(bundle.messages[0]?.markdown).toContain("photo-1.jpg");
    expect(bundle.messages[0]?.markdown).not.toContain("photo-2.jpg");
    expect(bundle.messages[2]?.markdown).toContain("第二问");
    expect(bundle.messages[2]?.markdown).toContain("photo-2.jpg");
    expect(bundle.messages[2]?.markdown).not.toContain("photo-1.jpg");
    expect(bundle.messages[3]?.markdown).toContain("第二答复");
    expect(bundle.sourceUpdatedAt).toBe("2026-04-09T02:03:20.000Z");
  });

  it("downgrades Gemini mini-app visualization blocks into interactive links", () => {
    const turns = [
      [
        ["c_demo", "r_demo"],
        null,
        [["解释这个磁场题"], 2, null, 1, "trace-demo", 0],
        [
          [
            [
              "resp-demo",
              [
                "先看这个可视化演示：\n\n```json\n{\"miniApp\":{\"spec\":\"...\",\"id\":\"im_demo123abc\"}}\n```\n\n再继续分析。",
              ],
            ],
          ],
        ],
        [1775700300, 0],
      ],
    ];
    const response = `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([turns, null, null, []]), null, null, null]])}`;

    const bundle = parseGeminiConversationFromHnvQHbResponse(
      response,
      "https://gemini.google.com/app/demo-conv",
      "demo-conv",
      "Demo Conversation",
    );

    expect(bundle.messages[1]?.markdown).toContain("> [interactive] [Open Gemini visualization demo (im_demo123abc)](https://gemini.google.com/app/demo-conv)");
    expect(bundle.messages[1]?.markdown).toContain("再继续分析。");
    expect(bundle.messages[1]?.markdown).not.toContain("\"miniApp\"");
  });
});
