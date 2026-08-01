# Track A — Voice

## UX

1. Toggle **voice: on** in the titlebar (or Ctrl+K → Enable voice).
2. **Hold Space** (outside inputs) or **hold mic** button.
3. Speak a command; release to run (Voxtype may take ~1–3s to transcribe).

## Commands (grammar)

| You say | Effect |
|---------|--------|
| “spawn agent” / “spawn agent named Scout” | New agent (optional label) |
| “stop” | Stop focused agent |
| “stop all” | Stop every agent |
| “focus Scout” / “select agent 1” | Focus by name (prefix match) |
| “tell Scout to run the tests” | Prompt named agent |
| freeform speech | Prompt focused agent (or first with a session) |

## Engine (priority)

1. **Web Speech API** when present (rare on Linux WebKitGTK)
2. **Voxtype** (preferred here): MediaRecorder → ffmpeg → `voxtype transcribe`  
   Uses your **Parakeet** model — same stack as **Super+Ctrl+X**
3. **openai-whisper** CLI if Voxtype is missing

### Your laptop

- App: **Voxtype** (`/usr/bin/voxtype`)
- Config: `~/.config/voxtype/config.toml` · `engine = "parakeet"`
- Hotkey: Super+Ctrl+X (Hyprland; Voxtype internal hotkey disabled)

After restart, **voice: on** should show HUD **voxtype**.

### Two ways to dictate

| Method | How |
|--------|-----|
| **Helm mic / Space** | `voxtype record start/stop` (system mic, **no browser permission**) → grammar → agent |
| **Super+Ctrl+X** | Click composer, dictate as usual (Voxtype pastes), press Enter |

### About “Mic access failed / not allowed”

That message is from the **webview** trying `getUserMedia`. On Linux Tauri/WebKit there is often **no Allow dialog** — the platform simply blocks it.

Helm now prefers the **Voxtype daemon** path instead, which uses the same system mic as Super+Ctrl+X. You do **not** need to grant a browser mic permission for that.

Ensure the daemon is running:

```bash
systemctl --user status voxtype
# if inactive:
systemctl --user start voxtype
systemctl --user enable voxtype
```

## Modules

- `src/voice/grammar.ts` — intent parser
- `src/voice/stt.ts` / `localStt.ts` — PTT + backends
- `src-tauri/src/stt.rs` — ffmpeg + voxtype/whisper
- `src/voice/useVoice.ts` — React hook → conductor
- `src/components/VoiceBar.tsx` — mic + HUD

All actions go through `src/lib/conductor.ts`.
