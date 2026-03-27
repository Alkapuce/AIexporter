const AIEXPORTER_NATIVE_HOST = "com.aiexporter.shell";

type NativeHostAction = "ping" | "open-file" | "show-folder" | "relocate-file";

interface NativeHostRequest {
  action: NativeHostAction;
  path?: string;
  sourcePath?: string;
  relativePath?: string;
}

interface NativeHostResponse {
  ok: boolean;
  action?: NativeHostAction;
  path?: string;
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
): Promise<NativeHostResponse> {
  return sendNativeMessage({ action: "relocate-file", sourcePath, relativePath });
}
