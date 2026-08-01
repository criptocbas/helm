import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import type {
  AgentNodeData,
  AgentNodeState,
  HelmNodeData,
} from "../../types/board";
import { TerminalHost } from "../../components/TerminalHost";
import { useHelmUi } from "../../lib/helmUi";

function stateLabel(state: AgentNodeState): string {
  switch (state) {
    case "working":
      return "Working";
    case "needs_input":
      return "Needs you";
    case "needs_attention":
      return "Attention";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "disconnected":
      return "Offline";
    default:
      return "Idle";
  }
}

function AgentNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as HelmNodeData;
  if (d.kind !== "agent") return null;
  const agent = d as AgentNodeData;
  const isTui = agent.mode === "tui" && !!agent.shellKey;
  const { maximizedNodeId, maximizeNode, minimizeNode } = useHelmUi();
  const isMaximized = maximizedNodeId === id;

  if (isTui) {
    return (
      <div
        className={`agent-tui-card ${selected ? "selected" : ""} ${
          isMaximized ? "maximized-placeholder" : ""
        }`}
        data-state={agent.state}
      >
        <NodeResizer
          minWidth={480}
          minHeight={280}
          isVisible={!!selected && !isMaximized}
          lineClassName="!border-[var(--accent)]"
          handleClassName="!w-2.5 !h-2.5 !bg-[var(--accent)] !border-0"
        />
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-[var(--accent)] !w-2 !h-2 !border-0"
        />
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] nodrag">
          <span className={`status-dot ${agent.state}`} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[13px] truncate tracking-tight">
              {agent.label}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
              Grok Build TUI
              <span className="mono normal-case ml-2 opacity-70">
                {agent.shellKey?.slice(0, 10)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="tui-chrome-btn"
            title={isMaximized ? "Restore" : "Maximize TUI"}
            onClick={(e) => {
              e.stopPropagation();
              if (isMaximized) minimizeNode();
              else maximizeNode(id);
            }}
          >
            {isMaximized ? "🗗" : "⛶"}
          </button>
        </div>
        {isMaximized ? (
          <div className="h-[340px] flex items-center justify-center text-[12px] text-[var(--text-muted)] px-4 text-center">
            Maximized — use the full-window view (or ⛶ / Esc to restore)
          </div>
        ) : (
          <div className="agent-tui-body">
            <TerminalHost
              shellKey={agent.shellKey!}
              cwd={agent.cwd}
              active={!!selected}
              command={agent.command ?? null}
              autoSpawn={!agent.missing}
            />
          </div>
        )}
        <div className="px-2 py-1 border-t border-[var(--border)] text-[9px] text-[var(--text-faint)] mono truncate">
          {agent.cwd}
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-[var(--accent)] !w-2 !h-2 !border-0"
        />
      </div>
    );
  }

  // Legacy ACP card
  return (
    <div
      className={`agent-card ${selected ? "selected" : ""} ${agent.missing ? "missing" : ""}`}
      data-state={agent.state}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-[var(--text-faint)] !w-2 !h-2 !border-0"
      />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span className={`status-dot ${agent.state}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[13px] truncate tracking-tight">
            {agent.label}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
            {stateLabel(agent.state)} · ACP
            {agent.sessionId ? (
              <span className="mono normal-case tracking-normal ml-2 opacity-70">
                {agent.sessionId.slice(0, 8)}
              </span>
            ) : null}
            {agent.missing ? (
              <span className="ml-2 text-[var(--danger)] normal-case">
                missing
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-3 py-2.5 min-h-[72px]">
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)] line-clamp-4 m-0">
          {agent.lastLine || "Awaiting orders…"}
        </p>
      </div>
      <div className="px-3 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)] mono truncate">
        {agent.cwd}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-[var(--text-faint)] !w-2 !h-2 !border-0"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
