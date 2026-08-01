import { useCallback, useEffect, useRef, useState } from "react";
import { describeIntent, parseVoiceIntent, type VoiceIntent } from "./grammar";
import {
  createLocalWhisperPtt,
  createWebSpeechPtt,
  resolveSttEngine,
  type SttEngine,
  type SttSession,
  type SttStatus,
} from "./stt";

export type VoiceHud = {
  status: SttStatus;
  interim: string;
  lastFinal: string;
  lastAction: string;
  available: boolean;
  listening: boolean;
  engine: SttEngine;
  engineDetail: string;
};

export type VoiceHandlers = {
  onSpawn: (label?: string) => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onStopAll: () => void | Promise<void>;
  onFocus: (name: string) => boolean;
  onTell: (name: string, message: string) => boolean | Promise<boolean>;
  onPrompt: (text: string) => void | Promise<void>;
  onInterim?: (text: string) => void;
  onError?: (msg: string) => void;
};

export function useVoice(handlers: VoiceHandlers, enabled: boolean) {
  const [hud, setHud] = useState<VoiceHud>(() => ({
    status: "idle",
    interim: "",
    lastFinal: "",
    lastAction: "",
    available: false,
    listening: false,
    engine: "none",
    engineDetail: "Probing STT…",
  }));

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const sessionRef = useRef<SttSession | null>(null);
  const listeningRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const engineRef = useRef<SttEngine>("none");
  const engineDetailRef = useRef("Probing STT…");

  // Probe engines when voice is enabled
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const r = await resolveSttEngine();
      if (cancelled) return;
      engineRef.current = r.engine;
      engineDetailRef.current = r.detail;
      setHud((s) => ({
        ...s,
        engine: r.engine,
        engineDetail: r.detail,
        available: r.engine !== "none",
        status: r.engine === "none" ? "unsupported" : "idle",
        lastAction:
          r.engine === "none"
            ? r.detail
            : r.engine === "voxtype"
              ? "Voxtype (Parakeet) ready — hold mic / Space"
              : r.engine === "local-whisper"
                ? "Local whisper ready — hold mic / Space"
                : "Web Speech ready — hold mic / Space",
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const dispatch = useCallback(async (intent: VoiceIntent) => {
    const h = handlersRef.current;
    const action = describeIntent(intent);
    setHud((s) => ({ ...s, lastAction: action, status: "processing" }));

    try {
      switch (intent.type) {
        case "empty":
          setHud((s) => ({
            ...s,
            lastAction:
              "No speech detected — hold longer or check mic",
            status: "idle",
          }));
          h.onError?.(
            "No speech detected. Hold the mic longer and speak clearly.",
          );
          return;
        case "spawn":
          await h.onSpawn(intent.label);
          break;
        case "stop":
          await h.onStop();
          break;
        case "stop_all":
          await h.onStopAll();
          break;
        case "focus": {
          const ok = h.onFocus(intent.name);
          if (!ok) {
            h.onError?.(`No agent matching “${intent.name}”`);
            setHud((s) => ({
              ...s,
              lastAction: `No agent “${intent.name}”`,
              status: "idle",
            }));
            return;
          }
          break;
        }
        case "tell": {
          const ok = await h.onTell(intent.name, intent.message);
          if (!ok) {
            h.onError?.(`No agent matching “${intent.name}”`);
            setHud((s) => ({
              ...s,
              lastAction: `No agent “${intent.name}”`,
              status: "idle",
            }));
            return;
          }
          break;
        }
        case "prompt":
          await h.onPrompt(intent.text);
          break;
      }
      setHud((s) => ({ ...s, lastAction: action, status: "idle", interim: "" }));
    } catch (e) {
      h.onError?.(String(e));
      setHud((s) => ({
        ...s,
        status: "error",
        lastAction: String(e),
      }));
    }
  }, []);

  const startListening = useCallback(() => {
    if (!enabledRef.current || listeningRef.current) return;

    const engine = engineRef.current;
    if (engine === "none") {
      setHud((s) => ({
        ...s,
        status: "unsupported",
        available: false,
        lastAction: s.engineDetail || "No STT backend",
      }));
      handlersRef.current.onError?.(
        engineDetailRef.current ||
          "No speech backend. Install: pip install -U openai-whisper (ffmpeg is already common on Arch).",
      );
      return;
    }

    listeningRef.current = true;
    setHud((s) => ({
      ...s,
      listening: true,
      status: "listening",
      interim: "",
      lastAction:
        engine === "voxtype" || engine === "local-whisper"
          ? "Recording… release to transcribe (Voxtype/Parakeet)"
          : "Listening…",
    }));

    if (engine === "web-speech") {
      const session = createWebSpeechPtt({
        onInterim: (text) => {
          setHud((s) => ({ ...s, interim: text }));
          handlersRef.current.onInterim?.(text);
        },
        onError: (msg) => {
          if (msg === "not-allowed") {
            handlersRef.current.onError?.(
              "Microphone permission denied. Allow mic for Helm.",
            );
          } else {
            handlersRef.current.onError?.(msg);
          }
          setHud((s) => ({ ...s, status: "error", lastAction: msg }));
        },
      });
      sessionRef.current = session;
      session.start();
      return;
    }

    // Voxtype daemon PTT (system mic) — avoids blocked webview getUserMedia
    const session = createLocalWhisperPtt({
      preferVoxtypeDaemon: engine === "voxtype",
      onError: (msg) => {
        handlersRef.current.onError?.(msg);
        setHud((s) => ({ ...s, status: "error", lastAction: msg }));
      },
    });
    sessionRef.current = session;
    void Promise.resolve(session.start()).catch(() => {
      listeningRef.current = false;
      setHud((s) => ({ ...s, listening: false, status: "error" }));
    });
  }, []);

  const stopListening = useCallback(async () => {
    if (!listeningRef.current && !sessionRef.current) return;
    listeningRef.current = false;
    setHud((s) => ({
      ...s,
      listening: false,
      status: "processing",
      lastAction:
        engineRef.current === "voxtype"
          ? "Transcribing with Voxtype…"
          : engineRef.current === "local-whisper"
            ? "Transcribing with whisper…"
            : "Processing…",
    }));

    const session = sessionRef.current;
    sessionRef.current = null;
    const transcript = session ? await session.stop() : "";

    setHud((s) => ({
      ...s,
      lastFinal: transcript,
      interim: "",
      listening: false,
    }));

    if (!transcript.trim()) {
      setHud((s) => ({
        ...s,
        status: "idle",
        lastAction: "No speech detected",
      }));
      return;
    }

    // Show recognized text in composer path
    handlersRef.current.onInterim?.(transcript);
    const intent = parseVoiceIntent(transcript);
    await dispatch(intent);
  }, [dispatch]);

  const abortListening = useCallback(() => {
    listeningRef.current = false;
    sessionRef.current?.abort();
    sessionRef.current = null;
    setHud((s) => ({
      ...s,
      listening: false,
      status: "idle",
      interim: "",
    }));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return Boolean(t.closest("textarea, input, [contenteditable=true]"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      startListening();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (!listeningRef.current) return;
      e.preventDefault();
      void stopListening();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, startListening, stopListening]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && listeningRef.current) {
        abortListening();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, abortListening]);

  return {
    hud,
    startListening,
    stopListening,
    abortListening,
    available: hud.available,
  };
}
