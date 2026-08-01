# Phase 2 — track interface notes

Shared contracts after **P2-0** (foundation refactor). All tracks must use these APIs.

## Conductor (`src/lib/conductor.ts`)

```ts
listAgents(nodes)
findByLabel(nodes, name)
findBySession(nodes, sessionId)
spawnAgentSession({ cwd, label?, rules?, position, existingAgentCount })
promptAgent(sessionId, text)
stopAgent(sessionId)
spawnTerminalNode(...)
appendUserTurn(data, text)
```

**Do not** call `invoke("session_prompt")` from voice/workflow/MCP feature code.

## Prefs (`src/lib/prefs.ts`)

- `permissionMode: "auto" | "ask"` — TopBar toggle; ACP bridge reads `permissionModeRef`
- `voiceEnabled`, `ttsCallouts`, `mcpEnabled` — reserved for tracks A/C

## Owned paths

| Track | Paths |
|-------|--------|
| A Voice | `src/voice/**`, optional `src-tauri/src/voice.rs` |
| B Workflows | `src/workflows/**`, `src/canvas/nodes/WorkflowNode.tsx` |
| C Control | notes/browser nodes, PermissionCard, control_api / MCP |
| Shared | `conductor.ts`, `store/*`, `hooks/useAcpBridge.ts` — integrator review |

## App.tsx

Composition only. Prefer hooks/components over growing App again.
