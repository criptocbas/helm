import type { VoiceHud } from "../voice/useVoice";

type Props = {
  enabled: boolean;
  hud: VoiceHud;
  onToggleEnabled: () => void;
  onMicDown: () => void;
  onMicUp: () => void;
};

export function VoiceBar({
  enabled,
  hud,
  onToggleEnabled,
  onMicDown,
  onMicUp,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleEnabled}
        className={`px-2 py-1 rounded-[var(--radius-sm)] border text-[11px] mono hover:bg-[var(--bg-hover)] ${
          enabled
            ? "border-[var(--accent)] text-[var(--accent)]"
            : "border-[var(--border)] text-[var(--text-faint)]"
        }`}
        title="Enable voice commands (Space push-to-talk)"
      >
        voice: {enabled ? "on" : "off"}
      </button>

      {enabled ? (
        <button
          type="button"
          className={`mic-btn ${hud.listening ? "listening" : ""} ${
            !hud.available ? "disabled" : ""
          }`}
          title={
            hud.available
              ? hud.engine === "voxtype"
                ? "Hold to record → Voxtype (same as Super+Ctrl+X)"
                : hud.engine === "local-whisper"
                  ? "Hold to record → local whisper"
                  : "Hold to talk (Web Speech)"
              : hud.engineDetail || "Speech backend unavailable"
          }
          disabled={!hud.available}
          onMouseDown={(e) => {
            e.preventDefault();
            onMicDown();
          }}
          onMouseUp={() => onMicUp()}
          onMouseLeave={() => {
            if (hud.listening) onMicUp();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            onMicDown();
          }}
          onTouchEnd={() => onMicUp()}
        >
          <MicIcon listening={hud.listening} />
        </button>
      ) : null}
    </div>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
      {listening ? (
        <circle cx="12" cy="12" r="10" strokeOpacity="0.35" />
      ) : null}
    </svg>
  );
}

export function VoiceHudStrip({
  hud,
  voiceEnabled,
}: {
  hud: VoiceHud;
  voiceEnabled: boolean;
}) {
  if (!voiceEnabled) return null;

  if (!hud.available || hud.status === "unsupported") {
    return (
      <div className="voice-hud voice-hud-err">
        <span className="voice-hud-dot" />
        <span className="voice-hud-label">Voice</span>
        <span className="voice-hud-text">
          {hud.engineDetail ||
            "No STT backend. Install: pip install -U openai-whisper  (ffmpeg already on most Arch installs)"}
        </span>
      </div>
    );
  }

  if (hud.listening || hud.status === "processing" || hud.interim) {
    return (
      <div
        className={`voice-hud ${hud.listening ? "voice-hud-hot" : ""} ${
          hud.status === "error" ? "voice-hud-err" : ""
        }`}
      >
        <span className="voice-hud-dot" data-listening={hud.listening} />
        <span className="voice-hud-label">
          {hud.listening
            ? hud.engine === "voxtype" || hud.engine === "local-whisper"
              ? "Recording"
              : "Listening"
            : hud.status === "processing"
              ? "Transcribing"
              : "Voice"}
        </span>
        <span className="voice-hud-text">
          {hud.interim ||
            hud.lastAction ||
            (hud.listening ? "Speak, then release…" : "")}
        </span>
        {hud.listening ? (
          <span className="voice-hud-hint mono">{hud.engine}</span>
        ) : null}
      </div>
    );
  }

  if (hud.status === "error" && hud.lastAction) {
    return (
      <div className="voice-hud voice-hud-err">
        <span className="voice-hud-dot" />
        <span className="voice-hud-label">Error</span>
        <span className="voice-hud-text">{hud.lastAction}</span>
      </div>
    );
  }

  return (
    <div className="voice-hud voice-hud-idle">
      <span className="voice-hud-label">Voice</span>
      <span className="voice-hud-text">
        {hud.lastAction ||
          (hud.engine === "voxtype"
            ? "Voxtype — hold Space/mic (uses your Parakeet model)"
            : hud.engine === "local-whisper"
              ? "Local whisper — hold Space/mic to command agents"
              : "Hold Space or mic to command agents")}
      </span>
      <span className="voice-hud-hint mono">{hud.engine}</span>
    </div>
  );
}
