/** Helm UI prefs — localStorage for now; mirrors ~/.config/grok-helm intent. */

export type PermissionMode = "auto" | "ask";

export type HelmPrefs = {
  permissionMode: PermissionMode;
  voiceEnabled: boolean;
  ttsCallouts: boolean;
  mcpEnabled: boolean;
};

const KEY = "grok-helm.prefs.v1";

const DEFAULTS: HelmPrefs = {
  permissionMode: "auto",
  voiceEnabled: false,
  ttsCallouts: false,
  mcpEnabled: false,
};

export function loadPrefs(): HelmPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<HelmPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<HelmPrefs>): HelmPrefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
