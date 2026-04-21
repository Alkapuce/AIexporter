import { beforeEach, describe, expect, it, vi } from "vitest";

describe("background logger buffering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  it("flushes buffered info logs on timer", async () => {
    const appendDebugLog = vi.fn().mockResolvedValue({ logs: [] });
    const appendDebugLogs = vi.fn().mockResolvedValue({ logs: [] });
    vi.doMock("./storage", () => ({
      appendDebugLog,
      appendDebugLogs,
    }));

    const logger = await import("./logger");
    await logger.writeBackgroundLog("scope", "info", "first");
    await logger.writeBackgroundLog("scope", "debug", "second");

    expect(appendDebugLog).not.toHaveBeenCalled();
    expect(appendDebugLogs).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(appendDebugLogs).toHaveBeenCalledTimes(1);
    const entries = appendDebugLogs.mock.calls[0]?.[0] ?? [];
    expect(entries).toHaveLength(3);
    expect(entries[0]?.message).toBe("first");
    expect(entries[1]?.message).toBe("second");
    expect(entries[2]?.code).toBe("debug.log_buffer_flushed");
  });

  it("flushes buffered logs before writing warnings immediately", async () => {
    const appendDebugLog = vi.fn().mockResolvedValue({ logs: [] });
    const appendDebugLogs = vi.fn().mockResolvedValue({ logs: [] });
    vi.doMock("./storage", () => ({
      appendDebugLog,
      appendDebugLogs,
    }));

    const logger = await import("./logger");
    await logger.writeBackgroundLog("scope", "info", "buffered");
    await logger.writeBackgroundLog("scope", "warn", "warning");

    expect(appendDebugLogs).toHaveBeenCalledTimes(1);
    expect(appendDebugLog).toHaveBeenCalledTimes(1);
    expect(appendDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "warning",
      }),
    );
  });
});
