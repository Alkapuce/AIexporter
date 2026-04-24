import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@aiexporter/adapters-gemini", () => ({
  aiStudioAdapter: {},
  extractAiStudioConversationFromDom: vi.fn(),
  extractAiStudioConversationFromResolvedPromptPayload: vi.fn(),
  extractAiStudioPayloadsFromListPromptsResponse: vi.fn(),
  extractAiStudioPayloadsFromDocument: vi.fn(),
  extractAiStudioPromptIdFromUrl: vi.fn(),
}));

vi.mock("../google/content-runtime", () => ({
  mountGoogleContentRuntime: vi.fn(),
}));

describe("materializeAiStudioDomImageMarkdown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts AI Studio blob image markdown into data URLs before persistence", async () => {
    const { materializeAiStudioDomImageMarkdown } =
      await import("./content-runtime");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "image/png" : null,
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      }),
    );

    await expect(
      materializeAiStudioDomImageMarkdown(
        "![splashes_1.7.10.htm](blob:https://aistudio.google.com/blob-123)",
      ),
    ).resolves.toBe("![splashes_1.7.10.htm](data:image/png;base64,AQIDBA==)");
  });

  it("keeps concurrent markdown image rewrites isolated", async () => {
    const { materializeAiStudioDomImageMarkdown } =
      await import("./content-runtime");
    let resolveFirstFetch:
      | ((response: {
          ok: true;
          headers: { get: (name: string) => string | null };
          arrayBuffer: () => Promise<ArrayBuffer>;
        }) => void)
      | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn((target: string) => {
        const response = {
          ok: true as const,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-type" ? "image/png" : null,
          },
          arrayBuffer: async () =>
            Uint8Array.from([
              target.includes("one-b") ? 2 : target.includes("two-a") ? 3 : 1,
            ]).buffer,
        };
        if (target.includes("one-a")) {
          return new Promise((resolve) => {
            resolveFirstFetch = resolve;
          });
        }
        return Promise.resolve(response);
      }),
    );

    const first = materializeAiStudioDomImageMarkdown(
      "first ![one-a](blob:https://aistudio.google.com/one-a) ![one-b](blob:https://aistudio.google.com/one-b)",
    );
    await Promise.resolve();

    const second = materializeAiStudioDomImageMarkdown(
      "second ![two-a](blob:https://aistudio.google.com/two-a)",
    );
    await expect(second).resolves.toBe(
      "second ![two-a](data:image/png;base64,Aw==)",
    );

    resolveFirstFetch?.({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "image/png" : null,
      },
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    });

    await expect(first).resolves.toBe(
      "first ![one-a](data:image/png;base64,AQ==) ![one-b](data:image/png;base64,Ag==)",
    );
  });
});
