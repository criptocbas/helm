import { type RefObject } from "react";
import type { AgentNodeData } from "../types/board";

type Props = {
  selectedAgent: AgentNodeData | null;
  prompt: string;
  onPromptChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenDock: () => void;
  busy: boolean;
  promptRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({
  selectedAgent,
  prompt,
  onPromptChange,
  onSend,
  onStop,
  onOpenDock,
  busy,
  promptRef,
}: Props) {
  const canSend =
    !!selectedAgent &&
    (selectedAgent.mode === "tui"
      ? !!selectedAgent.shellKey
      : !!selectedAgent.sessionId) &&
    !busy;

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-elevated)] shrink-0">
      <div className="flex items-end gap-2 px-4 py-3">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1 flex items-center gap-2">
            <span>
              {selectedAgent
                ? selectedAgent.mode === "tui"
                  ? `Inject → ${selectedAgent.label} (Grok TUI)`
                  : `Orders → ${selectedAgent.label}`
                : "Select an agent node to command"}
            </span>
            {selectedAgent && selectedAgent.mode === "acp" ? (
              <button
                type="button"
                className="normal-case tracking-normal text-[var(--text-muted)] underline"
                onClick={onOpenDock}
              >
                transcript
              </button>
            ) : null}
            {selectedAgent?.mode === "tui" ? (
              <span className="normal-case tracking-normal text-[var(--accent)]">
                full TUI — click inside node to type, or inject below
              </span>
            ) : null}
          </div>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={!canSend}
            placeholder={
              selectedAgent
                ? selectedAgent.mode === "tui"
                  ? "Inject into Grok TUI… (Enter sends into the embedded terminal)"
                  : "Tell this agent what to do… (Enter send · Shift+Enter newline · Ctrl+K commands)"
                : "Spawn and select an agent first"
            }
            rows={2}
            className="w-full resize-none rounded-[var(--radius)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={onStop}
          disabled={!selectedAgent}
          className="px-3 py-2 rounded-[var(--radius)] border border-[var(--border)] text-[12px] text-[var(--text-muted)] disabled:opacity-40"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend || !prompt.trim()}
          className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold disabled:opacity-40"
        >
          {busy ? "Working…" : "Send"}
        </button>
      </div>
    </footer>
  );
}
