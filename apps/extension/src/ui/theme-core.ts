export type ThemeMode = "system" | "light" | "dark";
export type ThemeVariant = "light" | "dark";

export interface ThemeTokens {
  mode: ThemeMode;
  variant: ThemeVariant;
  pageBackground: string;
  pageAltBackground: string;
  surfaceBackground: string;
  surfaceMutedBackground: string;
  surfaceRaisedBackground: string;
  borderColor: string;
  borderStrongColor: string;
  textColor: string;
  textMutedColor: string;
  textSoftColor: string;
  inputBackground: string;
  inputBorderColor: string;
  inputTextColor: string;
  inputMutedBackground: string;
  buttonPrimaryBackground: string;
  buttonPrimaryText: string;
  buttonSecondaryBackground: string;
  buttonSecondaryText: string;
  buttonDangerBackground: string;
  buttonDangerText: string;
  buttonAccentBackground: string;
  buttonAccentText: string;
  infoBackground: string;
  infoBorderColor: string;
  infoTextColor: string;
  successBackground: string;
  successBorderColor: string;
  successTextColor: string;
  warningBackground: string;
  warningBorderColor: string;
  warningTextColor: string;
  dangerBackground: string;
  dangerBorderColor: string;
  dangerTextColor: string;
  chipBackground: string;
  chipTextColor: string;
  highlightBackground: string;
  highlightBorderColor: string;
  highlightTextColor: string;
  logPanelBackground: string;
  logPanelBorderColor: string;
  logPanelTextColor: string;
  logPanelMutedTextColor: string;
  shadow: string;
}

const lightTheme: ThemeTokens = {
  mode: "light",
  variant: "light",
  pageBackground: "#f3f4f6",
  pageAltBackground: "#eef2ff",
  surfaceBackground: "#ffffff",
  surfaceMutedBackground: "#f8fafc",
  surfaceRaisedBackground: "#f1f5f9",
  borderColor: "#e5e7eb",
  borderStrongColor: "#cbd5e1",
  textColor: "#111827",
  textMutedColor: "#475569",
  textSoftColor: "#6b7280",
  inputBackground: "#ffffff",
  inputBorderColor: "#d1d5db",
  inputTextColor: "#111827",
  inputMutedBackground: "#f8fafc",
  buttonPrimaryBackground: "#111827",
  buttonPrimaryText: "#ffffff",
  buttonSecondaryBackground: "#475569",
  buttonSecondaryText: "#ffffff",
  buttonDangerBackground: "#7c2d12",
  buttonDangerText: "#ffffff",
  buttonAccentBackground: "#0f766e",
  buttonAccentText: "#ffffff",
  infoBackground: "#eff6ff",
  infoBorderColor: "#bfdbfe",
  infoTextColor: "#1d4ed8",
  successBackground: "#dcfce7",
  successBorderColor: "#bbf7d0",
  successTextColor: "#166534",
  warningBackground: "#fef3c7",
  warningBorderColor: "#fde68a",
  warningTextColor: "#92400e",
  dangerBackground: "#fef2f2",
  dangerBorderColor: "#fecaca",
  dangerTextColor: "#991b1b",
  chipBackground: "#e5e7eb",
  chipTextColor: "#475569",
  highlightBackground: "#cbd5e1",
  highlightBorderColor: "#94a3b8",
  highlightTextColor: "#0f172a",
  logPanelBackground: "#0f172a",
  logPanelBorderColor: "#1e293b",
  logPanelTextColor: "#e2e8f0",
  logPanelMutedTextColor: "#94a3b8",
  shadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

const darkTheme: ThemeTokens = {
  mode: "dark",
  variant: "dark",
  pageBackground: "#0b1220",
  pageAltBackground: "#111827",
  surfaceBackground: "#111827",
  surfaceMutedBackground: "#0f172a",
  surfaceRaisedBackground: "#1f2937",
  borderColor: "#243043",
  borderStrongColor: "#3b4a61",
  textColor: "#e5eefc",
  textMutedColor: "#9aa7bb",
  textSoftColor: "#cbd5e1",
  inputBackground: "#0f172a",
  inputBorderColor: "#314158",
  inputTextColor: "#e5eefc",
  inputMutedBackground: "#111827",
  buttonPrimaryBackground: "#2563eb",
  buttonPrimaryText: "#ffffff",
  buttonSecondaryBackground: "#334155",
  buttonSecondaryText: "#e5eefc",
  buttonDangerBackground: "#991b1b",
  buttonDangerText: "#ffffff",
  buttonAccentBackground: "#0f766e",
  buttonAccentText: "#ffffff",
  infoBackground: "rgba(37, 99, 235, 0.18)",
  infoBorderColor: "rgba(96, 165, 250, 0.35)",
  infoTextColor: "#93c5fd",
  successBackground: "rgba(22, 101, 52, 0.32)",
  successBorderColor: "rgba(74, 222, 128, 0.24)",
  successTextColor: "#86efac",
  warningBackground: "rgba(120, 53, 15, 0.35)",
  warningBorderColor: "rgba(251, 191, 36, 0.26)",
  warningTextColor: "#fbbf24",
  dangerBackground: "rgba(127, 29, 29, 0.36)",
  dangerBorderColor: "rgba(248, 113, 113, 0.28)",
  dangerTextColor: "#fecaca",
  chipBackground: "#1f2937",
  chipTextColor: "#cbd5e1",
  highlightBackground: "#334155",
  highlightBorderColor: "#64748b",
  highlightTextColor: "#f8fafc",
  logPanelBackground: "#020617",
  logPanelBorderColor: "#1e293b",
  logPanelTextColor: "#e2e8f0",
  logPanelMutedTextColor: "#94a3b8",
  shadow: "0 14px 36px rgba(0, 0, 0, 0.32)",
};

const themeVariants: Record<ThemeVariant, ThemeTokens> = {
  light: lightTheme,
  dark: darkTheme,
};

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function getResolvedThemeVariant(themeMode: ThemeMode, prefersDark: boolean): ThemeVariant {
  if (themeMode === "system") {
    return prefersDark ? "dark" : "light";
  }
  return themeMode;
}

export function createThemeTokens(themeMode: ThemeMode, prefersDark: boolean): ThemeTokens {
  const variant = getResolvedThemeVariant(themeMode, prefersDark);
  return {
    ...themeVariants[variant],
    mode: themeMode,
    variant,
  };
}

export function applyThemeToDocument(
  theme: ThemeTokens,
  target: Document = document,
  options: { styleBody?: boolean } = {},
): void {
  const root = target.documentElement;
  const body = target.body;
  const { style } = root;
  const variables: Record<string, string> = {
    "page-background": theme.pageBackground,
    "page-alt-background": theme.pageAltBackground,
    "surface-background": theme.surfaceBackground,
    "surface-muted-background": theme.surfaceMutedBackground,
    "surface-raised-background": theme.surfaceRaisedBackground,
    "border-color": theme.borderColor,
    "border-strong-color": theme.borderStrongColor,
    "text-color": theme.textColor,
    "text-muted-color": theme.textMutedColor,
    "text-soft-color": theme.textSoftColor,
    "input-background": theme.inputBackground,
    "input-border-color": theme.inputBorderColor,
    "input-text-color": theme.inputTextColor,
    "input-muted-background": theme.inputMutedBackground,
    "button-primary-background": theme.buttonPrimaryBackground,
    "button-primary-text": theme.buttonPrimaryText,
    "button-secondary-background": theme.buttonSecondaryBackground,
    "button-secondary-text": theme.buttonSecondaryText,
    "button-danger-background": theme.buttonDangerBackground,
    "button-danger-text": theme.buttonDangerText,
    "button-accent-background": theme.buttonAccentBackground,
    "button-accent-text": theme.buttonAccentText,
    "info-background": theme.infoBackground,
    "info-border-color": theme.infoBorderColor,
    "info-text-color": theme.infoTextColor,
    "success-background": theme.successBackground,
    "success-border-color": theme.successBorderColor,
    "success-text-color": theme.successTextColor,
    "warning-background": theme.warningBackground,
    "warning-border-color": theme.warningBorderColor,
    "warning-text-color": theme.warningTextColor,
    "danger-background": theme.dangerBackground,
    "danger-border-color": theme.dangerBorderColor,
    "danger-text-color": theme.dangerTextColor,
    "chip-background": theme.chipBackground,
    "chip-text-color": theme.chipTextColor,
    "highlight-background": theme.highlightBackground,
    "highlight-border-color": theme.highlightBorderColor,
    "highlight-text-color": theme.highlightTextColor,
    "log-panel-background": theme.logPanelBackground,
    "log-panel-border-color": theme.logPanelBorderColor,
    "log-panel-text-color": theme.logPanelTextColor,
    "log-panel-muted-text-color": theme.logPanelMutedTextColor,
    shadow: theme.shadow,
  };

  for (const [key, value] of Object.entries(variables)) {
    style.setProperty(`--aiexporter-${key}`, value);
  }

  root.dataset.aiexporterTheme = theme.variant;
  root.style.colorScheme = theme.variant;

  if (options.styleBody !== false && body) {
    body.style.backgroundColor = theme.pageBackground;
    body.style.color = theme.textColor;
  }
}
