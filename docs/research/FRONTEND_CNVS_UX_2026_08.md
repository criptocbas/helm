---
title: "Helm canvas UX vs CNVS feel (Frontend research)"
tags: [helm, cnvs, ux, research]
status: active
created: 2026-08-01
---

# Helm — canvas UX / CNVS feel (Frontend)

**Scope:** Research only. Paths: `src/components/**`, `src/canvas/**`, `src/App.tsx`, `src/index.css`, SessionTabs / maximize / TUI cards.  
**Reference:** https://cnvs.dev · Product: `PRODUCT.md`, `DESIGN.md`, `ROADMAP.md` (~40% CNVS feel self-rated at Phase 1 exit).

---

## 1. What works today (visibility + control)

| Affordance | Where | Role |
|------------|--------|------|
| Infinite board | `BoardCanvas.tsx` + React Flow | Pan/zoom stage; dots grid; minimap |
| Agents as nodes | `AgentNode.tsx` | Default **TUI** (embedded Grok Build PTY) or legacy ACP card |
| Subagents + edges | `SubagentNode.tsx` | Child visibility when ACP spawns |
| Terminal nodes | `TerminalNode.tsx` | Human shell on canvas |
| Session tabs | `SessionTabs.tsx` | Focus + pan; maximize for TUI/shell |
| Maximize | `TuiMaximizeOverlay.tsx` | Full-window PTY; Esc restore |
| Attention rings | `index.css` `data-state` + `status-dot` | Working glow; needs_input pulse |
| Composer | `Composer.tsx` | Inject to focused agent (ACP orders / TUI inject) |
| Palette | `CommandPalette.tsx` Ctrl+K | Spawn, terminal, rename, boards, permission toggle |
| Top chrome | `TopBar.tsx` | Connect, project cwd, spawn, voice, permission |
| Voice | `VoiceBar.tsx` + `voice/*` | PTT + named-agent grammar (conductor) |
| Empty state | `BoardCanvas` | “Take the helm” + Connect / Spawn first agent |
| Conductor API | `lib/conductor.ts` | Shared spawn/prompt/stop for UI + voice |

**Strength:** Multi-agent *presence* is real — N TUI cards + tabs + maximize is a credible army board, not chat tabs alone.

---

## 2. Scaffold vs conductor stage

Still scaffold-like:

- **Titlebar as IDE chrome** — Connect / path / mono toggles dominate; stage is secondary.
- **Two agent faces** — ACP “last line HUD” vs TUI full terminal; board zoom-out on TUI is a wall of black, not scannable status.
- **Session tabs** reintroduce tab archaeology CNVS/board metaphor tried to kill (acceptable as power tool; bad as primary fleet list).
- **Maximize chrome** uses emoji ⛶/🗗 — prototype signal.
- **Generic RF Controls** — default React Flow chrome, not Helm “director” language.
- Missing **note / browser / workflow graph** nodes (Roadmap P2) that make CNVS feel like a *studio*, not a terminal farm.

Already stage-like (keep):

- Amber attention language (`DESIGN.md` + CSS pulses).
- Empty-state manifesto copy.
- One-focus composer target label.
- Voice target styling hook (`voice-target` class).

---

## 3. First 2 minutes (new user friction)

Happy path implied by empty state + `docs/SMOKE.md`:

1. Launch Tauri · grok on PATH · authenticated  
2. **Connect to Grok**  
3. **Pick project** (cwd)  
4. **Spawn first agent** (TUI in PTY)  
5. Click inside node *or* use bottom inject composer  
6. Optionally maximize / open second agent / voice  

Friction:

| Step | Issue |
|------|--------|
| Prerequisites | External: `grok` + auth — not guided in UI if missing |
| Connect vs project | Two deliberate actions before spawn |
| TUI dual input | “Click inside terminal” vs “composer inject” — easy to miss inject mode |
| Attention at rest | Idle TUI cards look identical at a glance |
| Permission mode | `auto\|ask` as mono chip — easy to ignore safety posture |
| Dogfood | SMOKE Phase 0–1 still unchecked as formal ritual |

---

## 4. Gaps vs CNVS *feel* (not multi-harness clone)

CNVS sells: voice-directed army on one canvas; structured activity theater; pay-once multi-agent product.

| CNVS-class feel | Helm today |
|-----------------|------------|
| Voice as primary conductor | Voice is titlebar toggle + hold-mic; secondary to keyboard |
| Activity *in* nodes (tools/edits stream) | ACP last-line only; TUI = raw xterm |
| Terminal / browser / notes as first-class | Terminal yes; browser/notes **no** |
| Instant “who needs me” | Pulse exists; **no dedicated attention strip / sort** |
| Visual hierarchy / soul | Dark stage + amber OK; still RF-default density |
| Multi-vendor | Correct non-goal — Grok-native is the wedge |

---

## 5. Top 3 UX improvements (no engine rewrite)

1. **“Needs you” fleet strip** — Always-visible strip (or upgraded SessionTabs) that surfaces only `needs_input` / `failed` with one-click focus+pan. Reuses existing state machine; closes CNVS attention gap without new process model.

2. **First-run single CTA path** — Empty state: Connect → (auto-prompt project if empty) → Spawn TUI as *one* guided sequence; hide permission/voice/palette until board has ≥1 agent. Cuts first-2-min friction.

3. **TUI card HUD at zoom-out** — Status ring + label + optional last inject line / “live TUI” badge always visible; body can dim when unselected. Board stays scannable; maximize remains deep work. Polish maximize chrome (text icons, Esc).

Honorable: progressive Voice (auto-suggest when enabled, larger mic target); browser/note node *shells* later (P2) once feel is locked.

---

## File map (read)

```
src/App.tsx
src/index.css
src/components/{BoardCanvas,SessionTabs,TuiMaximizeOverlay,Composer,CommandPalette,TopBar,VoiceBar,TerminalHost,TranscriptDock}.tsx
src/canvas/nodes/{AgentNode,SubagentNode,TerminalNode}.tsx
src/lib/conductor.ts
docs/SMOKE.md · PRODUCT.md · DESIGN.md · ROADMAP.md
```
