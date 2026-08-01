import type { Edge, Node } from "@xyflow/react";
import type {
  AgentNodeData,
  HelmNodeData,
  SubagentNodeData,
  TerminalNodeData,
} from "./board";

export type HelmNode = Node<HelmNodeData>;
export type HelmEdge = Edge;

export function isAgentData(d: HelmNodeData): d is AgentNodeData {
  return d.kind === "agent";
}

export function isSubagentData(d: HelmNodeData): d is SubagentNodeData {
  return d.kind === "subagent";
}

export function isTerminalData(d: HelmNodeData): d is TerminalNodeData {
  return d.kind === "terminal";
}

export function emptyAgentData(
  label: string,
  cwd: string,
  sessionId: string | null,
  extras?: Partial<Omit<AgentNodeData, "kind" | "label" | "cwd" | "sessionId">>,
): AgentNodeData {
  const mode = extras?.mode ?? (sessionId ? "acp" : "tui");
  return {
    kind: "agent",
    mode,
    sessionId,
    cwd,
    state: extras?.state ?? "idle",
    lastLine:
      extras?.lastLine ??
      (mode === "tui"
        ? "Full Grok Build TUI — click to focus, type inside."
        : sessionId
          ? "Ready. Select me and give orders."
          : "No session attached."),
    transcript: extras?.transcript ?? [],
    label,
    shellKey: extras?.shellKey,
    command: extras?.command,
    missing: extras?.missing,
  };
}

export const MAX_ASSISTANT = 80_000;
export const MAX_TRANSCRIPT = 300;
