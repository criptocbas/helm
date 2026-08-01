/** Helm UI prefs — localStorage for now; mirrors ~/.config/grok-helm intent. */

import { isHelmTheme, type HelmTheme } from "./theme";

export type PermissionMode = "auto" | "ask";

export type HelmPrefs = {
  permissionMode: PermissionMode;
  voiceEnabled: boolean;
  ttsCallouts: boolean;
  mcpEnabled: boolean;
  /** Stage chrome: dark (default) or light. */
  theme: HelmTheme;
};

const KEY = "grok-helm.prefs.v1";

/** Safe default: ask mode. Auto / always-approve is opt-in for dogfood. */
const DEFAULTS: HelmPrefs = {
  permissionMode: "ask",
  voiceEnabled: false,
  ttsCallouts: false,
  mcpEnabled: false,
  theme: "dark",
};

export function loadPrefs(): HelmPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<HelmPrefs>;
    const theme = isHelmTheme(parsed.theme) ? parsed.theme : DEFAULTS.theme;
    return { ...DEFAULTS, ...parsed, theme };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<HelmPrefs>): HelmPrefs {
  const next = { ...loadPrefs(), ...patch };
  if (!isHelmTheme(next.theme)) next.theme = DEFAULTS.theme;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
