import { describe, expect, it } from "vitest";
import { shouldHandleDeepSeekPassiveDiscovery } from "./content-runtime";

describe("deepseek content runtime helpers", () => {
  it("suppresses passive discovery on worker pages", () => {
    expect(
      shouldHandleDeepSeekPassiveDiscovery({
        isWorkerPage: true,
        eventSource: globalThis as unknown as Window,
        expectedSource: globalThis as unknown as Window,
        data: {
          source: "aiexporter",
          type: "deepseek-network-discovery",
          payload: {
            sourceId: "session-1",
            url: "https://chat.deepseek.com/a/chat/s/session-1",
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts passive discovery messages from the page world", () => {
    expect(
      shouldHandleDeepSeekPassiveDiscovery({
        isWorkerPage: false,
        eventSource: globalThis as unknown as Window,
        expectedSource: globalThis as unknown as Window,
        data: {
          source: "aiexporter",
          type: "deepseek-network-discovery",
          payload: {
            sourceId: "session-1",
            url: "https://chat.deepseek.com/a/chat/s/session-1",
          },
        },
      }),
    ).toBe(true);
  });
});
