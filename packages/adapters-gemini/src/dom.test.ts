import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractAiStudioConversationFromDom, extractGeminiConversationFromDom } from "./dom";

describe("google platform DOM extraction", () => {
  it("extracts Gemini turns from DOM", () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Planning Session | Google Gemini</title></head>
          <body>
            <div data-test-id="conversation-title">Planning Session</div>
            <main>
              <div class="query-text gds-body-l">Hello Gemini</div>
              <structured-content-container class="model-response-text">
                <message-content>
                  <p>Hi there</p>
                  <pre><code class="language-ts">const plan = true;</code></pre>
                </message-content>
              </structured-content-container>
            </main>
          </body>
        </html>
      `,
      { url: "https://gemini.google.com/app/conv-123" },
    );

    const bundle = extractGeminiConversationFromDom(dom.window.document, dom.window.location.href, "conv-123");

    expect(bundle.platform).toBe("gemini");
    expect(bundle.title).toBe("Planning Session");
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[1]?.markdown).toContain("```ts");
  });

  it("falls back to the active Gemini history item for title resolution", () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Google Gemini</title></head>
          <body>
            <aside>
              <a href="/app/conv-123" aria-current="page">Sidebar Title</a>
            </aside>
            <main>
              <div class="query-text gds-body-l">Hello Gemini</div>
              <structured-content-container>
                <message-content><p>Hi from Gemini</p></message-content>
              </structured-content-container>
            </main>
          </body>
        </html>
      `,
      { url: "https://gemini.google.com/app/conv-123" },
    );

    const bundle = extractGeminiConversationFromDom(dom.window.document, dom.window.location.href, "conv-123");

    expect(bundle.title).toBe("Sidebar Title");
  });

  it("falls back to the first Gemini user prompt when page title is generic", () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Google Gemini</title></head>
          <body>
            <main>
              <div class="query-text gds-body-l">
                美国主要城市气候介绍，和中国城市类比
              </div>
              <structured-content-container>
                <message-content><p>这里是一段回复。</p></message-content>
              </structured-content-container>
            </main>
          </body>
        </html>
      `,
      { url: "https://gemini.google.com/app/conv-generic-title" },
    );

    const bundle = extractGeminiConversationFromDom(dom.window.document, dom.window.location.href, "conv-generic-title");

    expect(bundle.title).toBe("美国主要城市气候介绍，和中国城市类比");
  });

  it("extracts AI Studio turns and metadata from DOM", async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Prompt Test | Google AI Studio</title></head>
          <body>
            <div data-test-id="model-name">Gemini 2.5 Pro</div>
            <div class="settings-item">
              <div class="item-description-title">System instructions</div>
              <div>Answer in Chinese.</div>
            </div>
            <div class="settings-item">
              <div class="item-description-title">Temperature</div>
              <div>0.2</div>
            </div>
            <div class="settings-tool">
              <div class="item-description-title">Google Search</div>
            </div>
            <ms-chat-turn id="turn-user">
              <div class="chat-turn-container user">
                <div class="user-prompt-container">
                  <textarea>帮我解释一下热毒</textarea>
                </div>
              </div>
            </ms-chat-turn>
            <ms-chat-turn id="turn-assistant">
              <div class="chat-turn-container model">
                <div class="model-prompt-container">
                  <ms-thought-chunk>
                    <div class="thought-collapsed-text-container">Thoughts</div>
                    <p>Comparing TCM and modern medicine.</p>
                  </ms-thought-chunk>
                  <ms-text-chunk>
                    <p>可以从中医和现代医学两方面理解。</p>
                  </ms-text-chunk>
                </div>
              </div>
            </ms-chat-turn>
          </body>
        </html>
      `,
      { url: "https://aistudio.google.com/prompts/prompt-123" },
    );

    const bundle = await extractAiStudioConversationFromDom(dom.window.document, dom.window.location.href, "prompt-123");

    expect(bundle.platform).toBe("aistudio");
    expect(bundle.meta?.model).toBe("Gemini 2.5 Pro");
    expect(bundle.meta?.systemInstructions).toContain("Answer in Chinese.");
    expect(bundle.meta?.temperature).toContain("0.2");
    expect(bundle.meta?.tools).toEqual(["Google Search"]);
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.messages[0]?.markdown).toContain("帮我解释一下热毒");
    expect(bundle.messages[1]?.markdown).toContain("> [thinking]");
    expect(bundle.messages[1]?.markdown).toContain("Comparing TCM and modern medicine.");
    expect(bundle.messages[1]?.markdown).not.toContain("Thoughts");
    expect(bundle.messages[1]?.markdown).toContain("可以从中医和现代医学两方面理解");
  });

  it("falls back to prompt title when AI Studio user turn text is not accessible", async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>Prompt Missing User | Google AI Studio</title></head>
          <body>
            <ms-chat-turn id="turn-assistant">
              <div class="chat-turn-container model">
                <div class="model-prompt-container">
                  <ms-thought-chunk>
                    <p>Drafting answer.</p>
                  </ms-thought-chunk>
                </div>
              </div>
            </ms-chat-turn>
          </body>
        </html>
      `,
      { url: "https://aistudio.google.com/prompts/prompt-missing-user" },
    );

    const bundle = await extractAiStudioConversationFromDom(
      dom.window.document,
      dom.window.location.href,
      "prompt-missing-user",
    );

    expect(bundle.messages[0]).toMatchObject({
      role: "user",
      markdown: "Prompt Missing User",
    });
    expect(bundle.messages[1]?.markdown).toContain("> [thinking]");
  });
});
