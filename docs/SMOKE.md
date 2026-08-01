# Helm smoke checklist

## Prerequisites

- [ ] `grok` on PATH (`grok --version`)
- [ ] Authenticated Grok Build account
- [ ] `npm install` in `helm/`
- [ ] `npm run tauri dev` → window **Helm**

## Phase 0 — fleet basics

1. [ ] Status shows grok version
2. [ ] **Connect to Grok** succeeds
3. [ ] Project path set
4. [ ] **+ Spawn agent** places a card
5. [ ] Select → composer enabled
6. [ ] Prompt e.g. `List top-level files`
7. [ ] Card → Working; last line updates
8. [ ] **Stop** works
9. [ ] Second agent spawns; both stay on board
10. [ ] **Disconnect** marks offline

## Phase 1 — canvas conductor

11. [ ] **Ctrl+K** opens command palette
12. [ ] Spawn agent from palette
13. [ ] Double-click agent opens transcript dock
14. [ ] Board name editable in titlebar
15. [ ] Drag agents; **Ctrl+S** / autosave writes `~/.config/grok-helm/boards/`
16. [ ] Restart app → last board restores positions
17. [ ] Connect after restore reattaches sessions (or marks missing)
18. [ ] Prompt that spawns a subagent → child node + edge appears
19. [ ] Subagent finish updates child state; edge stops animating
20. [ ] Unfocused agent needing permission → OS notification (if notify-send)
21. [ ] Rename agent via palette
22. [ ] New board from palette

23. [ ] **+ Terminal** spawns shell node in project cwd
24. [ ] Type in terminal; commands run (human PTY, not agent)
25. [ ] Remove terminal node kills shell
26. [ ] **Session tabs** appear for each agent/terminal; click focuses + pans to node
27. [ ] **Maximize** TUI (tab ⛶, node header, or double-click) → full window; **Esc** restores
28. [ ] Drag edge **resize** on selected TUI/terminal cards

## Phase 2 — Voice

29. [ ] Toggle **voice: on** in titlebar
30. [ ] Hold mic (or Space outside inputs) → Listening HUD
31. [ ] Say “spawn agent” → new agent node (Grok connected)
32. [ ] Select agent, hold mic, freeform order → prompt sent
33. [ ] “tell Agent 1 to …” reaches named agent
34. [ ] “stop” / “stop all” work
35. [ ] Esc cancels listening (when not in maximized TUI)
33. [ ] If STT unsupported, clear error (not a crash)

## Known limits

- Subagents not persisted across restarts (live only)
- Permissions + plan approvals auto-approved (dogfood)
- No browser / preview nodes yet
- Voice uses Web Speech API (webview-dependent); no local whisper yet
- Transcript does not full-reload history from disk on reattach
