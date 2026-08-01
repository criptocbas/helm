/**
 * Conductor — shared control surface for UI, voice, workflows, and MCP.
 * Default agent spawn = full interactive Grok Build TUI in an embedded PTY.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AgentNodeState, ChatItem, SessionInfo } from "../types/board";
import {
  emptyAgentData,
  isAgentData,
  type HelmNode,
  MAX_TRANSCRIPT,
} from "../types/helm";
import { nextId } from "./ids";
import { ptyInjectText } from "../components/TerminalHost";

export type ConductorAgent = {
  nodeId: string;
  sessionId: string | null;
  shellKey?: string;
  mode: "tui" | "acp";
  label: string;
  cwd: string;
  state: AgentNodeState;
};

export function listAgents(nodes: HelmNode[]): ConductorAgent[] {
  const out: ConductorAgent[] = [];
  for (const n of nodes) {
    if (n.type !== "agent" || !isAgentData(n.data)) continue;
    const d = n.data;
    out.push({
      nodeId: n.id,
      sessionId: d.sessionId,
      shellKey: d.shellKey,
      mode: d.mode ?? "tui",
      label: d.label,
      cwd: d.cwd,
      state: d.state,
    });
  }
  return out;
}

export function findByLabel(
  nodes: HelmNode[],
  name: string,
): ConductorAgent | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const agents = listAgents(nodes);
  const exact = agents.find((a) => a.label.toLowerCase() === needle);
  if (exact) return exact;
  const prefix = agents.find((a) => a.label.toLowerCase().startsWith(needle));
  return prefix ?? null;
}

export function findBySession(
  nodes: HelmNode[],
  sessionId: string,
): ConductorAgent | null {
  return listAgents(nodes).find((a) => a.sessionId === sessionId) ?? null;
}

export function findAgentNode(
  nodes: HelmNode[],
  sessionId: string,
): HelmNode | undefined {
  return nodes.find(
    (n) =>
      n.type === "agent" &&
      isAgentData(n.data) &&
      n.data.sessionId === sessionId,
  );
}

export type SpawnAgentOpts = {
  cwd: string;
  label?: string;
  rules?: string;
  position: { x: number; y: number };
  existingAgentCount: number;
  /** Default true = full Grok TUI. Set false for legacy ACP card. */
  tui?: boolean;
  alwaysApprove?: boolean;
};

/** Build argv for the real Grok Build interactive TUI. */
export function grokTuiCommand(
  cwd: string,
  opts?: { alwaysApprove?: boolean; initialPrompt?: string },
): string[] {
  const cmd = ["grok", "--cwd", cwd];
  if (opts?.alwaysApprove !== false) {
    cmd.push("--always-approve");
  }
  // Prefer fullscreen-capable session inside embedded xterm
  // (no --minimal so we get the standard TUI)
  if (opts?.initialPrompt?.trim()) {
    cmd.push(opts.initialPrompt.trim());
  }
  return cmd;
}

/**
 * Spawn a full Grok Build TUI agent (default).
 * Returns a canvas node; the PTY starts when TerminalHost mounts.
 */
export function spawnAgentTui(opts: SpawnAgentOpts): {
  node: HelmNode;
} {
  const label = opts.label?.trim() || `Agent ${opts.existingAgentCount + 1}`;
  const shellKey = nextId("grok-tui");
  const command = grokTuiCommand(opts.cwd, {
    alwaysApprove: opts.alwaysApprove,
    initialPrompt: opts.rules?.trim()
      ? `You are ${label}. Board brief: ${opts.rules.trim()}`
      : undefined,
  });
  const data = emptyAgentData(label, opts.cwd, null, {
    mode: "tui",
    shellKey,
    command,
    lastLine: "Full Grok Build TUI — click node to focus, type in the terminal.",
    state: "working",
  });
  const node: HelmNode = {
    id: nextId("agent"),
    type: "agent",
    position: opts.position,
    data,
    style: { width: 900, height: 560 },
  };
  return { node };
}

/** Legacy ACP spawn (thin card). Kept for orchestration experiments. */
export async function spawnAgentSession(
  opts: SpawnAgentOpts,
): Promise<{ node: HelmNode; session: SessionInfo | null }> {
  if (opts.tui !== false) {
    return { ...spawnAgentTui(opts), session: null };
  }
  const session = await invoke<SessionInfo>("session_new", {
    cwd: opts.cwd,
  });
  const label = opts.label?.trim() || `Agent ${opts.existingAgentCount + 1}`;
  const data = emptyAgentData(label, session.cwd, session.sessionId, {
    mode: "acp",
  });
  if (opts.rules?.trim()) {
    data.lastLine = "Ready (with board brief).";
  }
  const node: HelmNode = {
    id: nextId("agent"),
    type: "agent",
    position: opts.position,
    data,
  };
  return { node, session };
}

export async function promptAgent(
  sessionId: string,
  text: string,
): Promise<void> {
  await invoke("session_prompt", { sessionId, text });
}

/** Prompt an agent by mode: ACP session_prompt or TUI PTY inject. */
export async function promptConductorAgent(
  agent: ConductorAgent,
  text: string,
): Promise<void> {
  if (agent.mode === "tui" && agent.shellKey) {
    await ptyInjectText(agent.shellKey, text, true);
    return;
  }
  if (agent.sessionId) {
    await promptAgent(agent.sessionId, text);
    return;
  }
  throw new Error("Agent has no TUI PTY or ACP session");
}

export async function stopAgent(sessionId: string): Promise<void> {
  await invoke("session_cancel", { sessionId });
}

export function appendUserTurn(
  data: import("../types/board").AgentNodeData,
  text: string,
): import("../types/board").AgentNodeData {
  const userItem: ChatItem = { id: nextId("user"), role: "user", text };
  return {
    ...data,
    state: "working",
    lastLine: text,
    transcript: [...data.transcript, userItem].slice(-MAX_TRANSCRIPT),
  };
}

export type SpawnTerminalOpts = {
  cwd: string;
  position: { x: number; y: number };
  existingTerminalCount: number;
};

export function spawnTerminalNode(opts: SpawnTerminalOpts): HelmNode {
  const shellKey = nextId("shell");
  return {
    id: nextId("term"),
    type: "terminal",
    position: opts.position,
    data: {
      kind: "terminal",
      shellKey,
      cwd: opts.cwd,
      label: `Terminal ${opts.existingTerminalCount + 1}`,
    },
  };
}
