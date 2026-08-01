import type { AgentNodeState } from "../types/board";
import { isAgentData, type HelmNode } from "../types/helm";

export type SessionTab = {
  nodeId: string;
  label: string;
  kind: "tui" | "acp" | "terminal";
  state?: AgentNodeState;
  shellKey?: string;
};

export function sessionsFromNodes(nodes: HelmNode[]): SessionTab[] {
  const tabs: SessionTab[] = [];
  for (const n of nodes) {
    if (n.type === "agent" && isAgentData(n.data)) {
      tabs.push({
        nodeId: n.id,
        label: n.data.label,
        kind: n.data.mode === "acp" ? "acp" : "tui",
        state: n.data.state,
        shellKey: n.data.shellKey,
      });
    } else if (n.type === "terminal" && n.data.kind === "terminal") {
      tabs.push({
        nodeId: n.id,
        label: n.data.label,
        kind: "terminal",
        shellKey: n.data.shellKey,
      });
    }
  }
  return tabs;
}

type Props = {
  tabs: SessionTab[];
  selectedId: string | null;
  maximizedId: string | null;
  onSelect: (nodeId: string) => void;
  onMaximize: (nodeId: string) => void;
  onMinimize: () => void;
};

function kindLabel(kind: SessionTab["kind"]): string {
  switch (kind) {
    case "tui":
      return "TUI";
    case "acp":
      return "ACP";
    case "terminal":
      return "SH";
  }
}

/**
 * Tab strip for open agents/terminals — click to focus & connect input,
 * maximize TUI/shell sessions for a full-window view.
 */
export function SessionTabs({
  tabs,
  selectedId,
  maximizedId,
  onSelect,
  onMaximize,
  onMinimize,
}: Props) {
  if (tabs.length === 0) return null;

  return (
    <div className="session-tabs shrink-0 flex items-center gap-1 px-2 h-9 border-b border-[var(--border)] bg-[var(--bg-panel)] overflow-x-auto">
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)] px-1.5 shrink-0">
        Sessions
      </span>
      {tabs.map((t) => {
        const active = t.nodeId === selectedId || t.nodeId === maximizedId;
        const canMaximize = t.kind === "tui" || t.kind === "terminal";
        const isMax = t.nodeId === maximizedId;
        return (
          <div
            key={t.nodeId}
            className={`session-tab ${active ? "active" : ""}`}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className="session-tab-main"
              onClick={() => onSelect(t.nodeId)}
              title={`Focus ${t.label}`}
            >
              {t.state ? <span className={`status-dot ${t.state}`} /> : null}
              <span className="session-tab-kind">{kindLabel(t.kind)}</span>
              <span className="session-tab-label">{t.label}</span>
            </button>
            {canMaximize ? (
              <button
                type="button"
                className="session-tab-max"
                title={isMax ? "Restore (Esc)" : "Maximize"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMax) onMinimize();
                  else {
                    onSelect(t.nodeId);
                    onMaximize(t.nodeId);
                  }
                }}
              >
                {isMax ? "Restore" : "Max"}
              </button>
            ) : null}
          </div>
        );
      })}
      <div className="flex-1" />
      <span className="text-[10px] text-[var(--text-faint)] mono px-2 shrink-0 hidden sm:inline">
        click tab to focus · Max expands TUI
      </span>
    </div>
  );
}
