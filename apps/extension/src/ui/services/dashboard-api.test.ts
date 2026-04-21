import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveConversationTarget, openLatestArtifact, openSourceUrl, showArtifactFolder } from "./dashboard-api";

describe("dashboard file actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a runtime message to open the latest markdown", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("browser", {
      runtime: { sendMessage },
    });

    await expect(openLatestArtifact("deepseek", "conv-1")).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "artifact-open-latest",
      platform: "deepseek",
      sourceId: "conv-1",
    });
  });

  it("sends a runtime message to show the export folder", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("browser", {
      runtime: { sendMessage },
    });

    await expect(showArtifactFolder("deepseek", "conv-2")).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "artifact-show-folder",
      platform: "deepseek",
      sourceId: "conv-2",
    });
  });

  it("propagates runtime message failures", async () => {
    vi.stubGlobal("browser", {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("runtime failed")) },
    });

    await expect(openLatestArtifact("deepseek", "conv-3")).rejects.toThrow("runtime failed");
  });

  it("opens a normalized source url without worker flags", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    openSourceUrl("https://gemini.google.com/app/conv-1?aiexporter_worker=1&aiexporter_discovery=1&hl=zh-CN");

    expect(open).toHaveBeenCalledWith(
      "https://gemini.google.com/app/conv-1?hl=zh-CN",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("recognizes the active supported conversation tab in popup mode", async () => {
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 42,
            url: "https://aistudio.google.com/prompts/prompt-123",
            title: "Prompt 123",
          },
        ]),
      },
    });

    await expect(getActiveConversationTarget()).resolves.toEqual({
      tabId: 42,
      url: "https://aistudio.google.com/prompts/prompt-123",
      title: "Prompt 123",
      platform: "aistudio",
      supported: true,
    });
  });
});
