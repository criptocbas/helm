import type { AgentNodeState } from "../types/board";
import { isAgentData, type HelmNode } from "../types/helm";

export type NeedsYouItem = {
  nodeId: string;
  label: string;
  state: AgentNodeState;
  lastLine?: string;
};

const ALERT_STATES: AgentNodeState[] = [
  "needs_input",
  "needs_attention",
  "failed",
];

export function needsYouFromNodes(nodes: HelmNode[]): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  for (const n of nodes) {
    if (n.type === "agent" && isAgentData(n.data)) {
      if (ALERT_STATES.includes(n.data.state)) {
        out.push({
          nodeId: n.id,
          label: n.data.label,
          state: n.data.state,
          lastLine: n.data.lastLine,
        });
      }
    } else if (n.type === "subagent" && n.data.kind === "subagent") {
      if (ALERT_STATES.includes(n.data.state)) {
        out.push({
          nodeId: n.id,
          label: n.data.label,
          state: n.data.state,
          lastLine: n.data.lastLine,
        });
      }
    }
  }
  // Needs you first, then attention, then failed
  const rank = (s: AgentNodeState) =>
    s === "needs_input" ? 0 : s === "needs_attention" ? 1 : 2;
  return out.sort((a, b) => rank(a.state) - rank(b.state));
}

function stateLabel(state: AgentNodeState): string {
  switch (state) {
    case "needs_input":
      return "Needs you";
    case "needs_attention":
      return "Attention";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

type Props = {
  items: NeedsYouItem[];
  selectedId: string | null;
  onFocus: (nodeId: string) => void;
};

/**
 * Always-visible attention strip — who in the fleet needs the conductor.
 * Click focuses + pans via parent focusSession.
 */
export function NeedsYouStrip({ items, selectedId, onFocus }: Props) {
  if (items.length === 0) {
    return (
      <div
        className="needs-you-strip needs-you-strip--clear shrink-0"
        aria-live="polite"
      >
        <span className="needs-you-label">Needs you</span>
        <span className="needs-you-empty">All clear — no agents waiting</span>
      </div>
    );
  }

  return (
    <div
      className="needs-you-strip needs-you-strip--alert shrink-0"
      role="region"
      aria-label="Agents that need attention"
    >
      <span className="needs-you-label needs-you-label--pulse">
        Needs you · {items.length}
      </span>
      <div className="needs-you-list">
        {items.map((item) => (
          <button
            key={item.nodeId}
            type="button"
            className={`needs-you-chip ${
              item.nodeId === selectedId ? "active" : ""
            } state-${item.state}`}
            onClick={() => onFocus(item.nodeId)}
            title={item.lastLine || stateLabel(item.state)}
          >
            <span className={`status-dot ${item.state}`} />
            <span className="needs-you-chip-state">{stateLabel(item.state)}</span>
            <span className="needs-you-chip-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
