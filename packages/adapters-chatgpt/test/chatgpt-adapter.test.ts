import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { chatgptAdapter } from "../src/adapter";
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
});
