import { describe, expect, it } from "vitest";
import { extractAiStudioConversationFromResolvedPromptPayload } from "./aistudio-response";

describe("extractAiStudioConversationFromResolvedPromptPayload", () => {
  it("extracts user text, thought blocks, assistant text, and inline image attachments", () => {
    const payload = [
      [
        "prompts/test-source",
        null,
        null,
        [1, null, "models/gemini-3-flash-preview"],
        [
          "Prompt Title",
          null,
          null,
          null,
          [["1775640848", 973000000]],
          null,
          null,
          null,
          null,
          null,
          [
            ["promptType", "CHUNKED_PROMPT"],
            ["hasImages", "true"],
          ],
        ],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [
          [
            "User asks a question",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "user",
          ],
          [
            "**Analyzing the Problem**\n\nFirst paragraph.\n\nSecond paragraph.",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "model",
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
            1,
            null,
            null,
            null,
            null,
            null,
            -1,
          ],
          [
            "Final answer body.",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "model",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            1,
            null,
            42,
          ],
          [
            null,
            null,
            null,
            ["drive-file-id"],
            null,
            null,
            null,
            null,
            "user",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            99,
            null,
            null,
            null,
            null,
            ["image/png", "aGVsbG8="],
          ],
        ],
      ],
    ];

    const bundle = extractAiStudioConversationFromResolvedPromptPayload(
      payload,
      "https://aistudio.google.com/prompts/test-source",
      "test-source",
    );

    expect(bundle.title).toBe("Prompt Title");
    expect(bundle.meta?.model).toBe("models/gemini-3-flash-preview");
    expect(bundle.messages).toHaveLength(4);
    expect(bundle.messages[1]?.markdown).toContain("> [thinking]");
    expect(bundle.messages[1]?.markdown).toContain("> **Analyzing the Problem**");
    expect(bundle.messages[2]?.markdown).toContain("Final answer body.");
    expect(bundle.messages[3]?.markdown).toContain("data:image/png;base64,aGVsbG8=");
    expect(bundle.messages[3]?.markdown).toContain("[Google Drive resource drive-file-id](https://drive.google.com/open?id=drive-file-id)");
    expect(Array.isArray(bundle.meta?.linkedAttachments)).toBe(true);
  });

  it("extracts AI Studio image attachments from alternate attachment slots", () => {
    const payload = [
      [
        "prompts/with-alt-attachments",
        null,
        null,
        [1, null, "models/gemini-3-flash-preview"],
        [
          "Prompt With Alt Attachments",
          null,
          null,
          null,
          [["1775700946", 126000000]],
        ],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [
          [
            null,
            ["154bWp5-VfdWk0ehEmAhfraDL2rtY-voj"],
            null,
            null,
            null,
            null,
            null,
            null,
            "user",
            null,
            null,
            null,
            ["image/png", "aGVsbG8="],
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
            ["1775700946", 126000000],
          ],
        ],
      ],
    ];

    const bundle = extractAiStudioConversationFromResolvedPromptPayload(
      payload,
      "https://aistudio.google.com/prompts/with-alt-attachments",
      "with-alt-attachments",
    );

    expect(bundle.messages).toHaveLength(1);
    expect(bundle.messages[0]?.markdown).toContain("data:image/png;base64,aGVsbG8=");
    expect(bundle.messages[0]?.markdown).toContain(
      "[Google Drive resource 154bWp5-VfdWk0ehEmAhfraDL2rtY-voj](https://drive.google.com/open?id=154bWp5-VfdWk0ehEmAhfraDL2rtY-voj)",
    );
  });

  it("renders text attachments with safe fenced blocks", () => {
    const csvPayload = Buffer.from("Year,Value\n2024,1\n2025,2", "utf8").toString("base64");
    const payload = [
      [
        "prompts/with-text-attachments",
        null,
        null,
        [1, null, "models/gemini-3-flash-preview"],
        [
          "Prompt With Text Attachments",
          null,
          null,
          null,
          [["1775700946", 126000000]],
        ],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [
          [
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "user",
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
            ["text/csv", csvPayload],
          ],
        ],
      ],
    ];

    const bundle = extractAiStudioConversationFromResolvedPromptPayload(
      payload,
      "https://aistudio.google.com/prompts/with-text-attachments",
      "with-text-attachments",
    );

    expect(bundle.messages).toHaveLength(1);
    expect(bundle.messages[0]?.markdown).toContain("> [attachment] text/csv");
    expect(bundle.messages[0]?.markdown).toContain("~~~text");
    expect(bundle.messages[0]?.markdown).toContain("Year,Value");
    expect(bundle.messages[0]?.markdown).toContain("2025,2");
  });
});
