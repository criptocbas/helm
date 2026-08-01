import type { AgentInfo, GrokStatus } from "../types/board";
import type { PermissionMode } from "../lib/prefs";
import type { VoiceHud } from "../voice/useVoice";
import { VoiceBar } from "./VoiceBar";

type Props = {
  boardName: string;
  onBoardNameChange: (name: string) => void;
  connected: boolean;
  connecting: boolean;
  grok: GrokStatus | null;
  agentInfo: AgentInfo | null;
  projectCwd: string;
  saveState: "idle" | "saving" | "saved";
  permissionMode: PermissionMode;
  voiceEnabled: boolean;
  voiceHud: VoiceHud;
  onConnect: () => void;
  onDisconnect: () => void;
  onPickProject: () => void;
  onSpawnAgent: () => void;
  onSpawnTerminal: () => void;
  onOpenPalette: () => void;
  onTogglePermissionMode: () => void;
  onToggleVoice: () => void;
  onMicDown: () => void;
  onMicUp: () => void;
};

export function TopBar({
  boardName,
  onBoardNameChange,
  connected,
  connecting,
  grok,
  agentInfo,
  projectCwd,
  saveState,
  permissionMode,
  voiceEnabled,
  voiceHud,
  onConnect,
  onDisconnect,
  onPickProject,
  onSpawnAgent,
  onSpawnTerminal,
  onOpenPalette,
  onTogglePermissionMode,
  onToggleVoice,
  onMicDown,
  onMicUp,
}: Props) {
  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-[var(--border)] bg-[var(--bg-elevated)] shrink-0">
      <div className="flex items-center gap-2 mr-1">
        <span className="text-[15px] font-bold tracking-tight text-[var(--accent)]">
          Helm
        </span>
        <input
          value={boardName}
          onChange={(e) => onBoardNameChange(e.target.value)}
          className="bg-transparent border-0 text-[12px] text-[var(--text-muted)] w-[140px] focus:outline-none focus:text-[var(--text)]"
          title="Board name"
        />
      </div>

      <div className="h-5 w-px bg-[var(--border)]" />

      {!connected ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting || grok?.available === false}
          className="px-3 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[12px] font-semibold disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect to Grok"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onDisconnect}
          className="px-3 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          Disconnect
        </button>
      )}

      <button
        type="button"
        onClick={onPickProject}
        className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[12px] text-[var(--text-muted)] mono max-w-[240px] truncate hover:bg-[var(--bg-hover)]"
        title={projectCwd}
      >
        {projectCwd || "Pick project…"}
      </button>

      <button
        type="button"
        onClick={onSpawnAgent}
        className="px-3 py-1 rounded-[var(--radius-sm)] border border-[var(--border-strong)] text-[12px] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-40"
        title="Spawn full Grok Build TUI on the canvas"
      >
        + Spawn agent
      </button>

      <button
        type="button"
        onClick={onSpawnTerminal}
        disabled={!projectCwd}
        className="px-3 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
      >
        + Terminal
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[11px] text-[var(--text-faint)] mono hover:bg-[var(--bg-hover)]"
        title="Command palette"
      >
        Ctrl+K
      </button>

      <button
        type="button"
        onClick={onTogglePermissionMode}
        className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[11px] text-[var(--text-faint)] hover:bg-[var(--bg-hover)]"
        title="Permission mode for agent tools"
      >
        perms: {permissionMode}
      </button>

      <VoiceBar
        enabled={voiceEnabled}
        hud={voiceHud}
        onToggleEnabled={onToggleVoice}
        onMicDown={onMicDown}
        onMicUp={onMicUp}
      />

      <div className="flex-1" />

      <span className="text-[11px] text-[var(--text-faint)]">
        {saveState === "saving"
          ? "Saving…"
          : saveState === "saved"
            ? "Saved"
            : ""}
      </span>

      <div className="text-[11px] text-[var(--text-faint)] mono">
        {connected
          ? agentInfo?.modelId || agentInfo?.agentVersion || "connected"
          : grok?.available
            ? `grok ${grok.version ?? ""}`.trim()
            : "grok not found"}
      </div>
    </header>
  );
}
