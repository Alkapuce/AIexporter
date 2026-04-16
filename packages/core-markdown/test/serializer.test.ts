import { describe, expect, it } from "vitest";
import type { ConversationBundle } from "@aiexporter/core-schema";
import { serializeConversation } from "../src/serializer";

const EXPECTED_EXPORT_COMPATIBILITY_VERSION = "2026-04-15.2";

describe("serializeConversation", () => {
  it("renders frontmatter and message sections", () => {
    const bundle: ConversationBundle = {
      platform: "chatgpt",
      sourceId: "conv-1",
      url: "https://chatgpt.com/c/conv-1",
      title: "Sample Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      sourceUpdatedAt: "2026-03-18T07:59:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "ChatGPT" },
      ],
      messages: [
        { id: "m1", role: "user", markdown: "Hello" },
        { id: "m2", role: "assistant", markdown: "Hi there" },
      ],
    };

    const result = serializeConversation(bundle, { revision: "abc123" });

    expect(result.messageCount).toBe(2);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.markdown).toContain("aiexporter: v2");
    expect(result.markdown).toContain(`export_compatibility_version: "${EXPECTED_EXPORT_COMPATIBILITY_VERSION}"`);
    expect(result.markdown).toContain("conversation_id: conv-1");
    expect(result.markdown).toContain("# Sample Chat");
    expect(result.markdown).toContain('assistant: "ChatGPT"');
    expect(result.markdown).toContain("> Source: chatgpt");
    expect(result.markdown).toContain("Revision: abc123");
    expect(result.markdown).toContain(`Compatibility: ${EXPECTED_EXPORT_COMPATIBILITY_VERSION}`);
    expect(result.markdown).toContain("## User");
    expect(result.markdown).toContain("## Assistant");
  });

  it("renders message timestamps in a user-friendly local format", () => {
    const bundle: ConversationBundle = {
      platform: "chatgpt",
      sourceId: "conv-timestamps",
      url: "https://chatgpt.com/c/conv-timestamps",
      title: "Timestamp Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "ChatGPT" },
      ],
      messages: [
        { id: "m1", role: "user", markdown: "Hello", createdAt: "2026-03-18T07:59:00.000Z" },
      ],
    };

    const result = serializeConversation(bundle, { revision: "time123" });
    expect(result.markdown).toMatch(/> 20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)/);
  });

  it("handles unexpected null frontmatter fields defensively", () => {
    const bundle = {
      platform: "deepseek",
      sourceId: "conv-null",
      url: "https://chat.deepseek.com/a/chat/s/conv-null",
      title: null,
      extractedAt: "2026-03-18T08:00:00.000Z",
      sourceUpdatedAt: null,
      participants: [{ id: "assistant", role: "assistant", name: "DeepSeek" }],
      messages: [{ id: "m1", role: "assistant", markdown: "Hello" }],
    } as unknown as ConversationBundle;

    const result = serializeConversation(bundle, { revision: "null123" });

    expect(result.markdown).toContain('title: ""');
    expect(result.markdown).toContain('source_updated_at: ""');
    expect(result.markdown).toContain("## Assistant");
  });

  it("supports compact formatting", () => {
    const bundle: ConversationBundle = {
      platform: "deepseek",
      sourceId: "conv-compact",
      url: "https://chat.deepseek.com/a/chat/s/conv-compact",
      title: "Compact Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      sourceUpdatedAt: "2026-03-18T07:59:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "DeepSeek" },
      ],
      messages: [
        {
          id: "m1",
          role: "assistant",
          markdown: "```ts\n// comment only\nconst x = 1;\n\n# comment\nreturn x;\n```",
        },
      ],
    };

    const result = serializeConversation(bundle, { revision: "compact123", format: "compact" });

    expect(result.markdown).toContain("const x = 1;");
    expect(result.markdown).toContain("return x;");
    expect(result.markdown).not.toContain("// comment only");
  });

  it("supports code-only formatting", () => {
    const bundle: ConversationBundle = {
      platform: "chatgpt",
      sourceId: "conv-code",
      url: "https://chatgpt.com/c/conv-code",
      title: "Code Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      sourceUpdatedAt: "2026-03-18T07:59:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
        { id: "assistant", role: "assistant", name: "ChatGPT" },
      ],
      messages: [
        { id: "m1", role: "user", markdown: "No code here" },
        { id: "m2", role: "assistant", markdown: "```python\nprint('hi')\n```" },
      ],
    };

    const result = serializeConversation(bundle, { revision: "code123", format: "code-only" });

    expect(result.messageCount).toBe(1);
    expect(result.markdown).toContain("```python");
    expect(result.markdown).not.toContain("No code here");
  });

  it("renders thinking blocks as collapsed details sections", () => {
    const bundle: ConversationBundle = {
      platform: "deepseek",
      sourceId: "conv-thinking",
      url: "https://chat.deepseek.com/a/chat/s/conv-thinking",
      title: "Thinking Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      participants: [
        { id: "assistant", role: "assistant", name: "DeepSeek" },
      ],
      messages: [
        {
          id: "m1",
          role: "assistant",
          markdown: "> [thinking]\n> first line\n> second line\n\nFinal answer",
        },
      ],
    };

    const result = serializeConversation(bundle, { revision: "thinking123" });
    expect(result.markdown).toContain("<details>");
    expect(result.markdown).toContain("<summary>Thinking</summary>");
    expect(result.markdown).toContain("first line");
    expect(result.markdown).toContain("Final answer");
  });

  it("wraps bare URLs so surrounding CJK text does not merge into the link", () => {
    const bundle: ConversationBundle = {
      platform: "aistudio",
      sourceId: "conv-bare-url",
      url: "https://aistudio.google.com/prompts/conv-bare-url",
      title: "Bare URL Chat",
      extractedAt: "2026-03-18T08:00:00.000Z",
      participants: [
        { id: "user", role: "user", name: "User" },
      ],
      messages: [
        {
          id: "m1",
          role: "user",
          markdown: "另外https://unstats.un.org/sdgs/UNSDGAPIV5/swagger/index.html上好像有api",
        },
      ],
    };

    const result = serializeConversation(bundle, { revision: "bare-url-123" });
    expect(result.markdown).toContain("<https://unstats.un.org/sdgs/UNSDGAPIV5/swagger/index.html>");
    expect(result.markdown).toContain("上好像有api");
  });
});
