export type DeepSeekStatusTone = "neutral" | "success" | "error";

export interface JsonStorageLike {
  getItem(key: string): string | null;
}

export function getStoredValue<T = string>(
  key: string,
  storage: JsonStorageLike = window.localStorage,
): T | undefined {
  const raw = storage.getItem(key);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as { value?: T } | T;
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value;
    }
    return parsed as T;
  } catch {
    return raw as T;
  }
}

export function buildDeepSeekApiHeaders(options: {
  storage?: JsonStorageLike;
  navigatorLanguage?: string;
} = {}): Record<string, string> {
  const storage = options.storage ?? window.localStorage;
  const navigatorLanguage = options.navigatorLanguage ?? navigator.language;
  const token = getStoredValue<string>("userToken", storage);
  const localePreference = getStoredValue<string>("__appKit_@deepseek/chat_localePreference", storage);
  const locale =
    localePreference && localePreference !== "system"
      ? localePreference.replace("-", "_")
      : navigatorLanguage.replace("-", "_");

  return {
    Accept: "*/*",
    Authorization: token ? `Bearer ${token}` : "",
    "x-client-locale": locale || "en_US",
    "x-client-platform": "web",
    "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
    "x-client-version": "1.7.1",
    "x-app-version": "20241129.1",
  };
}

export function isDeepSeekWorkerPageContext(search = window.location.search): boolean {
  return new URLSearchParams(search).get("aiexporter_worker") === "1";
}

export function unwrapRuntimeResponse<T>(response: T | { __aiexporterError?: string }): T {
  if (response && typeof response === "object" && "__aiexporterError" in response) {
    throw new Error((response as { __aiexporterError?: string }).__aiexporterError ?? "Unknown background error");
  }
  return response as T;
}
