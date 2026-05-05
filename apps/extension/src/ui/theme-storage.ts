import type { ThemeMode } from "./theme-core";

export const QUEUE_STATE_STORAGE_KEY = "aiexporter.queueState";

function extractThemeMode(value: unknown): ThemeMode {
  const candidate = value as { settings?: { uiThemeMode?: unknown } } | undefined;
  const themeMode = candidate?.settings?.uiThemeMode;
  return themeMode === "light" || themeMode === "dark" || themeMode === "system" ? themeMode : "system";
}

export async function loadThemeModeFromStorage(): Promise<ThemeMode> {
  const snapshot = await browser.storage.local.get(QUEUE_STATE_STORAGE_KEY);
  return extractThemeMode(snapshot[QUEUE_STATE_STORAGE_KEY]);
}

export function watchThemeModeFromStorage(onChange: (themeMode: ThemeMode) => void): () => void {
  const handleChange = (changes: Record<string, browser.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local" || !(QUEUE_STATE_STORAGE_KEY in changes)) return;
    void loadThemeModeFromStorage()
      .then(onChange)
      .catch(() => undefined);
  };

  browser.storage.onChanged.addListener(handleChange);
  return () => browser.storage.onChanged.removeListener(handleChange);
}

export { extractThemeMode };
