# Helm

**Take the helm of your agents.**

Spatial multi-agent control plane for [Grok Build](https://x.ai/cli). Infinite canvas. Visible fleet. Voice-ready conductor UX. Grok stays the engine — Helm is the stage.

Inspired by [CNVS](https://cnvs.dev/), purpose-built for Grok Build.

> Status: **Phase 0 scaffold live** — connect, spawn agent nodes, prompt on canvas.

## What it is

| | |
|---|---|
| **Product** | Helm |
| **Binary** | `grok-helm` (avoids clash with Kubernetes `helm`) |
| **Config** | `~/.config/grok-helm/` |
| **Engine** | `grok agent` via [ACP](https://agentclientprotocol.com) |
| **Stack** | Tauri 2 · React · TypeScript · Tailwind · React Flow |

## Sister project

[Grok Desk](../grok-desk/) is mission-control chat UI (tabs, plan, diff, activity).  
**Helm** is the infinite-canvas conductor. Same engine, different stage.

## Docs

- [PRODUCT.md](./PRODUCT.md) — vision, non-goals, CNVS parity
- [ROADMAP.md](./ROADMAP.md) — phases and exit criteria
- [ARCHITECTURE.md](./ARCHITECTURE.md) — process model and domain types

## Requirements

- Grok Build on `PATH` (`grok`)
- Node 20+
- Rust stable
- Linux: WebKitGTK 4.1 (same class of deps as Grok Desk)

## Quick start

```bash
cd helm
npm install
npm run tauri dev
```

1. **Connect to Grok**  
2. Pick a project folder (or use default cwd)  
3. **+ Spawn agent** — full **Grok Build TUI** opens in a large canvas node  
4. Click inside the TUI to type (same power as terminal `grok`); optional bottom inject bar  
5. Watch status rings; open transcript dock (double-click or link)  
6. **Ctrl+K** command palette · **Ctrl+S** save board (also autosaves)  
7. **Voice** — toggle `voice: on`, hold **Space** or the mic:  
   “spawn agent”, “focus Scout”, “tell Agent 1 to run tests”, or freeform orders

Boards live in `~/.config/grok-helm/boards/`. Voice docs: [`docs/phase2/voice.md`](./docs/phase2/voice.md).

Smoke checklist: [`docs/SMOKE.md`](./docs/SMOKE.md)

## Principles

1. **CLI is the engine** — never reimplement the agent loop  
2. **Board is presentation + control** — session truth stays in `~/.grok`  
3. **Attention is a product feature** — not a log line  
4. **Visible > background** — workers live on the canvas  
5. **Reliability before soul** — stop, stall, reconnect first  

## License

TBD.
