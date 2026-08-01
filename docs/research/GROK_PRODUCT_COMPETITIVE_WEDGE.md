---
title: "Helm product / competitive / wedge (Grok research)"
tags: [helm, cnvs, product, competitive, grok]
status: active
created: 2026-07-31
---

# Grok lane — product, competitive, wedge

**Sources:** https://cnvs.dev/ · Helm `PRODUCT.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `DESIGN.md`, `README.md` · sister Grok Desk positioning · multi-agent canvas pattern (category)

**Out of scope:** UI/Rust implementation.

---

## 1. What CNVS is selling

| Dimension | Reality |
|-----------|---------|
| **JTBD** | “Command an army of coding agents on one spatial board with voice — you direct, they build, you ship” without tab archaeology. |
| **Buyer** | Indie/pro builder who already pays for Claude/Cursor/Codex (or multiple) and hits coordination pain: parallel agents, attention, direction. Not enterprise SaaS. |
| **Monetization** | **$99 one-time** founder license (tiers rise); works with *your* existing AI subs — CNVS sells the **stage**, not the model. “Pay once, own forever” + 1.x updates. |
| **Differentiation claim** | Multi-harness (Claude / Cursor / Codex / …) + voice-first + polished infinite canvas + orchestrator tease. |
| **What they are not selling** | A better terminal. A better single-chat IDE. Cloud multi-tenant agent hosting as the core offer. |

**Category pattern:** spatial multi-agent **conductor** (canvas + attention + spawn/prompt/stop) vs linear chat mission-control.

---

## 2. Where Helm wins by being Grok-native

| Asset | Why it beats multi-harness clone |
|-------|----------------------------------|
| **ACP → `grok agent`** | Single deep engine: sessions, tools, memory, subagents, workflows — no fragile N-harness adapter soup. |
| **Worktrees / isolation** | Grok Build already has isolation primitives; canvas can *show* parallel safe work instead of pretending many CLIs are one product. |
| **Workflows as score** | ROADMAP track B: paint run graph on board — CNVS multi-vendor can’t own Grok workflow semantics. This is the “orchestrator” CNVS markets; Helm can make it real for one engine. |
| **Personas / ACP depth** | Named agents, rules, reattach to `~/.grok` truth — depth over breadth. |
| **Linux desktop + Tauri** | CNVS is a commercial Mac-leaning product narrative; Helm is *your* daily driver on Linux with Desk as sister (chat vs stage). |
| **Sister split** | Desk = mission control chat; Helm = stage. Avoids melting into one confused chrome (PRODUCT non-goal). |

**Do not win by:** matching CNVS feature-for-feature multi-harness, cloning their marketing site as a website, or rebuilding models/tools.

---

## 3. Kill criteria (what makes Helm fail)

### Bad Desk clone
- Tabs + chat rails reappearing as primary chrome instead of **nodes on a board**
- Transcript-first UI with canvas as wallpaper
- “Mission control” density (panels everywhere) vs stage + attention

### Worse terminal
- xterm wallpaper with no **attention product** (needs_input pulse, focus inject, fleet visibility)
- Spawning N PTYs without session truth / reattach / conductor gestures
- User prefers bare `grok` TUI because Helm adds lag, focus traps, or broken maximize without upside

### Other kills
- Multi-harness before Grok-native excellence (dilutes wedge, infinite support surface)
- Token/SaaS cosplay or cloud multi-tenant before daily-driver local reliability
- Melting Desk + Helm into one app before either is excellent
- Voice as gimmick without named-agent routing + focus semantics

---

## 4. Capability roadmap — ruthless P1/P2/P3

Aligned with ROADMAP but re-ranked for **CNVS-class feel + Grok wedge** (not parity checklist).

### P1 — Daily conductor (must feel better than multi-tab TUI)
1. **Attention reliability** — needs_input never silent; OS notify; ring always correct after remount/maximize  
2. **Session reattach + board persistence** dogfood-hard (exit Phase 1 honestly)  
3. **Spawn / focus / prompt / stop** as one-gesture conductor (palette + keyboard)  
4. **TUI-in-node + maximize** without zombie shells / lost focus (host quality = product)  
5. **Permission mode ask UX on node** (C1) — trust for real work  

### P2 — Differentiation (why not just CNVS + other models)
1. **Workflow run → graph on board** (track B) — Grok-native score  
2. **Voice named-agent routing** (track A polish) — CNVS headline, Helm must land for category  
3. **Note + board brief → session rules** (C2) — spatial context as product  
4. **Browser/preview node** (C3) — ship loop visible  
5. **Helm MCP control plane** (C4) — agents/orchestrators drive the board  

### P3 — Scale / soul / stretch
1. Perf + stall/reconnect for 12–20 agents  
2. Remote fleet / SSH mixed boards  
3. Themes / TTS callouts  
4. Multi-harness foreign nodes — **only after** Grok depth is undeniable  

---

## 5. Top 3 product bets for next build sprint

1. **Conductor reliability + attention product** — finish Phase 1 exit for real (smoke, reattach, rings, stop/stall). Without this, CNVS comparison is cosplay.  
2. **Workflow-as-score on canvas** — one visible multi-agent workflow run painted as graph; proves Grok-native wedge vs multi-harness canvas toys.  
3. **Voice → named focus → inject** happy path hardened — category table stakes; CNVS leads marketing here; Helm already has Web Speech PTT foundation.

**Explicit non-bets this sprint:** multi-harness, cloud SaaS, Desk merge, marketing-site clone, wallet/chain chrome.

---

## Competitive snapshot

| | CNVS | Helm | Grok Desk |
|---|------|------|-----------|
| Stage | Infinite canvas | Infinite canvas | Chat / tabs / rails |
| Engine | Multi-harness | Grok ACP only | Grok ACP only |
| Business | $99 one-time | Personal/local product (TBD license) | Personal/local |
| Wedge | Breadth of agents + polish | Depth of Grok + Linux daily driver | Single-session mission control |

---

## Recommendation ranking (for EngLead pack)

1. **Own “army on one board” for Grok only** — depth over multi-vendor.  
2. **Ship reliability + attention before soul themes.**  
3. **Use workflows + worktrees as the score** CNVS can’t fake for Grok.  
4. **Kill multi-harness until P3.**  
5. **Keep Desk/Helm split sharp.**
