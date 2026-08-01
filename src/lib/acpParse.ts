/** ACP session/update parsing helpers (aligned with Grok Desk). */

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (typeof c.text === "string") return c.text;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export type StreamKind =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "subagent_spawned"
  | "subagent_finished"
  | "user_message_chunk"
  | "other";

export type ParsedUpdate = {
  sessionId: string;
  kind: StreamKind;
  update: Record<string, unknown>;
};

export function parseSessionUpdatePayload(payload: unknown): ParsedUpdate | null {
  const params = (payload ?? {}) as Record<string, unknown>;
  const sessionId =
    (typeof params.sessionId === "string" && params.sessionId) ||
    (typeof params.session_id === "string" && params.session_id) ||
    "";
  if (!sessionId) return null;

  const update = (params.update ?? params) as Record<string, unknown>;
  const kindRaw =
    (typeof update.sessionUpdate === "string" && update.sessionUpdate) ||
    (typeof update.session_update === "string" && update.session_update) ||
    "";
  if (!kindRaw) return null;

  const known: StreamKind[] = [
    "agent_message_chunk",
    "agent_thought_chunk",
    "tool_call",
    "tool_call_update",
    "subagent_spawned",
    "subagent_finished",
    "user_message_chunk",
  ];
  const kind = (known.includes(kindRaw as StreamKind)
    ? kindRaw
    : "other") as StreamKind;

  return { sessionId, kind, update };
}

export function parseSubagentSpawned(update: Record<string, unknown>): {
  subagentId: string;
  childSessionId?: string;
  description: string;
  subagentType?: string;
  model?: string;
} | null {
  const subagentId =
    (typeof update.subagent_id === "string" && update.subagent_id) ||
    (typeof update.subagentId === "string" && update.subagentId) ||
    "";
  if (!subagentId) return null;

  const description =
    (typeof update.description === "string" && update.description.trim()) ||
    "Subagent";

  return {
    subagentId,
    childSessionId:
      (typeof update.child_session_id === "string" && update.child_session_id) ||
      (typeof update.childSessionId === "string" && update.childSessionId) ||
      undefined,
    description: description.slice(0, 200),
    subagentType:
      (typeof update.subagent_type === "string" && update.subagent_type) ||
      (typeof update.subagentType === "string" && update.subagentType) ||
      undefined,
    model:
      (typeof update.model === "string" && update.model) ||
      (typeof update.effective_model_id === "string" && update.effective_model_id) ||
      undefined,
  };
}

export function parseSubagentFinished(update: Record<string, unknown>): {
  subagentId: string;
  status: string;
  summary: string;
  durationMs?: number;
} | null {
  const subagentId =
    (typeof update.subagent_id === "string" && update.subagent_id) ||
    (typeof update.subagentId === "string" && update.subagentId) ||
    "";
  if (!subagentId) return null;

  const status =
    (typeof update.status === "string" && update.status) || "completed";
  const summary =
    (typeof update.output === "string" && update.output) ||
    (typeof update.summary === "string" && update.summary) ||
    status;

  let durationMs: number | undefined;
  if (typeof update.duration_ms === "number") durationMs = update.duration_ms;
  else if (typeof update.durationMs === "number") durationMs = update.durationMs;

  return {
    subagentId,
    status,
    summary: summary.slice(0, 240),
    durationMs,
  };
}

export function toolTitle(update: Record<string, unknown>): string {
  if (typeof update.title === "string" && update.title) return update.title;
  const meta = update._meta as Record<string, unknown> | undefined;
  const xai = meta?.["x.ai/tool"] as Record<string, unknown> | undefined;
  if (typeof xai?.name === "string") return xai.name;
  if (typeof update.kind === "string") return update.kind;
  return "tool";
}

export function toolStatus(update: Record<string, unknown>): string {
  return typeof update.status === "string" ? update.status : "";
}

// Re-export approval pickers (single source of truth in approvals.ts)
export {
  pickAllowOption,
  pickAllowAlwaysOption,
  pickDenyOption,
  summarizeToolCall,
} from "./approvals";
