---
title: "Helm Sprint 2 — host control plane (events + commands)"
tags: [helm, sprint2, acp, host]
status: active
created: 2026-08-01
owner: Onchain
---

# Sprint 2 host notes

## Safety (ask mode)

| Layer | Behavior |
|-------|----------|
| **Host (Rust)** | **Never** auto-responds to `session/request_permission` or `x.ai/exit_plan_mode`. Only emits events and applies `permission_respond` / `plan_approval_respond` when the UI invokes them. |
| **Frontend** | `permissionMode === "auto"` may auto-pick allow / approve plans in `useAcpBridge`. Default prefs are **`ask`** (Sprint 1). |
| **TUI spawn** | `--always-approve` only when `alwaysApprove === true` (`conductor.grokTuiCommand`). |

**No host path auto-approves tools or plans.**

---

## Reverse-request events (Frontend contract)

### `acp://permission` ← `session/request_permission`

| Field | Type | Notes |
|-------|------|--------|
| `requestId` | `u64` | JSON-RPC id — pass back to `permission_respond` |
| `sessionId` | `string \| null` | Prefer this for node mapping; host falls back to last-used agent session if missing |
| `toolCall` | object? | Raw ACP tool call |
| `toolTitle` | string? | Derived title/name |
| `toolKind` | string? | e.g. read/edit/execute when present |
| `toolSummary` | string? | One-line path/command/title for PermissionCard |
| `options[]` | `{ optionId, name, kind }` | Present allow/deny choices |
| `raw` | object | Full params |

**Respond:**

```ts
invoke("permission_respond", {
  requestId,
  optionId: "…" // or null / omit to cancel
})
```

- With `optionId`: outcome `selected`  
- Without: outcome `cancelled`  
Respond **once** per `requestId` (double-respond races the agent).

### `acp://plan-approval` ← `x.ai/exit_plan_mode`

| Field | Type | Notes |
|-------|------|--------|
| `requestId` | `u64` | Pass to `plan_approval_respond` |
| `sessionId` | `string` | Session fallback applied if empty in params |
| `toolCallId` | string? | |
| `planContent` | string? | Full plan markdown when agent sent it |
| `planExcerpt` | string? | First ~2000 chars for dock cards |

Also emits `acp://session-update` with `sessionUpdate: "plan_doc"` when content present.

**Respond:**

```ts
invoke("plan_approval_respond", {
  requestId,
  outcome: "approved" | "cancelled" | "abandoned",
  feedback: null // optional string
})
```

Host rejects unknown `outcome` strings with a clear error (no silent drop).

---

## Disk hydrate commands (board graph)

Do **not** require ACP connect for these — they read `~/.grok/sessions/...` only.

| Command | Args | Returns |
|---------|------|---------|
| `session_read_plan` | `sessionId`, `cwd` | `string \| null` (`plan.md` or `goal/plan.md`) |
| `session_list_subagents` | `sessionId`, `cwd` | `DiskSubagentMeta[]` (newest first, max 40) |
| `session_read_subagent_output` | `sessionId`, `cwd`, `subagentId`, `maxChars?` | `string \| null` (capped finish text) |

### `DiskSubagentMeta` (camelCase)

`subagentId`, `childSessionId?`, `parentSessionId?`, `subagentType?`, `description?`, `status?`, `model?`, `startedAt?`, `completedAt?`, `durationMs?`, `toolCalls?`, `turns?`, `contextSource?`, `hasOutput`

Path shape:

```
~/.grok/sessions/<urlencode(cwd)>/<sessionId>/subagents/<id>/meta.json
~/.grok/sessions/<urlencode(cwd)>/<sessionId>/plan.md
```

Live spawn/finish still arrives on `acp://session-update` (`subagent_spawned` / `subagent_finished`) — hydrate is for **reload / late board graph**.

---

## Session update (unchanged)

`acp://session-update` for standard + `_x.ai/session/update` / `x.ai/session/update`.

---

## Verify

```bash
cd src-tauri && cargo check
```

Frontend ask-mode UI (PermissionCard / plan Approve) is Sprint 2 Frontend — host contracts above are ready.
