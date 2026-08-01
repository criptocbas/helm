---
title: "Helm host/runtime reliability (research)"
tags: [helm, research, runtime, acp, pty]
status: active
created: 2026-08-01
owner: Onchain
---

# Helm host/runtime reliability

**Scope:** system lane (not blockchain). Research only — no feature work.  
**App:** `/home/cbas/Documents/Programming/grok-build/helm`  
**Sources:** `ARCHITECTURE.md`, `docs/SMOKE.md`, `src-tauri/src/{acp,pty,lib,stt}.rs`, `src/hooks/useAcpBridge.ts`, `src/components/TerminalHost.tsx`, `src/lib/conductor.ts`, `prefs.ts`, `App.tsx`.

---

## 1. Process model

### Two agent runtimes (intentional dual path)

| Mode | Process | Canvas | Prompt path | Default? |
|------|---------|--------|-------------|----------|
| **TUI** | One **PTY** per agent: `grok --cwd … [--always-approve]` | Full xterm card | `ptyInjectText` | **Yes** (`conductor.spawnAgentTui`) |
| **ACP** | One shared **`grok agent stdio`** for the app; many `session/new` | Thin card + transcript | `session_prompt` | Legacy / experiments |

Human terminals are a third class: **app-owned PTYs** (no ACP `clientCapabilities.terminal`).

### ACP host (`acp.rs` / `lib.rs`)

- Single `SharedAgent` in `AppState` (one stdio bridge per Connect).
- Unix **process group** (`process_group(0)`) so stop can SIGTERM/SIGKILL tool children.
- Careful `is_alive` / `killed` semantics to avoid orphaning tool shells.
- Stdout-close → drain pending RPCs, kill tree, clear state, emit `acp://status` only if still own `on_exit` (avoids race with reconnect).
- Control RPC timeout 120s; `session/prompt` long timeout for multi-hour turns.

### PTY host (`pty.rs` / `TerminalHost.tsx`)

- Map: `session_id` (shellKey) → live PTY; spawn kills previous for same session.
- Reader + wait threads; base64 `pty://data` / `pty://exit` events.
- **Maximize:** `TuiMaximizeOverlay` remounts `TerminalHost` with same `shellKey`; host **reattaches** via `pty_list` if alive (does **not** kill PTY on React unmount of card — good).
- Remount **disposes xterm** → scrollback UI state is lost even if PTY continues (buffer only in process; new term starts empty until new output).

### Strengths

- Process-group kill is production-minded (Desk-class).
- PTY reattach by shellKey enables maximize without killing the agent.
- Conductor centralizes spawn/prompt/stop (P2-0).
- Board JSON persistence for layout; ACP `session_load` reattach path exists.

### Footguns

1. **Dual mode mental model** — fleet features (subagent graph, permission events, transcript dock) are rich on ACP; daily spawn is TUI. Voice/stop/prompt branch on mode; easy to “fix” only one path.
2. **Restart ≠ resume for TUI** — board restores `shellKey` + `command`, but OS PTYs die with the app. On remount, no live PTY → **new** `grok` spawn (fresh session), not resume. ACP path uses `session_load` + disk `~/.grok/sessions`.
3. **Subagents not persisted** (SMOKE) — live graph only.
4. **No stall / hung detection** — “working” can stick forever if process hangs without updates.
5. **N full TUIs = N heavy processes** — no resource caps; 8–12 agents is a memory/CPU cliff.
6. **Maximize remount** loses terminal scrollback UI (PTY still running).
7. **Transcript** does not full-reload history from disk on ACP reattach (SMOKE).

---

## 2. Daily-driver multi-agent requirements

| Need | Today | Gap |
|------|-------|-----|
| See all agents | Board + session tabs | OK |
| Steer focused agent | Composer + PTY inject | OK |
| Survive app restart | Layout yes; live sessions partial | **TUI resume missing** |
| Needs-you signal | `needs_input` + notify-send | ACP path strong; TUI self-handles inside process (less host visibility) |
| Permission control | `auto` \| `ask` prefs | Ask UI incomplete (ROADMAP C1); default **auto** |
| Stop / disconnect | ACP cancel + PTY kill_session | OK if mode-correct |
| Stall detection | None | **Missing** |
| Resource caps | None | **Missing** |
| Orphan audit | Group kill on ACP stop | PTY exit on remove; no global reap-on-crash audit |

---

## 3. Linux desktop realities

| Surface | Implementation | Risk |
|---------|----------------|------|
| Notifications | `notify-send` via `show_notification` (`acp.rs`) | Missing libnotify → silent fail |
| Webview | Tauri 2 / WebKitGTK | Web Speech STT flaky; SMOKE notes unsupported path |
| Local STT | `stt.rs` — Voxtype → whisper CLI + ffmpeg | Good Linux-native path if installed |
| Full-screen TUI | Maximize overlay + PTY reattach | Works if shellKey stable; scrollback gap |
| Process groups | Unix-only ACP kill | Correct for Linux; verify no zombies after Disconnect under load |

---

## 4. Security: `--always-approve` vs ask

| Layer | Default | Behavior |
|-------|---------|----------|
| Prefs `permissionMode` | **`auto`** | ACP: auto-pick allow option + auto-approve plans (`useAcpBridge`) |
| TUI spawn | `alwaysApprove: permissionMode === "auto"` | Passes **`--always-approve`** to `grok` (`conductor.grokTuiCommand`) |

**Implications:**

- Dogfood default is **max trust**: tools run without human gates at the agent CLI layer (TUI) and host auto-responds ACP permissions.
- Safer daily driver on real repos needs **`ask` default** (or explicit “dogfood” profile) + finished node-level permission/plan UI (C1).
- TUI always-approve is **stronger** than ACP auto-respond (bypasses agent’s own permission prompts entirely).
- Auto is acceptable for isolated worktrees / throwaway projects; dangerous for monorepos with deploy/secrets tools.

---

## 5. Top 3 recommendations (ranked)

### R1 — Session continuity for the default path (TUI)

**Why:** Daily driver fails the “army after coffee” test if restart or maximize loses context.

- Persist enough to **resume** Grok sessions (CLI resume flags / session ids if available), not only shellKey + argv.
- Keep maximize reattach (already good); add scrollback ring or avoid full xterm dispose when possible.
- Document clearly: ACP reattach vs TUI respawn until fixed.

**Paths:** `TerminalHost.tsx`, `conductor.ts`, `useBoardPersistence.ts`, `pty.rs`

### R2 — Safety profile: ask-by-default + visible gates

**Why:** Reliability includes not destroying the user’s machine while multi-agent is “working.”

- Default `permissionMode: "ask"` (or “safe” profile); keep auto as explicit dogfood.
- Ship C1: permission/plan on node when ask.
- Do not pass `--always-approve` unless auto/dogfood.

**Paths:** `prefs.ts`, `conductor.ts`, `useAcpBridge.ts`, `App.tsx`

### R3 — Host health plane (stall, caps, reap)

**Why:** CNVS-class stage needs predictable fleet behavior under load.

- Stall watchdog: working + no update / no PTY output for N minutes → `needs_attention` + notify.
- Soft cap concurrent agent PTYs (warn at 6, hard at 12) with user override.
- Disconnect/crash: inventory `pty_list` + ACP process group; fail closed on zombies.
- Optional: single shared ACP for orchestration + TUI only for “focus deep work” (reduces process fan-out).

**Paths:** `acp.rs`, `pty.rs`, `lib.rs`, `useAcpBridge.ts`, `App.tsx`

---

## File map (read for this research)

```
src-tauri/src/acp.rs       # stdio bridge, process group kill, notify-send
src-tauri/src/pty.rs       # multi-PTY map, spawn/write/resize/kill
src-tauri/src/lib.rs       # Tauri commands, AppState single agent
src-tauri/src/stt.rs       # Voxtype / whisper local STT
src/hooks/useAcpBridge.ts  # session updates, auto permission/plan
src/hooks/useBoardPersistence.ts  # board load + ACP session_load
src/components/TerminalHost.tsx   # xterm + PTY reattach
src/components/TuiMaximizeOverlay.tsx
src/lib/conductor.ts       # TUI default, always-approve flag
src/lib/prefs.ts           # permissionMode default auto
ARCHITECTURE.md, docs/SMOKE.md, ROADMAP.md
```
