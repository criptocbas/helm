/** Helm color themes — applied via `data-theme` on <html>. */

export type HelmTheme = "dark" | "light";

export const THEME_ATTR = "data-theme";

export function isHelmTheme(v: unknown): v is HelmTheme {
  return v === "dark" || v === "light";
}

/** Apply theme immediately (safe before React mount — call from main.tsx). */
export function applyTheme(theme: HelmTheme): void {
  const root = document.documentElement;
  root.setAttribute(THEME_ATTR, theme);
  root.style.colorScheme = theme;
}

export function toggleTheme(current: HelmTheme): HelmTheme {
  return current === "dark" ? "light" : "dark";
}

export function themeLabel(theme: HelmTheme): string {
  return theme === "dark" ? "Dark" : "Light";
}
