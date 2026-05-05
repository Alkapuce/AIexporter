import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome.runtime.sendNativeMessage before importing the module under test.
// The module reads globalThis.chrome.runtime at call time, so we set it up globally.
const mockSendNativeMessage = vi.fn();

beforeEach(() => {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendNativeMessage: mockSendNativeMessage,
      lastError: undefined,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

async function resolveWith(ok: boolean, extra?: Record<string, unknown>) {
  const response = { ok, ...extra };
  // Simulate the callback-based API: the mock will call its callback synchronously.
  mockSendNativeMessage.mockImplementation((_app: string, _message: unknown, callback: (response: unknown) => void) => {
    callback(response);
  });
  return response;
}

import {
  checkPathExistsWithNativeHost,
  listFilesWithNativeHost,
  movePathWithNativeHost,
  openFileWithNativeHost,
  pickFolderWithNativeHost,
  pingNativeHost,
  pruneOldFilesWithNativeHost,
  readFileWithNativeHost,
  recyclePathWithNativeHost,
  relocateFileWithNativeHost,
  resolveExportRootWithNativeHost,
  showFolderWithNativeHost,
  writeFileWithNativeHost,
} from "./native-host";

describe("native-host", () => {
  describe("pingNativeHost", () => {
    it("sends a ping action and resolves on ok", async () => {
      resolveWith(true);
      const result = await pingNativeHost();
      expect(result.ok).toBe(true);
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "ping" },
        expect.any(Function),
      );
    });

    it("rejects when the host returns ok: false", async () => {
      resolveWith(false, { error: "host unavailable" });
      await expect(pingNativeHost()).rejects.toThrow("host unavailable");
    });
  });

  describe("openFileWithNativeHost", () => {
    it("sends the open-file action with the path", async () => {
      resolveWith(true);
      await openFileWithNativeHost("C:\\test\\file.md");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "open-file", path: "C:\\test\\file.md" },
        expect.any(Function),
      );
    });
  });

  describe("showFolderWithNativeHost", () => {
    it("sends show-folder action with the path", async () => {
      resolveWith(true);
      await showFolderWithNativeHost("C:\\test");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "show-folder", path: "C:\\test" },
        expect.any(Function),
      );
    });
  });

  describe("relocateFileWithNativeHost", () => {
    it("sends relocate-file with sourcePath, relativePath, and optional rootPath", async () => {
      resolveWith(true, { path: "C:\\dest\\f.md" });
      const result = await relocateFileWithNativeHost("C:\\src\\f.md", "sub/f.md", "C:\\root");
      expect(result.path).toBe("C:\\dest\\f.md");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "relocate-file", sourcePath: "C:\\src\\f.md", relativePath: "sub/f.md", rootPath: "C:\\root" },
        expect.any(Function),
      );
    });

    it("omits rootPath when not provided", async () => {
      resolveWith(true);
      await relocateFileWithNativeHost("C:\\src\\f.md", "sub/f.md");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "relocate-file", sourcePath: "C:\\src\\f.md", relativePath: "sub/f.md", rootPath: undefined },
        expect.any(Function),
      );
    });
  });

  describe("movePathWithNativeHost", () => {
    it("sends move-path with sourcePath and path", async () => {
      resolveWith(true);
      await movePathWithNativeHost("C:\\a", "C:\\b");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "move-path", sourcePath: "C:\\a", path: "C:\\b" },
        expect.any(Function),
      );
    });
  });

  describe("recyclePathWithNativeHost", () => {
    it("sends recycle-path action", async () => {
      resolveWith(true);
      await recyclePathWithNativeHost("C:\\temp\\old.md");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "recycle-path", path: "C:\\temp\\old.md" },
        expect.any(Function),
      );
    });
  });

  describe("checkPathExistsWithNativeHost", () => {
    it("sends path-exists and returns the response", async () => {
      resolveWith(true);
      const result = await checkPathExistsWithNativeHost("C:\\exists");
      expect(result.ok).toBe(true);
    });
  });

  describe("writeFileWithNativeHost", () => {
    it("sends write-file with all arguments and defaults encoding to utf8", async () => {
      resolveWith(true);
      await writeFileWithNativeHost("sub/file.md", "# Hello", "utf8", "C:\\root");
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        {
          action: "write-file",
          relativePath: "sub/file.md",
          content: "# Hello",
          encoding: "utf8",
          rootPath: "C:\\root",
        },
        expect.any(Function),
      );
    });

    it("defaults encoding to utf8 when omitted", async () => {
      resolveWith(true);
      // Call with 2 positional args — encoding defaults to "utf8"
      await writeFileWithNativeHost("sub/f.md", "content");
      const call = mockSendNativeMessage.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.encoding).toBe("utf8");
    });
  });

  describe("pickFolderWithNativeHost", () => {
    it("sends pick-folder with optional initial path", async () => {
      resolveWith(true, { path: "C:\\chosen" });
      const result = await pickFolderWithNativeHost("C:\\start");
      expect(result.path).toBe("C:\\chosen");
    });

    it("sends pick-folder without path when omitted", async () => {
      resolveWith(true);
      await pickFolderWithNativeHost();
      expect(mockSendNativeMessage).toHaveBeenCalledWith(
        "com.aiexporter.shell",
        { action: "pick-folder", path: undefined },
        expect.any(Function),
      );
    });
  });

  describe("listFilesWithNativeHost", () => {
    it("sends list-files with defaults for pattern and recursive", async () => {
      resolveWith(true, { paths: ["a.md", "b.md"] });
      const result = await listFilesWithNativeHost("C:\\dir");
      expect(result.paths).toEqual(["a.md", "b.md"]);
      const call = mockSendNativeMessage.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.pattern).toBe("*");
      expect(call.recursive).toBe(true);
    });
  });

  describe("readFileWithNativeHost", () => {
    it("sends read-file with default utf8 encoding", async () => {
      resolveWith(true, { content: "file content" });
      const result = await readFileWithNativeHost("C:\\f.md");
      expect(result.content).toBe("file content");
    });
  });

  describe("resolveExportRootWithNativeHost", () => {
    it("sends resolve-export-root with optional rootPath", async () => {
      resolveWith(true, { path: "C:\\resolved" });
      const result = await resolveExportRootWithNativeHost("C:\\custom");
      expect(result.path).toBe("C:\\resolved");
    });
  });

  describe("pruneOldFilesWithNativeHost", () => {
    it("sends prune-old-files with all defaults", async () => {
      resolveWith(true);
      await pruneOldFilesWithNativeHost("C:\\dir");
      const call = mockSendNativeMessage.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.action).toBe("prune-old-files");
      expect(call.pattern).toBe("*");
      expect(call.recursive).toBe(true);
      expect(call.olderThanDays).toBe(7);
    });

    it("sends prune-old-files with custom options", async () => {
      resolveWith(true);
      await pruneOldFilesWithNativeHost("C:\\dir", "*.md", false, 30);
      const call = mockSendNativeMessage.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.pattern).toBe("*.md");
      expect(call.recursive).toBe(false);
      expect(call.olderThanDays).toBe(30);
    });
  });

  describe("error propagation", () => {
    it("rejects when chrome.runtime.sendNativeMessage is unavailable", async () => {
      delete (globalThis as Record<string, unknown>).chrome;
      // sendNativeMessage throws synchronously when chrome.runtime is missing,
      // so wrap in an async function for .rejects to catch it.
      await expect(async () => pingNativeHost()).rejects.toThrow("Native messaging is unavailable");
    });

    it("rejects when chrome.runtime.lastError is set", async () => {
      (globalThis as Record<string, unknown>).chrome = {
        runtime: {
          sendNativeMessage: vi.fn((_app, _msg, cb) => cb(undefined)),
          lastError: { message: "Native host has exited." },
        },
      };
      await expect(pingNativeHost()).rejects.toThrow("Native host has exited");
    });

    it("rejects when response is undefined", async () => {
      mockSendNativeMessage.mockImplementation((_app, _msg, cb) => cb(undefined));
      await expect(pingNativeHost()).rejects.toThrow("empty response");
    });
  });
});
