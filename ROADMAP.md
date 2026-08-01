# Helm — Roadmap

**Current phase:** Phase 2 — Conductor power (P2-0 foundation landed)  
**North star:** CNVS-class multi-agent canvas for Grok Build

---

## Phase 0 — Foundation & ACP spike (Week 1)

**Goal:** Connect to Grok, one agent node on a board, prompt and stream.

- [x] Scaffold Tauri 2 + React + TS + Tailwind
- [x] Minimal ACP bridge (start/stop, session new/prompt/cancel, updates)
- [x] Always-approve path for dogfood (auto-respond permissions)
- [x] React Flow board (pan/zoom)
- [x] AgentNode card (status, last line)
- [x] Floating composer → focused node
- [ ] Smoke: connect → spawn → prompt → stream (manual dogfood)

**Exit:** “Hello, fleet” demo works.

---

## Phase 1 — Multi-agent canvas MVP (Weeks 2–4)

**Goal:** Army on one board — visible, steerable, restart-safe.

- [x] N parallel agent nodes + drag layout
- [x] Subagent child nodes + edges
- [x] Attention rings (working / needs_input / failed)
- [x] OS notify when unfocused node needs you
- [x] Expand dock: full transcript
- [x] Board persistence + session reattach
- [x] Command palette (`Ctrl+K`)
- [x] Terminal node (v1) — human PTY on canvas
- [x] DESIGN.md + dark stage identity
- [ ] Voice v0 stretch: push-to-talk → focused composer
- [ ] Manual dogfood against `docs/SMOKE.md`

**Exit:** 3–8 agents live; needs-input unmistakable; board survives restart.  
**~40% CNVS feel.**

---

## Phase 2 — Conductor power (Weeks 5–8)

**Goal:** Director mode — voice, workflows, control plane.

### P2-0 Foundation (serial gate)

- [x] Extract `src/lib/conductor.ts` (spawn/prompt/stop/list)
- [x] Extract `useAcpBridge` + `useBoardPersistence`
- [x] Extract TopBar, Composer, BoardCanvas
- [x] Prefs: `permissionMode` auto|ask (TopBar + palette toggle)
- [x] Thin App composition shell (~700 lines from ~1455)
- [x] Track interface notes: `docs/phase2/README.md`

### Parallel tracks (after P2-0)

- [x] **A** Voice v0–v1 + command grammar + named agents (Web Speech PTT)
- [ ] **B** Workflow run → graph on board
- [ ] **C1** Plan + permission on node (ask mode UI)
- [ ] **C2** Note nodes + board brief → session rules
- [ ] **C3** Browser / preview node
- [ ] **C4** Helm MCP (`spawn_agent`, `prompt_agent`, `list_nodes`, …)
- [ ] Group frames / swimlanes
- [ ] **D** Integration dogfood

**Exit:** Voice happy path; workflow visible; MCP peer control.  
**~70% CNVS (Grok-native).**

---

## Phase 3 — Remote fleet, soul, ship (Weeks 9–14)

- [ ] Remote `grok agent serve` / SSH mixed boards
- [ ] Optional TTS callouts
- [ ] Themes + polish
- [ ] Perf: 12–20 agents, buffer caps
- [ ] `install:local` + desktop entry
- [ ] Hardening (stall, reconnect, corrupt board)

**Exit:** Daily-driver multi-agent Grok work.  
**~85–90% CNVS for Grok scope.**

---

## Phase 4 — Stretch

- Multi-harness foreign agent nodes
- Mobile companion
- Collaborative boards
- Freeform doodle layer

---

## Explicitly deferred

- Official cloud multi-tenant
- Replacing Grok Desk
- Wallet / chain-specific IDE chrome
