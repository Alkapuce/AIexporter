const AIEXPORTER_NATIVE_HOST = "com.aiexporter.shell";

type NativeHostAction =
  | "ping"
  | "open-file"
  | "show-folder"
  | "relocate-file"
  | "move-path"
  | "recycle-path"
  | "path-exists"
  | "write-file"
  | "pick-folder"
  | "list-files"
  | "read-file"
  | "resolve-export-root"
  | "prune-old-files";

interface NativeHostRequest {
  action: NativeHostAction;
  path?: string;
  sourcePath?: string;
  relativePath?: string;
  rootPath?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  pattern?: string;
  recursive?: boolean;
  olderThanDays?: number;
}

interface NativeHostResponse {
  ok: boolean;
  action?: NativeHostAction;
  path?: string;
  paths?: string[];
  content?: string;
  error?: string;
}

interface ChromeRuntimeApi {
  lastError?: {
    message?: string;
  };
  sendNativeMessage?: (
    application: string,
    message: NativeHostRequest,
    callback?: (response: NativeHostResponse | undefined) => void,
  ) => void;
}

function getChromeRuntime(): ChromeRuntimeApi | undefined {
  return (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntimeApi } }).chrome?.runtime;
}

function sendNativeMessage(message: NativeHostRequest): Promise<NativeHostResponse> {
  const runtime = getChromeRuntime();
  if (!runtime?.sendNativeMessage) {
    throw new Error("Native messaging is unavailable in this browser context.");
  }

  return new Promise((resolve, reject) => {
    runtime.sendNativeMessage?.(AIEXPORTER_NATIVE_HOST, message, (response) => {
      const runtimeError = runtime.lastError?.message;
      if (runtimeError) {
        reject(new Error(runtimeError));
        return;
      }

      if (!response) {
        reject(new Error("Native host returned an empty response."));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "Native host action failed."));
        return;
      }

      resolve(response);
    });
  });
}

export function pingNativeHost(): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "ping" });
}

export function openFileWithNativeHost(path: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "open-file", path });
}

export function showFolderWithNativeHost(path: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "show-folder", path });
}

export function relocateFileWithNativeHost(
  sourcePath: string,
  relativePath: string,
  rootPath?: string,
): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "relocate-file", sourcePath, relativePath, rootPath });
}

export function movePathWithNativeHost(sourcePath: string, path: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "move-path", sourcePath, path });
}

export function recyclePathWithNativeHost(path: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "recycle-path", path });
}

export function checkPathExistsWithNativeHost(path: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "path-exists", path });
}

export function writeFileWithNativeHost(
  relativePath: string,
  content: string,
  encoding: "utf8" | "base64" = "utf8",
  rootPath?: string,
): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "write-file", relativePath, content, encoding, rootPath });
}

export function pickFolderWithNativeHost(path?: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "pick-folder", path });
}

export function listFilesWithNativeHost(path: string, pattern = "*", recursive = true): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "list-files", path, pattern, recursive });
}

export function readFileWithNativeHost(
  path: string,
  encoding: "utf8" | "base64" = "utf8",
): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "read-file", path, encoding });
}

export function resolveExportRootWithNativeHost(rootPath?: string): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "resolve-export-root", rootPath });
}

export function pruneOldFilesWithNativeHost(
  path: string,
  pattern = "*",
  recursive = true,
  olderThanDays = 7,
): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "prune-old-files", path, pattern, recursive, olderThanDays });
}
