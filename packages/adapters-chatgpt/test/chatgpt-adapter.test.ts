import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { chatgptAdapter, parseChatGptConversationResponse } from "../src/adapter";
import { extractDiscoveryPayloadsFromResponse } from "../src/discovery";

describe("chatgptAdapter", () => {
  it("extracts a conversation bundle from DOM", async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Planning Session | ChatGPT</title></head>
          <body>
            <main>
              <div data-testid="conversation-turn-1">
                <div data-message-author-role="user">
                  <div class="whitespace-pre-wrap">Hello ChatGPT</div>
                </div>
              </div>
              <div data-testid="conversation-turn-2">
                <div data-message-author-role="assistant">
                  <div class="markdown">
                    <p>Hi there</p>
                    <pre><code class="language-ts">const x = 1;</code></pre>
                  </div>
                  <time datetime="2026-03-18T08:00:00.000Z"></time>
                </div>
              </div>
            </main>
          </body>
        </html>
      `,
      { url: "https://chatgpt.com/c/conv-123" },
    );

    const bundle = await chatgptAdapter.extractCurrentConversation({
      document: dom.window.document,
      window: dom.window as unknown as Window,
      location: dom.window.location,
    });

    expect(bundle.sourceId).toBe("conv-123");
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[1]?.markdown).toContain("```ts");
  });

  it("preserves ChatGPT KaTeX as LaTeX instead of duplicated rendered text", async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Math Session | ChatGPT</title></head>
          <body>
            <main>
              <div data-testid="conversation-turn-1">
                <div data-message-author-role="assistant">
                  <div class="markdown">
                    <p>
                      行内公式
                      <span class="katex">
                        <span class="katex-mathml">
                          <math>
                            <semantics>
                              <mrow><mi>x</mi></mrow>
                              <annotation encoding="application/x-tex">\\frac{xy}{x^2+y^2}</annotation>
                            </semantics>
                          </math>
                        </span>
                        <span class="katex-html" aria-hidden="true">xy/x²+y²</span>
                      </span>
                    </p>
                    <div class="katex-display">
                      <span class="katex">
                        <span class="katex-mathml">
                          <math>
                            <semantics>
                              <mrow><mi>x</mi></mrow>
                              <annotation encoding="application/x-tex">\\lim_{x \\to 0} f(x)</annotation>
                            </semantics>
                          </math>
                        </span>
                        <span class="katex-html" aria-hidden="true">lim x→0 f(x)</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </main>
          </body>
        </html>
      `,
      { url: "https://chatgpt.com/c/conv-math" },
    );

    const bundle = await chatgptAdapter.extractCurrentConversation({
      document: dom.window.document,
      window: dom.window as unknown as Window,
      location: dom.window.location,
    });

    expect(bundle.messages[0]?.markdown).toContain("$\\frac{xy}{x^2+y^2}$");
    expect(bundle.messages[0]?.markdown).toContain("$$\n\\lim_{x \\to 0} f(x)\n$$");
    expect(bundle.messages[0]?.markdown).not.toContain("xy/x²+y²");
    expect(bundle.messages[0]?.markdown).not.toContain("lim x→0 f(x)");
  });

  it("extracts discovery payloads from list responses", () => {
    const payloads = extractDiscoveryPayloadsFromResponse({
      items: [
        {
          id: "conv-123",
          title: "Planning",
          update_time: "2026-03-18T08:00:00.000Z",
        },
      ],
    });

    expect(payloads[0]?.sourceId).toBe("conv-123");
    expect(payloads[0]?.url).toBe("https://chatgpt.com/c/conv-123");
  });

  it("extracts a conversation bundle from the ChatGPT backend API payload", () => {
    const bundle = parseChatGptConversationResponse(
      {
        id: "conv-123",
        title: "Planning",
        current_node: "node-3",
        update_time: "2026-03-18T08:05:00.000Z",
        mapping: {
          "node-1": {
            id: "node-1",
            parent: null,
          },
          "node-2": {
            id: "node-2",
            parent: "node-1",
            message: {
              id: "msg-user",
              author: { role: "user" },
              create_time: "2026-03-18T08:00:00.000Z",
              content: {
                parts: ["Hello ChatGPT"],
              },
            },
          },
          "node-3": {
            id: "node-3",
            parent: "node-2",
            message: {
              id: "msg-assistant",
              author: { role: "assistant" },
              create_time: "2026-03-18T08:01:00.000Z",
              content: {
                parts: ["Hi there", { text: "How can I help?" }],
              },
            },
          },
        },
      },
      "https://chatgpt.com/c/conv-123",
      "conv-123",
    );

    expect(bundle.title).toBe("Planning");
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[0]?.markdown).toBe("Hello ChatGPT");
    expect(bundle.messages[1]?.markdown).toContain("How can I help?");
    expect(bundle.meta?.source).toBe("api");
  });
});
