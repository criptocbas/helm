/** Pending ACP reverse-requests for ask-mode UI. */

export type PermissionOption = {
  optionId: string;
  kind: string;
  name?: string;
};

export type PendingPermission = {
  requestId: number;
  sessionId: string | null;
  options: PermissionOption[];
  /** Short tool summary for the card */
  summary: string;
  toolCall?: unknown;
  receivedAt: number;
};

export type PendingPlan = {
  requestId: number;
  sessionId: string;
  planContent: string | null;
  toolCallId?: string | null;
  receivedAt: number;
};

export function summarizeToolCall(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object") return "Tool permission required";
  const t = toolCall as Record<string, unknown>;
  if (typeof t.title === "string" && t.title.trim()) return t.title.trim();
  if (typeof t.kind === "string" && t.kind.trim()) return t.kind.trim();
  const meta = t._meta as Record<string, unknown> | undefined;
  const xai = meta?.["x.ai/tool"] as Record<string, unknown> | undefined;
  if (typeof xai?.name === "string") return xai.name;
  if (typeof t.name === "string") return t.name;
  return "Tool permission required";
}

export function pickAllowOption(
  options: PermissionOption[],
): string | null {
  if (!options.length) return null;
  // Prefer one-time allow for ask UI (safer than always)
  const once = options.find((o) => {
    const k = (o.kind || "").toLowerCase();
    return k.includes("allow_once") || k === "allow" || k.includes("allow_current");
  });
  if (once) return once.optionId;
  const allow = options.find((o) => (o.kind || "").toLowerCase().includes("allow"));
  if (allow) return allow.optionId;
  const byName = options.find((o) =>
    /allow|approve|yes/i.test((o.name || "") + o.optionId),
  );
  if (byName) return byName.optionId;
  return options[0]?.optionId ?? null;
}

/** Prefer permanent allow when auto mode dogfoods. */
export function pickAllowAlwaysOption(
  options: PermissionOption[],
): string | null {
  if (!options.length) return null;
  const always = options.find((o) =>
    (o.kind || "").toLowerCase().includes("allow_always"),
  );
  if (always) return always.optionId;
  return pickAllowOption(options);
}

export function pickDenyOption(options: PermissionOption[]): string | null {
  if (!options.length) return null;
  const deny = options.find((o) => {
    const blob = `${o.kind} ${o.name || ""} ${o.optionId}`.toLowerCase();
    return (
      blob.includes("reject") ||
      blob.includes("deny") ||
      blob.includes("cancel") ||
      blob.includes("no")
    );
  });
  return deny?.optionId ?? null;
}
