import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type {
  AgentNodeState,
  HelmNodeData,
  SubagentNodeData,
} from "../../types/board";

function stateLabel(state: AgentNodeState): string {
  switch (state) {
    case "working":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "needs_input":
      return "Needs you";
    case "disconnected":
      return "Offline";
    default:
      return state;
  }
}

function SubagentNodeComponent({ data, selected }: NodeProps) {
  const d = data as HelmNodeData;
  if (d.kind !== "subagent") return null;
  const sub = d as SubagentNodeData;
  return (
    <div
      className={`subagent-card ${selected ? "selected" : ""}`}
      data-state={sub.state}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-[var(--thought)] !w-1.5 !h-1.5 !border-0"
      />
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--border)]">
        <span className={`status-dot ${sub.state}`} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[12px] truncate" title={sub.label}>
            {sub.label}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)] flex items-center gap-1.5">
            <span className="subagent-state-pill">{stateLabel(sub.state)}</span>
            {sub.subagentType ? (
              <span className="opacity-80">{sub.subagentType}</span>
            ) : (
              <span>subagent</span>
            )}
            {sub.model ? (
              <span className="mono normal-case ml-0.5 opacity-70 truncate max-w-[72px]">
                {sub.model}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-2.5 py-2 min-h-[48px]">
        <p className="text-[11px] leading-snug text-[var(--text-muted)] line-clamp-3 m-0">
          {sub.lastLine || "Running…"}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-[var(--thought)] !w-1.5 !h-1.5 !border-0"
      />
    </div>
  );
}

export const SubagentNode = memo(SubagentNodeComponent);
