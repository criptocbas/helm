---
title: "Helm Sprint 1 host notes"
tags: [helm, sprint1, pty]
status: active
created: 2026-08-01
owner: Onchain
---

# Sprint 1 — host reliability notes

## Restore semantics

| Situation | Behavior |
|-----------|----------|
| Maximize / unmount card while app running | PTY stays alive; remount reattaches via `pty_list` |
| App restart / board load | PTYs are dead. TUI nodes restore as `disconnected` + lastLine *Session ended — respawn to continue*; `missing: true` disables auto-spawn |
| User clicks **Respawn** | New `pty_spawn` with saved `command` argv |

## Cap

- Soft limit: **8** concurrent live PTYs (env `HELM_MAX_PTYS`).
- Same `session_id` replacement does not double-count.
- Error text is user-facing (shown in TerminalHost error strip).

## Reap

- `agent_stop` → `pty_kill_all` + ACP kill  
- `RunEvent::Exit` / `ExitRequested` → same  

## Stall

- Host tracks last stdout/stdin activity per PTY.  
- After **10 minutes** quiet, emits **one** `pty://stall` until activity resumes.  
- UI maps to `needs_attention` (Frontend strip can surface it).

## Always-approve

- `grokTuiCommand` adds `--always-approve` only when `alwaysApprove === true`.  
- Prefs default `permissionMode: "ask"`.  
- Board restore strips `--always-approve` from saved argv.
