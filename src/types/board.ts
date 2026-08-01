export type AgentNodeState =
  | "idle"
  | "working"
  | "needs_input"
  | "needs_attention"
  | "completed"
  | "failed"
  | "disconnected";

export type ChatRole = "user" | "assistant" | "thought" | "tool" | "system" | "subagent";

export type ChatItem = {
  id: string;
  role: ChatRole;
  text: string;
  meta?: string;
};

export type AgentNodeData = {
  kind: "agent";
  /**
   * `tui` = full interactive `grok` in embedded PTY (default, full capability).
   * `acp` = thin ACP chat card (legacy orchestration mode).
   */
  mode: "tui" | "acp";
  sessionId: string | null;
  /** PTY key when mode is tui */
  shellKey?: string;
  /** argv for embedded grok TUI */
  command?: string[];
  cwd: string;
  state: AgentNodeState;
  lastLine: string;
  transcript: ChatItem[];
  label: string;
  /** True if session_load failed after board restore */
  missing?: boolean;
};

export type SubagentNodeData = {
  kind: "subagent";
  subagentId: string;
  parentSessionId: string;
  parentNodeId: string;
  label: string;
  state: AgentNodeState;
  lastLine: string;
  subagentType?: string;
  model?: string;
};

export type TerminalNodeData = {
  kind: "terminal";
  /** Stable id for PTY session map */
  shellKey: string;
  cwd: string;
  label: string;
};

export type HelmNodeData = AgentNodeData | SubagentNodeData | TerminalNodeData;

export type GrokStatus = {
  available: boolean;
  path: string | null;
  version: string | null;
};

export type AgentInfo = {
  agentVersion: string | null;
  modelId: string | null;
  subscriptionTier: string | null;
  authEmail: string | null;
};

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  modelId: string | null;
  title?: string | null;
};

export type SavedNode = {
  id: string;
  kind: string;
  title: string;
  position: { x: number; y: number };
  size?: { w: number; h: number };
  data: Record<string, unknown>;
};

export type SavedEdge = {
  id: string;
  from: string;
  to: string;
  kind?: string;
};

export type SavedBoard = {
  id: string;
  name: string;
  projectCwd: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: SavedNode[];
  edges: SavedEdge[];
  createdAt: string;
  updatedAt: string;
};

export type BoardListItem = {
  id: string;
  name: string;
  projectCwd: string;
  updatedAt: string;
  nodeCount: number;
};
