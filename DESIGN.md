# Helm — Design System

Spatial conductor UI for Grok Build. **Dark stage, signal amber, fleet visibility.**

Not mission-control chrome (that’s Grok Desk). Helm is a **board** — agents are nodes you conduct.

## Principles

1. **Everything important is a node** — if it’s not on the board, it doesn’t exist.
2. **Card face is a HUD** — status + last line; full transcript lives in the dock.
3. **Attention beats density** — `needs_input` pulses; never looks idle.
4. **One focus** — keyboard/voice inject go to the selected node.
5. **Reliability chrome first** — connect, stop, errors, save state before decoration.

## Color

Themes: **`dark`** (default) and **`light`**, toggled from the titlebar or **Ctrl+K → Theme**. Stored in `prefs.theme` (`localStorage`); applied via `data-theme` on `<html>` (`src/lib/theme.ts`).

| Token | Role | Dark | Light |
|-------|------|------|-------|
| `--bg` | Stage void | `#07090f` | `#eef1f6` |
| `--bg-elevated` | Chrome / cards | `#0d111a` | `#ffffff` |
| `--bg-panel` | Overlays | `#121826` | `#f7f8fb` |
| `--accent` | Primary signal | `#f0b429` | `#c99214` |
| `--success` | Done | `#3ecf8e` | `#159a62` |
| `--warning` / needs you | Attention | amber family | same role, tuned for paper |
| `--danger` | Failed | `#f2556e` | `#d63d55` |
| `--thought` | Subagents / edges | `#8b9cf7` | `#5b6fd6` |
| `--tool` | Working / tools | `#3db8c5` | `#1f9eab` |

Never pure black/white. Shadows and stage grid use `--shadow-*` / `--stage-*` tokens so both themes stay consistent.

## Typography

- UI: Inter
- Mono: IBM Plex Mono (paths, ids, session chips)
- Scale: 10 / 11 / 12 / 13 / display 18–20

## Nodes

| Kind | Width | Ring |
|------|-------|------|
| Agent | 280px | tool glow when working; amber pulse when needs you |
| Subagent | 200px | violet/thought tint |

## Motion

- `needs_input` pulse ~1.4s ease-in-out
- Spawn edges animated until subagent finishes
- Prefer subtle over theatrical

## Keyboard

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+S` | Save board |
| `Enter` | Send orders |
| `Shift+Enter` | Newline in composer |
| `Delete` / `Backspace` | Remove selected node (React Flow) |
| Double-click agent | Focus + open transcript dock |

## Density

Comfortable default. Canvas uses 24px dot grid. Cards use 4/8 spacing grid, radii 6–14px.
