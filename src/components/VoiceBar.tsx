import type { VoiceHud } from "../voice/useVoice";

type Props = {
  enabled: boolean;
  hud: VoiceHud;
  /** Focused agent label for target chip */
  targetLabel?: string | null;
  agentCount?: number;
  onToggleEnabled: () => void;
  onMicDown: () => void;
  onMicUp: () => void;
};

export function VoiceBar({
  enabled,
  hud,
  targetLabel,
  agentCount = 0,
  onToggleEnabled,
  onMicDown,
  onMicUp,
}: Props) {
  const bigMic = enabled && agentCount >= 1;

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

      {enabled && targetLabel ? (
        <span
          className={`voice-target-chip ${hud.listening ? "hot" : ""}`}
          title="Voice orders target this agent (or named agent in speech)"
        >
          → {targetLabel}
        </span>
      ) : null}

      {enabled ? (
        <button
          type="button"
          className={`mic-btn ${bigMic ? "mic-btn--lg" : ""} ${
            hud.listening ? "listening" : ""
          } ${!hud.available ? "disabled" : ""}`}
          title={
            hud.available
              ? hud.engine === "voxtype"
                ? "Hold to record → Voxtype"
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
          <MicIcon listening={hud.listening} large={bigMic} />
          {bigMic ? (
            <span className="mic-btn-label">
              {hud.listening ? "Release" : "Hold"}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

function MicIcon({
  listening,
  large,
}: {
  listening: boolean;
  large?: boolean;
}) {
  const s = large ? 20 : 16;
  return (
    <svg
      width={s}
      height={s}
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
  targetLabel,
}: {
  hud: VoiceHud;
  voiceEnabled: boolean;
  targetLabel?: string | null;
}) {
  if (!voiceEnabled) return null;

  if (!hud.available || hud.status === "unsupported") {
    return (
      <div className="voice-hud voice-hud-err">
        <span className="voice-hud-dot" />
        <span className="voice-hud-label">Voice</span>
        <span className="voice-hud-text">
          {hud.engineDetail ||
            "No STT backend. Install: pip install -U openai-whisper"}
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
            ? "Listening"
            : hud.status === "processing"
              ? "Running"
              : "Voice"}
        </span>
        {targetLabel ? (
          <span className="voice-hud-target">→ {targetLabel}</span>
        ) : (
          <span className="voice-hud-target muted">no focus</span>
        )}
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

  // Success / idle feedback strip
  return (
    <div
      className={`voice-hud ${
        hud.lastAction && !hud.lastAction.startsWith("No speech")
          ? "voice-hud-ok"
          : "voice-hud-idle"
      }`}
    >
      <span className="voice-hud-label">Voice</span>
      {targetLabel ? (
        <span className="voice-hud-target">→ {targetLabel}</span>
      ) : null}
      <span className="voice-hud-text">
        {hud.lastAction ||
          (hud.engine === "voxtype"
            ? "Hold Space/mic · “tell Scout to …”"
            : "Hold Space/mic to command agents")}
      </span>
      <span className="voice-hud-hint mono">{hud.engine}</span>
    </div>
  );
}
