import { afterEach, describe, expect, it, vi } from "vitest";
import { openLatestArtifact, showArtifactFolder } from "./dashboard-api";

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
});
