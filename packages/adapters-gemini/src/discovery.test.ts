import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  extractAiStudioPayloadsFromDocument,
  extractAiStudioPromptIdFromUrl,
  extractGeminiConversationIdFromUrl,
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
        <a href="/app/conv-1">First Gemini Chat</a>
        <a href="/app/conv-2?aiexporter_worker=1">Second Gemini Chat</a>
        <a href="/app">New chat</a>
      </body>
    `);

    expect(extractGeminiPayloadsFromDocument(dom.window.document)).toEqual([
      {
        sourceId: "conv-1",
        title: "First Gemini Chat",
        url: "https://gemini.google.com/app/conv-1",
      },
      {
        sourceId: "conv-2",
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
});
