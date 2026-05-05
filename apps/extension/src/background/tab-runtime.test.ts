import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- browser mock helpers ---
// The module under test references browser.* globals at call time, so we stub
// before import using vi.stubGlobal. Since ES imports are hoisted, the tests
// that need runtime functions use dynamic import() after stubbing.
function stubBrowser(_tabsOverrides: Record<string, unknown> = {}) {
  const tabsGet = vi.fn();
  const tabsSendMessage = vi.fn();
  const tabsRemove = vi.fn();
  const tabsOnUpdated = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  };

  vi.stubGlobal("browser", {
    tabs: {
      get: tabsGet,
      sendMessage: tabsSendMessage,
      remove: tabsRemove,
      onUpdated: tabsOnUpdated,
    },
  });

  return { tabsGet, tabsSendMessage, tabsRemove, tabsOnUpdated };
}

// Statically import the pure function under test (no browser dependency).
import { isReceiverUnavailableError } from "./tab-runtime";

// --- isReceiverUnavailableError (纯函数，无需 mock) ---
describe("tab-runtime", () => {
  describe("isReceiverUnavailableError", () => {
    it("detects 'Receiving end does not exist' error", () => {
      expect(isReceiverUnavailableError(new Error("Receiving end does not exist"))).toBe(true);
    });

    it("detects 'No tab with id' error", () => {
      expect(isReceiverUnavailableError(new Error("No tab with id: 42"))).toBe(true);
    });

    it("detects 'Cannot access contents of url' error", () => {
      expect(isReceiverUnavailableError(new Error("Cannot access contents of url"))).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isReceiverUnavailableError(new Error("Network error"))).toBe(false);
    });

    it("handles non-Error inputs", () => {
      expect(isReceiverUnavailableError("Receiving end does not exist")).toBe(true);
      expect(isReceiverUnavailableError(42)).toBe(false);
      expect(isReceiverUnavailableError(null)).toBe(false);
    });

    it("returns false for empty error", () => {
      expect(isReceiverUnavailableError(new Error(""))).toBe(false);
    });
  });

  // --- requestTabRuntimeMessage (需要 mock browser) ---
  // Since browser.tabs.sendMessage is mocked to resolve/reject immediately,
  // Promise.race never reaches the setTimeout side. We use real timers to
  // avoid unhandled-rejection noise from the losing side of Promise.race.
  describe("requestTabRuntimeMessage retry behavior", () => {
    let tabsSendMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      const mocks = stubBrowser();
      tabsSendMessage = mocks.tabsSendMessage;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns the response on the first attempt", async () => {
      tabsSendMessage.mockResolvedValue({ ok: true });

      const { requestTabRuntimeMessage } = await import("./tab-runtime");

      const result = await requestTabRuntimeMessage(42, { type: "worker-ready-ping" });

      expect(result).toEqual({ ok: true });
      expect(tabsSendMessage).toHaveBeenCalledTimes(1);
    });

    it("retries on receiver-unavailable errors and eventually succeeds", async () => {
      tabsSendMessage
        .mockRejectedValueOnce(new Error("Receiving end does not exist"))
        .mockRejectedValueOnce(new Error("No tab with id: 42"))
        .mockResolvedValue({ ok: true });

      const { requestTabRuntimeMessage } = await import("./tab-runtime");

      const result = await requestTabRuntimeMessage(42, { type: "worker-ready-ping" }, 5, 500);

      expect(result).toEqual({ ok: true });
      expect(tabsSendMessage).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting all attempts", async () => {
      tabsSendMessage.mockRejectedValue(new Error("Receiving end does not exist"));

      const { requestTabRuntimeMessage } = await import("./tab-runtime");

      await expect(requestTabRuntimeMessage(42, { type: "worker-ready-ping" }, 3, 500)).rejects.toThrow(
        "Receiving end does not exist",
      );

      expect(tabsSendMessage).toHaveBeenCalledTimes(3);
    });
  });

  // --- waitForTabComplete (需要 mock browser) ---
  // The "resolves immediately" and "resolves via onUpdated" cases use real
  // timers because browser mocks resolve immediately. The "throws timeout"
  // case uses fake timers with a careful pattern to avoid unhandled rejections
  // from the losing side of Promise.race inside the tested code.
  describe("waitForTabComplete timeout behavior", () => {
    let tabsGet: ReturnType<typeof vi.fn>;
    let tabsOnUpdated: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      const mocks = stubBrowser();
      tabsGet = mocks.tabsGet;
      tabsOnUpdated = mocks.tabsOnUpdated;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("resolves immediately when the tab is already complete", async () => {
      tabsGet.mockResolvedValue({ status: "complete" });

      const { waitForTabComplete } = await import("./tab-runtime");

      await expect(waitForTabComplete(42, 10_000)).resolves.toBeUndefined();
      expect(tabsOnUpdated.addListener).not.toHaveBeenCalled();
    });

    it("resolves when the tab reaches 'complete' status via onUpdated", async () => {
      tabsGet.mockResolvedValue({ status: "loading" });

      let listener: ((tabId: number, info: { status?: string }) => void) | undefined;
      tabsOnUpdated.addListener.mockImplementation((fn: typeof listener) => {
        listener = fn;
      });

      const { waitForTabComplete } = await import("./tab-runtime");

      const promise = waitForTabComplete(42, 10_000);

      // Simulate the tab completing asynchronously
      await Promise.resolve();
      listener!(42, { status: "complete" });

      await expect(promise).resolves.toBeUndefined();
      expect(tabsOnUpdated.removeListener).toHaveBeenCalled();
    });

    it("throws when tab never completes before timeout", async () => {
      tabsGet.mockResolvedValue({ status: "loading" });

      const { waitForTabComplete } = await import("./tab-runtime");

      // Use a minimal timeout so the test runs fast with real timers
      await expect(waitForTabComplete(42, 1)).rejects.toThrow("Timed out waiting for conversation tab to load");
      expect(tabsOnUpdated.removeListener).toHaveBeenCalled();
    });
  });

  // --- waitForWorkerReady (需要 mock browser) ---
  // waitForWorkerReady polls tab.url (setTimeout 300ms) and then pings the
  // content script via requestTabRuntimeMessage. We test two scenarios:
  //   1. URL matches + ping ok → resolve (real async, fast)
  //   2. URL never matches + timeout → reject
  describe("waitForWorkerReady polling behavior", () => {
    let tabsGet: ReturnType<typeof vi.fn>;
    let tabsSendMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      const mocks = stubBrowser();
      tabsGet = mocks.tabsGet;
      tabsSendMessage = mocks.tabsSendMessage;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("resolves when the tab URL matches and content script pings back ok", async () => {
      tabsGet.mockResolvedValue({ url: "https://chatgpt.com/c/some-conversation" });
      // Content script responds to the ready ping
      tabsSendMessage.mockResolvedValue({ ok: true });

      const { waitForWorkerReady } = await import("./tab-runtime");

      await expect(waitForWorkerReady(42, "https://chatgpt.com/c/some-conversation", 10_000)).resolves.toBeUndefined();
    });

    it("throws Worker receiver error when timeout is exceeded (URL never matches)", async () => {
      // Stub Date.now so the while-loop exits after one iteration
      let callCount = 0;
      vi.stubGlobal("Date", {
        ...Date,
        now: vi.fn(() => {
          callCount += 1;
          return callCount <= 1 ? 0 : 100_000;
        }),
      });

      tabsGet.mockResolvedValue({ url: "about:blank" });

      const { waitForWorkerReady } = await import("./tab-runtime");

      await expect(waitForWorkerReady(42, "https://chatgpt.com/c/some-conversation", 5_000)).rejects.toThrow(
        "Worker receiver did not become ready before timeout",
      );
    });

    it("polls until URL matches then succeeds on content script ping", async () => {
      // URL polling: undefined → about:blank → matching URL
      tabsGet
        .mockResolvedValueOnce({ url: undefined })
        .mockResolvedValueOnce({ url: "about:blank" })
        .mockResolvedValue({ url: "https://chatgpt.com/c/some-conversation" });
      // Content script ping succeeds
      tabsSendMessage.mockResolvedValue({ ok: true });

      const { waitForWorkerReady } = await import("./tab-runtime");

      await expect(waitForWorkerReady(42, "https://chatgpt.com/c/some-conversation", 10_000)).resolves.toBeUndefined();

      expect(tabsGet).toHaveBeenCalledTimes(3);
      expect(tabsSendMessage).toHaveBeenCalledWith(42, { type: "worker-ready-ping" });
    });
  });
});
