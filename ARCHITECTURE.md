# Helm — Architecture

Helm is a **desktop shell** around the official Grok Build agent. It does not reimplement tools, models, or the agent loop.

```
┌──────────────────────────────────────────────────────────────┐
│  Helm (Tauri 2 + React + TypeScript + Tailwind)              │
│  Canvas engine · Node registry · Voice router · Attention    │
│  Board persistence · Command palette · Themes                │
└────────────────────────────┬─────────────────────────────────┘
                             │ Tauri commands + events
┌────────────────────────────▼─────────────────────────────────┐
│  Helm Rust host                                              │
│  ACP bridge (stdio) · PTY · STT · board store · MCP (later)  │
└────────────────────────────┬─────────────────────────────────┘
                             │ JSON-RPC ACP
┌────────────────────────────▼─────────────────────────────────┐
│  grok agent stdio / serve                                    │
│  sessions · subagents · tools · workflows · memory           │
└──────────────────────────────────────────────────────────────┘
```

## Principles

1. **CLI is the engine** — spawn `grok agent stdio`; never fork the agent loop.
2. **Local sessions stay local** — `~/.grok` remains source of truth for transcripts/resume.
3. **UI owns presentation** — stream updates become node HUDs + docks; agent owns file edits.
4. **Attention is first-class** — needs_input must never look idle.
5. **Client FS/terminal off** — tools run inside the agent process (same as healthy Desk setup).

## Process model

- One `grok agent stdio` process per Helm connection (v1).
- Many ACP sessions → many **agent** nodes on one board.
- Subagents → **subagent** child nodes + edges (`spawned`).
- Permissions / plan approvals attach to the **node**.
- Human terminals are Desk-style **app-owned PTYs**, not ACP `clientCapabilities.terminal`.

## Domain model

```ts
type Board = {
  id: string;
  name: string;
  projectCwd: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  createdAt: string;
  updatedAt: string;
};

type NodeKind =
  | "agent"
  | "subagent"
  | "terminal"
  | "browser"
  | "note"
  | "workflow"
  | "group";

type AgentNodeState =
  | "idle"
  | "working"
  | "needs_input"
  | "needs_attention"
  | "completed"
  | "failed"
  | "disconnected";

type CanvasNode = {
  id: string;
  kind: NodeKind;
  title: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  zIndex: number;
  data: unknown; // kind-specific
};

type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  kind: "spawned" | "handoff" | "review" | "user";
};
```

## Persistence

| Data | Location |
|---|---|
| Boards | `~/.config/grok-helm/boards/<id>.json` |
| Prefs | `~/.config/grok-helm/prefs.json` |
| Recents | `~/.config/grok-helm/recents.json` |
| Session truth | `~/.grok/sessions/...` |

## Canvas UX

1. Everything important is a **node**.  
2. Card face is a **HUD**; expand for full transcript.  
3. One **focused** node receives voice/keyboard inject.  
4. `needs_input` always wins visually.  
5. Board maps to one primary **project cwd**.  
6. Workflows paint temporary **orchestration graphs**.

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 |
| UI | React + TypeScript + Tailwind |
| Canvas | `@xyflow/react` (React Flow) |
| ACP | Rust bridge (patterns from Grok Desk) |
| Terminal | xterm.js + portable-pty (Phase 1) |

## Frontend module map (Phase 2+)

```
src/
  lib/conductor.ts     # shared spawn/prompt/stop/list — voice/MCP/workflows call this
  lib/prefs.ts         # permissionMode, feature flags
  lib/acpParse.ts      # session/update parsing
  hooks/useAcpBridge.ts
  hooks/useBoardPersistence.ts
  components/TopBar · Composer · BoardCanvas · CommandPalette · TranscriptDock
  canvas/nodes/*       # agent · subagent · terminal (+ note/workflow/browser later)
  App.tsx              # composition only
```

**Rule:** Feature tracks must not reintroduce raw `session_prompt` invokes outside `conductor.ts`.

## Reference

- Sister app: `../grok-desk/ARCHITECTURE.md`
- Protocol: https://agentclientprotocol.com
- Grok agent mode: `~/.grok/docs/user-guide/15-agent-mode.md`
