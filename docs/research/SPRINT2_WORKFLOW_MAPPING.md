---
title: "Sprint 2 — Grok workflow / subagent → board node mapping"
tags: [helm, sprint2, workflow, subagent, acp, research]
status: active
created: 2026-07-31
---

# Sprint 2 — Workflow / subagent mapping for Frontend

**Purpose:** How Grok Build workflows and subagents appear on disk and over ACP, so Helm can map board nodes without inventing protocol.  
**Audience:** Frontend (graph UX), Onchain (host hydrate), EngLead.  
**No code this turn.**

---

## 1. Session root on disk

Path pattern (confirmed by Helm host + live `~/.grok`):

```text
~/.grok/sessions/<urlencode(project_cwd)>/<session_id>/
  summary.json
  chat_history.jsonl
  updates.jsonl          # durable stream of ACP-ish updates (incl. workflow_*)
  events.jsonl
  plan.md                # optional (also goal/plan.md)
  subagents/
    <subagent_id>/
      meta.json
      output.json        # present when finished (capped read)
  workflows/
    wf_<run_id>/
      state.json
      journal.jsonl
      script.rhai
      args.json
      scripts/
      scratch/
```

**Cwd encoding:** path segments percent-encoded (`/` → `%2F`), matching `urlencoding_path` in `helm/src-tauri/src/acp.rs`.

**Host already implements (Rust, not all wired to Tauri invoke yet):**

| API | Disk | Notes |
|-----|------|--------|
| `AcpClient::list_session_subagents(session_id, cwd)` | `…/subagents/*/meta.json` | Cap 40; newest first |
| `AcpClient::read_subagent_output(session_id, cwd, id, max_chars)` | `…/output.json` | Prefer `{"output":"..."}` field |
| `AcpClient::read_plan_doc(session_id, cwd)` | `plan.md` or `goal/plan.md` | Full text if present |

**Gap:** `lib.rs` `invoke_handler` (as of this research) does **not** expose `list_session_subagents` / `read_plan_doc` / `read_subagent_output` — Onchain Sprint 2 item.

---

## 2. Live ACP stream (primary for live board)

Updates arrive as `session/update` (and xAI extension `_x.ai/session/update` in disk logs) with `params.sessionId` + `params.update.sessionUpdate`.

### 2a. Subagent events (already handled in Helm)

**`subagent_spawned`** (Desk fixture + live workflow run):

```json
{
  "sessionUpdate": "subagent_spawned",
  "subagent_id": "019fa…",
  "child_session_id": "019fa…",
  "parent_session_id": "019fa…",
  "subagent_type": "general-purpose",
  "description": "researcher-0",
  "model": "grok-4.5",
  "workflow_run_id": "wf_019fa…",
  "capability_mode": "read-only",
  "effective_context_source": "new"
}
```

- `workflow_run_id` is **present only when spawned by a workflow**; ad-hoc `task` tool spawns omit it.
- Parent board agent is the node whose `sessionId === params.sessionId` (parent ACP session), not necessarily `parent_session_id` if they ever diverge (in samples they match).

**`subagent_finished`:**

```json
{
  "sessionUpdate": "subagent_finished",
  "subagent_id": "019fa…",
  "status": "completed",
  "duration_ms": 92359,
  "tool_calls": 15,
  "turns": 1,
  "output": "…"
}
```

Helm today: `src/lib/acpParse.ts` + `useAcpBridge.ts` → node id `sub-${subagentId}`, edge `e-${parent.id}-sub-${id}`, kind `spawned`.

### 2b. Workflow events (live, **not** parsed by Helm yet)

**`workflow_updated`** — full snapshot, not a delta. Example fields from real `updates.jsonl` (deep-research run):

| Field | Role for board |
|-------|----------------|
| `run_id` | Stable WorkflowNode id key (`wf_…`) |
| `revision` | Monotonic; ignore older revisions if racing |
| `name` | Node title (e.g. `deep-research`) |
| `objective` | Tooltip / dock body |
| `status` | `active` \| `complete` \| (treat unknown as active) |
| `phases[]` | `{ title, state: pending\|active\|done }` — phase strip UI |
| `current_phase` | Highlight |
| `agents_used` / `agent_budget` / `active_agents` | HUD counters |
| `agents[]` | `{ agent_id, label, phase, state, tokens_used?, duration_ms? }` — optional roster |
| `last_event` / `last_event_detail` | lastLine |

**Disk mirror:** `workflows/<run_id>/state.json` → `{ version, state: { run_id, name, objective, status, phases, current_phase, history[], result_summary, … } }`.  
**Journal:** `journal.jsonl` lines `{ seq, kind: "spawn_agent", result: { agent_id, success, output } }` — hydrate only if live events missed; prefer ACP.

**Scripts catalog (not a run):** `~/.grok/workflows/*.rhai` and project `.grok/workflows/` — definitions, not board nodes until a run starts.

### 2c. Plan doc (not a graph)

`plan.md` is markdown for “ask / plan approval” and dock context — **not** a multi-node workflow graph. Map to agent dock / PermissionCard plan summary, not WorkflowNode.

---

## 3. Disk `meta.json` (hydrate after reattach)

Sample fields (live):

```json
{
  "subagent_id": "…",
  "parent_session_id": "…",
  "child_session_id": "…",
  "subagent_type": "explore",
  "description": "Content inventory agent",
  "status": "completed",
  "started_at": "…Z",
  "completed_at": "…Z",
  "duration_ms": 248938,
  "tool_calls": 112,
  "turns": 1,
  "effective_model_id": "grok-4.5",
  "child_cwd": "/path/to/project"
}
```

`prompt` may be huge — **do not** put full prompt on the card; label = `description` (≤200 chars as parse already does).

---

## 4. Top 3 mapping rules (Frontend must follow)

### Rule 1 — Stable IDs, never random

| Entity | Board node `id` | Edge |
|--------|-----------------|------|
| Parent agent | Existing agent node (session-bound) | — |
| Subagent | **`sub-${subagent_id}`** | **`e-${parentNodeId}-sub-${subagent_id}`**, `source=parent`, `target=sub`, label `spawned` |
| Workflow run | **`wf-${run_id}`** (or raw `run_id` if already prefixed `wf_`) | Optional: `e-wf-${run_id}-sub-${agent_id}` **or** group membership only |

Idempotent upsert on spawn/update; do not create a second node if id exists.

### Rule 2 — Parent always comes from the update’s session, children hang off that agent

1. Resolve **parent agent node** by `params.sessionId` (the stream session).  
2. Place subagent under that parent (`parentNodeId`, `parentSessionId`).  
3. If `workflow_run_id` is set: also tag `data.workflowRunId` on the subagent; ensure WorkflowNode for that run exists (create on first `workflow_updated` or first spawn carrying `workflow_run_id`).  
4. **Do not** open a second top-level agent node per subagent unless product later adds “promote child to agent” (out of Sprint 2).

Layout: keep existing grid (siblings offset under parent); workflow node sits **above or left of** parent agent, not as a sibling in the subagent row.

### Rule 3 — Live stream wins; disk is reattach-only

| Mode | Source of truth |
|------|-----------------|
| Live ACP connected | `subagent_spawned` / `subagent_finished` / `workflow_updated` only |
| After `session_load` / board restore | `list_session_subagents` + optional scan `workflows/*/state.json` (or last `workflow_updated` if host adds it later) |
| Conflict | Prefer higher `workflow_updated.revision`; for subagents prefer finished > working if both seen |

**Sprint 2 MVP if host has no workflow API yet:** ship subagent graph from live events + hydrate via `list_session_subagents`; treat `workflow_updated` as **optional** — if Frontend sees `sessionUpdate === "workflow_updated"` (today falls through as `kind: "other"` in `acpParse`), paint thin WorkflowNode; else document dependency and rely on subagent edges alone.

---

## 5. Suggested node data shapes (for Frontend, non-binding)

```ts
// SubagentNodeData (extend existing)
{
  kind: "subagent",
  subagentId: string,          // = subagent_id
  parentSessionId: string,
  parentNodeId: string,
  label: string,               // description
  state: "working" | "completed" | "failed" | "disconnected",
  lastLine: string,
  subagentType?: string,
  model?: string,
  workflowRunId?: string,      // NEW — from event or omit
}

// WorkflowNodeData (new, thin)
{
  kind: "workflow",
  runId: string,
  parentSessionId: string,     // host agent session
  parentNodeId: string,
  name: string,
  objective?: string,
  status: string,              // active | complete | …
  currentPhase?: string,
  phases: { title: string; state: string }[],
  agentsUsed?: number,
  agentBudget?: number,
  lastLine: string,            // last_event + detail
  revision: number,
}
```

---

## 6. Parse gap (product note for Frontend + Onchain)

`src/lib/acpParse.ts` known kinds:  
`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `subagent_spawned`, `subagent_finished`, `user_message_chunk` — else **`other`**.

**`workflow_updated` is currently `other`.** Minimal change for Sprint 2 graph: add `workflow_updated` to known kinds + thin handler (upsert WorkflowNode). No host change required for live path if updates already forward raw session updates (confirm Onchain).

---

## 7. Explicit non-goals (Sprint 2)

- Rendering full `journal.jsonl` / Rhai script as nodes  
- Multi-harness foreign agents  
- Treating `plan.md` todos as workflow phases  
- Nested subagent-of-subagent (not observed as first-class board case; parent stream session is always the host agent)

---

## 8. Evidence sources

| Source | Path / note |
|--------|-------------|
| Helm host disk readers | `helm/src-tauri/src/acp.rs` (`list_session_subagents`, `read_plan_doc`, `read_subagent_output`) |
| Helm live subagent UI | `helm/src/hooks/useAcpBridge.ts`, `helm/src/lib/acpParse.ts` |
| Desk fixtures | `grok-desk/docs/fixtures/subagent_spawned.json`, `subagent_finished.json` |
| Live subagent meta | `~/.grok/sessions/…/subagents/*/meta.json` |
| Live workflow run | `…/workflows/wf_019fa157848072d1b8942fd7fc03d792/{state.json,journal.jsonl}` |
| Live ACP stream | same session `updates.jsonl` — `workflow_updated` + `subagent_*` with `workflow_run_id` |

---

## 9. One-liner for EngLead pack

**Board mapping = parent agent by stream `sessionId` + child nodes `sub-${id}` from `subagent_*` + optional `wf-${run_id}` from `workflow_updated`; hydrate children from `…/subagents/*/meta.json`; scripts under `~/.grok/workflows` are definitions only.**
