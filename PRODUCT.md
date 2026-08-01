# Helm — Product

## Vision

Command an army of Grok agents on one infinite board. You steer; they build; you ship.

Helm is the **CNVS-class conductor** for Grok Build: spatial, multi-agent, attention-first, voice-ready — without reimplementing the agent.

## Tagline

**Take the helm of your agents.**

## Positioning

| | Grok Desk | Helm | CNVS |
|---|---|---|---|
| Metaphor | Mission-control desk | Ship’s helm / stage | Infinite canvas |
| Harness | Grok Build | Grok Build | Multi (Claude, Cursor, Codex, …) |
| Primary UI | Tabs + chat + rails | Infinite node canvas | Infinite node canvas |
| Engine | ACP → `grok agent` | ACP → `grok agent` | Native harness hosts |

**Wedge:** Grok-native depth (workflows as score, personas, worktrees, ACP) + CNVS-class stage UX.

## Core experience

1. **Board = project** — one primary cwd; pan/zoom place to work  
2. **Agents as nodes** — every session visible; subagents as children  
3. **Conductor gestures** — spawn, prompt, stop, focus, loop  
4. **Attention design** — glow when working; pulse when they need you  
5. **Voice later, designed now** — address named agents; inject into focus  

## Non-goals (v1)

- Reimplement Grok Build tools/models  
- Multi-vendor harnesses inside Helm (later stretch)  
- Cloud multi-tenant SaaS  
- Full IDE / LSP  
- Melting Desk + Helm into one confused chrome  

## CNVS parity (summary)

| Capability | Target phase |
|---|---|
| Infinite multi-agent canvas | P0–P1 |
| Terminal / browser / note nodes | P1–P2 |
| Local voice STT | P1–P2 |
| Bidirectional MCP control plane | P2 |
| Remote VPS agents | P3 |
| Themes / soul UI | P1+ |
| Multi-harness foreign agents | Later |

## Success

After Phase 1 dogfood you should say:

- I see the whole army without tab archaeology  
- When something needs me, I know *which* agent in under a second  
- Spawning parallel explorer + implementer is one gesture  
- I prefer Helm over pure TUI for multi-agent days  

## Naming

| Use | Value |
|---|---|
| Product | Helm |
| Binary / package | `grok-helm` |
| Config | `~/.config/grok-helm/` |
