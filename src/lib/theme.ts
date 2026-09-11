export type AppTheme = "light" | "dark";
export type ThemePreference = AppTheme | "system";

export const themeStorageKey = "ytloadster.theme";
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export function getInitialTheme(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      return storedTheme;
    }
  } catch {
    // A restricted WebView may deny storage access; the system preference still works.
  }

  return "system";
}

export function resolveTheme(preference: ThemePreference): AppTheme {
  if (preference !== "system") return preference;
  return window.matchMedia?.(systemThemeQuery).matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = theme;
  return theme;
}

export function saveTheme(theme: ThemePreference) {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Theme switching must remain available even if persistent storage is unavailable.
  }
}

export function nextThemePreference(theme: ThemePreference): ThemePreference {
  if (theme === "system") return "dark";
  if (theme === "dark") return "light";
  return "system";
}
