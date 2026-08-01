# Helm smoke checklist

## Prerequisites

- [ ] `grok` on PATH (`grok --version`)
- [ ] Authenticated Grok Build account
- [ ] `npm install` in `helm/`
- [ ] `npm run tauri dev` → window **Helm**
- [ ] `npx tsc --noEmit` green (from `helm/`)

## Sprint 1 — reliability + attention UX

S1. [ ] **First-run empty board**: shows steps 1 Connect → 2 Pick project → 3 Spawn; single primary CTA advances with state  
S2. [ ] Before any agent: TopBar **hides** voice + perms chips (hint: “Spawn an agent to unlock…”)  
S3. [ ] After first spawn: voice + **perms: ask (safe)** appear; toggle to auto shows “always-approve” warning copy  
S4. [ ] New install default **permissionMode = ask** (no `--always-approve` in TUI argv unless auto)  
S5. [ ] **Needs you** strip always visible; when idle shows “All clear”  
S6. [ ] Force an agent into `needs_input` / `failed` (or inspect state) → chip appears; **click focuses + pans** to node  
S7. [ ] TUI card **HUD**: status dot + label + live badge + lastLine always visible above terminal  
S8. [ ] Maximize via **Max** (text, not emoji) on tab or node; **Esc** / **Restore** returns  
S9. [ ] Session tabs still list all agents; click focuses  

## Sprint 2 — voice, ask-mode, subagent graph

S2-1. [ ] Voice **on** with ≥1 agent: larger mic + **→ {focused agent}** target chip while idle/listening  
S2-2. [ ] Hold mic / Space → HUD shows target + interim; empty speech → error (not silent)  
S2-3. [ ] “tell Scout to list files” / “Scout, run tests” routes to named agent; HUD lastAction like `Tell Scout → …`  
S2-4. [ ] Focus: “focus Scout” selects + pans; unknown name → clear error  
S2-5. [ ] **perms: ask** + ACP tool permission: **Permission** card (Allow / Deny) → `permission_respond`; agent lastLine updates  
S2-6. [ ] Plan ready (`acp://plan-approval`): **Plan** card with excerpt + Approve / Cancel  
S2-7. [ ] **perms: auto** still auto-approves (no card)  
S2-8. [ ] Subagent spawn places children in a grid under parent; edge label = type; finish edge label = status  
S2-9. [ ] Subagent card shows type pill + Running/Done/Failed  

### Flow notes (screenshot-level)

- **Voice:** TopBar target chip → hold large mic → strip shows “Listening · → Agent · interim” → release → “Tell X → …” feedback.  
- **Ask permission:** Agent needs_input + Needs-you chip → approval dock appears under tabs with tool title → Allow/Deny.  
- **Plan:** Same dock with plan excerpt → Approve plan.  
- **Subagents:** Parent lastLine “Spawned: …”; violet child nodes in rows; animated edge until done.

## Phase 0 — fleet basics

1. [ ] Status shows grok version
2. [ ] **Connect to Grok** succeeds
3. [ ] Project path set
4. [ ] **+ Spawn agent** places a TUI card
5. [ ] Select → composer inject enabled
6. [ ] Prompt e.g. `List top-level files` (inject or type in TUI)
7. [ ] Card state / last line updates when agent works
8. [ ] **Stop** works (ACP path) or end TUI session
9. [ ] Second agent spawns; both stay on board
10. [ ] **Disconnect** marks offline (ACP)

## Phase 1 — canvas conductor

11. [ ] **Ctrl+K** opens command palette
12. [ ] Spawn agent from palette
13. [ ] Double-click ACP agent opens transcript dock; double-click TUI maximizes
14. [ ] Board name editable in titlebar
15. [ ] Drag agents; **Ctrl+S** / autosave writes `~/.config/grok-helm/boards/`
16. [ ] Restart app → last board restores positions
17. [ ] Connect after restore reattaches sessions (or marks missing / disconnected)
18. [ ] Prompt that spawns a subagent → child node + edge appears
19. [ ] Subagent finish updates child state; edge stops animating
20. [ ] Unfocused agent needing permission → OS notification (if notify-send) + **Needs you** strip
21. [ ] Rename agent via palette
22. [ ] New board from palette

23. [ ] **+ Terminal** spawns shell node in project cwd (after first agent / not first-run)
24. [ ] Type in terminal; commands run (human PTY, not agent)
25. [ ] Remove terminal node kills shell
26. [ ] **Session tabs** appear for each agent/terminal; click focuses + pans to node
27. [ ] **Maximize** TUI (tab **Max**, node **Max**, or double-click) → full window; **Esc** restores
28. [ ] Drag edge **resize** on selected TUI/terminal cards

## Phase 2 — Voice

29. [ ] After ≥1 agent: toggle **voice: on** in titlebar
30. [ ] Hold mic (or Space outside inputs) → Listening HUD
31. [ ] Say “spawn agent” → new agent node (Grok connected)
32. [ ] Select agent, hold mic, freeform order → prompt sent
33. [ ] “tell Agent 1 to …” reaches named agent
34. [ ] “stop” / “stop all” work
35. [ ] Esc cancels listening (when not in maximized TUI)
36. [ ] If STT unsupported, clear error (not a crash)

## Sprint 1 host reliability (Onchain)

41. [ ] Soft PTY cap: spawn agents until limit (default **8** live) → clear error; stop one → spawn again. Override: `HELM_MAX_PTYS`.
42. [ ] **Disconnect** or quit app → no leftover `grok`/shell processes (`pgrep -a grok` clean after exit).
43. [ ] Board restore after restart: TUI cards show **disconnected** + “Session ended — respawn to continue”; **Respawn** starts a new process (does not pretend reattach).
44. [ ] Permission default **ask** — new install does **not** pass `--always-approve` unless user opts into auto/dogfood.
45. [ ] (Optional) After ~10 min with no PTY output, card may flip to `needs_attention` + OS notify (`pty://stall`).

## Known limits

- Subagents not persisted across restarts (live only)
- Permission **default is ask**; auto / always-approve is opt-in (dogfood)
- No browser / preview nodes yet
- Voice uses Web Speech API (webview-dependent); no local whisper yet
- Transcript does not full-reload history from disk on ACP reattach
- TUI scrollback still lost on maximize remount (PTY stays alive)
- Stall event is idle-time based (can fire on quiet waiting TUIs)
