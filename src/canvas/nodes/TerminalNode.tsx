import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import type { HelmNodeData, TerminalNodeData } from "../../types/board";
import { TerminalHost } from "../../components/TerminalHost";
import { useHelmUi } from "../../lib/helmUi";

function TerminalNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as HelmNodeData;
  if (d.kind !== "terminal") return null;
  const term = d as TerminalNodeData;
  const { maximizedNodeId, maximizeNode, minimizeNode } = useHelmUi();
  const isMaximized = maximizedNodeId === id;

  return (
    <div
      className={`terminal-card ${selected ? "selected" : ""} ${
        isMaximized ? "maximized-placeholder" : ""
      }`}
    >
      <NodeResizer
        minWidth={320}
        minHeight={180}
        isVisible={!!selected && !isMaximized}
        lineClassName="!border-[var(--tool)]"
        handleClassName="!w-2.5 !h-2.5 !bg-[var(--tool)] !border-0"
      />
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-[var(--tool)] !w-2 !h-2 !border-0"
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] nodrag">
        <span className="status-dot working" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[12px] truncate">{term.label}</div>
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
            Terminal
          </div>
        </div>
        <button
          type="button"
          className="tui-chrome-btn"
          title={isMaximized ? "Restore" : "Maximize"}
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
        <div className="h-[220px] flex items-center justify-center text-[12px] text-[var(--text-muted)] px-3 text-center">
          Maximized — full-window view (Esc to restore)
        </div>
      ) : (
        <div className="h-[220px]">
          <TerminalHost
            shellKey={term.shellKey}
            cwd={term.cwd}
            active={!!selected}
          />
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-[var(--tool)] !w-2 !h-2 !border-0"
      />
    </div>
  );
}

export const TerminalNode = memo(TerminalNodeComponent);
