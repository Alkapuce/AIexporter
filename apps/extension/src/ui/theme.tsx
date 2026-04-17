import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyThemeToDocument, createThemeTokens, type ThemeMode, type ThemeTokens } from "./theme-core";

const themeContext = createContext<ThemeTokens>(createThemeTokens("system", false));

export function useThemeTokens(themeMode: ThemeMode): ThemeTokens {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const theme = useMemo(() => createThemeTokens(themeMode, prefersDark), [prefersDark, themeMode]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  return theme;
}

export function ThemeProvider({
  themeMode,
  children,
}: {
  themeMode: ThemeMode;
  children: ReactNode;
}) {
  const theme = useThemeTokens(themeMode);

  return <themeContext.Provider value={theme}>{children}</themeContext.Provider>;
}

export function useThemeContext(): ThemeTokens {
  return useContext(themeContext);
}

