import type { AgentNodeData, ChatItem } from "../types/board";

type Props = {
  open: boolean;
  onClose: () => void;
  agent: AgentNodeData | null;
  label: string;
};

function roleClass(role: ChatItem["role"]): string {
  switch (role) {
    case "user":
      return "text-[var(--accent)]";
    case "tool":
      return "text-[var(--tool)]";
    case "thought":
      return "text-[var(--thought)]";
    case "subagent":
      return "text-[var(--thought)]";
    case "system":
      return "text-[var(--danger)]";
    default:
      return "text-[var(--text-faint)]";
  }
}

export function TranscriptDock({ open, onClose, agent, label }: Props) {
  if (!open) return null;

  const items = agent?.transcript ?? [];

  return (
    <aside className="w-[360px] max-w-[42vw] border-l border-[var(--border)] bg-[var(--bg-elevated)] flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-[var(--border)]">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold truncate">{label}</div>
          <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">
            Transcript
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-[var(--text-muted)] px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg-hover)]"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {items.length === 0 ? (
          <p className="text-[12px] text-[var(--text-faint)] m-0">No messages yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="text-[12px]">
              <div className={`mono text-[10px] uppercase mb-0.5 ${roleClass(item.role)}`}>
                {item.role}
                {item.meta ? (
                  <span className="normal-case text-[var(--text-faint)] ml-2">
                    {item.meta}
                  </span>
                ) : null}
              </div>
              <div className="text-[var(--text-muted)] whitespace-pre-wrap break-words leading-relaxed">
                {item.text}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
