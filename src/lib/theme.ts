export type AppTheme = "light" | "dark";

export const themeStorageKey = "ytloadster.theme";

export function getInitialTheme(): AppTheme {
  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // A restricted WebView may deny storage access; the system preference still works.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: AppTheme) {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Theme switching must remain available even if persistent storage is unavailable.
  }
}
