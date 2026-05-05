import { applyThemeToDocument, createThemeTokens, type ThemeMode } from "./theme-core";
import { loadThemeModeFromStorage, watchThemeModeFromStorage } from "./theme-storage";

const activeThemeSyncs = new WeakMap<Document, () => void>();

export function startThemeSync(target: Document = document, options: { styleBody?: boolean } = {}): () => void {
  const existing = activeThemeSyncs.get(target);
  if (existing) {
    return existing;
  }

  const mediaQuery =
    target.defaultView?.matchMedia("(prefers-color-scheme: dark)") ?? window.matchMedia("(prefers-color-scheme: dark)");
  let currentThemeMode: ThemeMode = "system";

  const apply = (themeMode: ThemeMode) => {
    currentThemeMode = themeMode;
    const theme = createThemeTokens(themeMode, mediaQuery.matches);
    applyThemeToDocument(theme, target, options);
  };

  apply("system");
  void loadThemeModeFromStorage()
    .then(apply)
    .catch(() => apply("system"));

  const stopWatchingStorage = watchThemeModeFromStorage((themeMode) => {
    apply(themeMode);
  });

  const onSystemThemeChange = () => {
    if (currentThemeMode === "system") {
      apply("system");
    }
  };

  mediaQuery.addEventListener("change", onSystemThemeChange);

  const stop = () => {
    stopWatchingStorage();
    mediaQuery.removeEventListener("change", onSystemThemeChange);
    activeThemeSyncs.delete(target);
  };

  activeThemeSyncs.set(target, stop);
  return stop;
}
