import { useEffect } from "react";
import { TerminalHost } from "./TerminalHost";

type Props = {
  label: string;
  shellKey: string;
  cwd: string;
  command?: string[] | null;
  kind: "tui" | "terminal";
  onMinimize: () => void;
};

/**
 * Full-window temporary view for an embedded Grok TUI or shell PTY.
 * Reuses the same PTY session id (TerminalHost reattaches via pty_list).
 */
export function TuiMaximizeOverlay({
  label,
  shellKey,
  cwd,
  command,
  kind,
  onMinimize,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onMinimize();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMinimize]);

  return (
    <div className="tui-maximize-overlay" role="dialog" aria-label={`Maximized ${label}`}>
      <div className="tui-maximize-chrome">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold truncate">{label}</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--accent)]">
            {kind === "tui" ? "Grok Build TUI" : "Terminal"}
          </span>
          <span className="text-[10px] mono text-[var(--text-faint)] truncate">
            {cwd}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-faint)] mono hidden sm:inline">
            Esc to restore
          </span>
          <button
            type="button"
            className="px-3 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[12px] font-semibold"
            onClick={onMinimize}
          >
            Restore
          </button>
        </div>
      </div>
      <div className="tui-maximize-body">
        <TerminalHost
          shellKey={shellKey}
          cwd={cwd}
          active
          command={command ?? null}
        />
      </div>
    </div>
  );
}
