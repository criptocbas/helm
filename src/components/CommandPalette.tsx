import { useEffect, useMemo, useState } from "react";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
};

export function CommandPalette({ open, onClose, actions }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) ||
        (a.hint && a.hint.toLowerCase().includes(needle)),
    );
  }, [actions, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(520px,92vw)] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl overflow-hidden">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const a = filtered[idx];
              if (a && !a.disabled) {
                a.run();
                onClose();
              }
            }
          }}
          placeholder="Command…"
          className="w-full bg-transparent border-0 border-b border-[var(--border)] px-4 py-3 text-[14px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[var(--text-faint)]">
              No matches
            </div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                type="button"
                disabled={a.disabled}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  if (!a.disabled) {
                    a.run();
                    onClose();
                  }
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left text-[13px] disabled:opacity-40 ${
                  i === idx ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="flex-1 text-[var(--text)]">{a.label}</span>
                {a.hint ? (
                  <span className="text-[11px] text-[var(--text-faint)] mono">
                    {a.hint}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)]">
          ↑↓ navigate · Enter run · Esc close
        </div>
      </div>
    </div>
  );
}
