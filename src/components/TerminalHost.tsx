import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type PtySpawnResult = {
  ptyId: string;
  sessionId: string;
  cwd: string;
};

type PtyDataEvent = {
  ptyId: string;
  sessionId: string;
  data: string;
};

type PtyExitEvent = {
  ptyId: string;
  sessionId: string;
  code: number | null;
};

type PtyInfo = {
  ptyId: string;
  sessionId: string;
  cwd: string;
  alive: boolean;
  idleSecs?: number | null;
};

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Props = {
  /** Stable key for this terminal node (used as PTY session_id). */
  shellKey: string;
  cwd: string;
  active: boolean;
  /**
   * Optional argv. When omitted, spawns interactive shell.
   * For full Grok TUI: build via `grokTuiCommand` (always-approve only when auto).
   */
  command?: string[] | null;
  /**
   * When false, only reattach a live PTY — do not spawn a new process.
   * Used after board restore (PTYs die with the app).
   */
  autoSpawn?: boolean;
  /** Called when the PTY process exits */
  onExit?: (code: number | null) => void;
  /** Called after user-initiated respawn succeeds */
  onRespawned?: () => void;
};

/**
 * Embedded PTY host — human shell or full `grok` TUI.
 */
export function TerminalHost({
  shellKey,
  cwd,
  active,
  command,
  autoSpawn = true,
  onExit,
  onRespawned,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<
    "starting" | "running" | "exited" | "error" | "ended"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [forceSpawn, setForceSpawn] = useState(false);
  const [bootKey, setBootKey] = useState(0);

  const fit = useCallback(() => {
    const f = fitRef.current;
    const t = termRef.current;
    const id = ptyIdRef.current;
    if (!f || !t) return;
    try {
      f.fit();
      if (id && t.cols > 0 && t.rows > 0) {
        void invoke("pty_resize", {
          ptyId: id,
          cols: t.cols,
          rows: t.rows,
        }).catch(() => {});
      }
    } catch {
      /* not laid out */
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      theme: {
        background: "#0a0e16",
        foreground: "#e6eaf2",
        cursor: "#f0b429",
        selectionBackground: "rgba(240,180,41,0.25)",
      },
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;
    requestAnimationFrame(fit);

    const ro = new ResizeObserver(() => fit());
    ro.observe(hostRef.current);

    const onData = term.onData((data) => {
      const id = ptyIdRef.current;
      if (!id) return;
      void invoke("pty_write", { ptyId: id, data }).catch(() => {});
    });

    return () => {
      ro.disconnect();
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per shellKey
  }, [shellKey]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const allowSpawn = autoSpawn || forceSpawn;

    void (async () => {
      setStatus("starting");
      setError(null);
      try {
        const listed = await invoke<PtyInfo[]>("pty_list", {
          sessionId: shellKey,
        });
        const existing = listed.find((p) => p.alive);
        const term = termRef.current;
        const cols = term?.cols || 100;
        const rows = term?.rows || 28;
        let ptyId: string;
        if (existing) {
          ptyId = existing.ptyId;
        } else if (!allowSpawn) {
          // Honest restore: no live PTY after app restart — do not fake reattach.
          if (!cancelled) {
            setStatus("ended");
            setError("Session ended — respawn to continue");
            termRef.current?.writeln(
              "\r\n\x1b[90m[no live PTY — session ended with the previous app run]\x1b[0m",
            );
            onExit?.(null);
          }
          return;
        } else {
          const spawned = await invoke<PtySpawnResult>("pty_spawn", {
            sessionId: shellKey,
            cwd,
            cols,
            rows,
            command: command ?? null,
          });
          ptyId = spawned.ptyId;
          if (forceSpawn) onRespawned?.();
        }
        if (cancelled) return;
        ptyIdRef.current = ptyId;
        setStatus("running");
        setForceSpawn(false);
        fit();
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(String(e));
        }
      }
    })();

    void listen<PtyDataEvent>("pty://data", (ev) => {
      if (ev.payload.sessionId !== shellKey) return;
      if (ev.payload.ptyId !== ptyIdRef.current) return;
      const term = termRef.current;
      if (!term) return;
      term.write(b64ToUint8(ev.payload.data));
    }).then((u) => unsubs.push(u));

    void listen<PtyExitEvent>("pty://exit", (ev) => {
      if (ev.payload.sessionId !== shellKey) return;
      if (ev.payload.ptyId !== ptyIdRef.current) return;
      setStatus("exited");
      ptyIdRef.current = null;
      onExit?.(ev.payload.code ?? null);
      termRef.current?.writeln(
        `\r\n\x1b[90m[process exited${
          ev.payload.code != null ? ` · ${ev.payload.code}` : ""
        }]\x1b[0m`,
      );
    }).then((u) => unsubs.push(u));

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [
    shellKey,
    cwd,
    command,
    fit,
    onExit,
    onRespawned,
    autoSpawn,
    forceSpawn,
    bootKey,
  ]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(fit);
      termRef.current?.focus();
    }
  }, [active, fit]);

  const respawn = () => {
    setForceSpawn(true);
    setBootKey((k) => k + 1);
    setError(null);
    setStatus("starting");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[10px] text-[var(--text-faint)]">
        <span className="uppercase tracking-wider">{status}</span>
        <span className="mono truncate flex-1">
          {command?.length ? command.join(" ") : cwd}
        </span>
        {status === "ended" || status === "exited" || status === "error" ? (
          <button
            type="button"
            className="px-2 py-0.5 rounded border border-[var(--border)] text-[var(--accent)] hover:bg-[var(--surface-2)]"
            onClick={(e) => {
              e.stopPropagation();
              respawn();
            }}
          >
            Respawn
          </button>
        ) : null}
        {error ? (
          <span className="text-[var(--danger)] truncate max-w-[40%]">{error}</span>
        ) : null}
      </div>
      <div
        ref={hostRef}
        className="flex-1 min-h-0 px-1 py-1 nodrag nowheel nopan"
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Inject text into a live PTY (for voice / conductor). */
export async function ptyInjectText(
  shellKey: string,
  text: string,
  pressEnter = true,
): Promise<void> {
  const listed = await invoke<PtyInfo[]>("pty_list", { sessionId: shellKey });
  const live = listed.find((p) => p.alive);
  if (!live) throw new Error("No live TUI for this agent");
  let data = text;
  if (pressEnter && !data.endsWith("\n") && !data.endsWith("\r")) {
    data += "\r";
  }
  await invoke("pty_write", { ptyId: live.ptyId, data });
}
