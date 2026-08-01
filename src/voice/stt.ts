/**
 * Speech-to-text backends for Helm push-to-talk.
 *
 * 1. Web Speech API when available (rare on Linux WebKitGTK)
 * 2. Local MediaRecorder + whisper CLI via Tauri (preferred on Linux)
 */

import {
  createMediaRecorderPtt,
  createVoxtypeDaemonPtt,
  fetchLocalSttStatus,
  type LocalSttStatus,
} from "./localStt";

export type SttStatus =
  | "idle"
  | "listening"
  | "processing"
  | "unsupported"
  | "error";

export type SttEngine =
  | "web-speech"
  | "voxtype"
  | "local-whisper"
  | "none";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
};

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isWebSpeechAvailable(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export async function resolveSttEngine(): Promise<{
  engine: SttEngine;
  local: LocalSttStatus | null;
  detail: string;
}> {
  if (isWebSpeechAvailable()) {
    return {
      engine: "web-speech",
      local: null,
      detail: "Web Speech API",
    };
  }
  try {
    const local = await fetchLocalSttStatus();
    if (local.available) {
      const engine: SttEngine =
        local.backend === "voxtype" ? "voxtype" : "local-whisper";
      return {
        engine,
        local,
        detail: local.detail,
      };
    }
    return {
      engine: "none",
      local,
      detail: local.detail,
    };
  } catch (e) {
    return {
      engine: "none",
      local: null,
      detail: String(e),
    };
  }
}

export type SttSession = {
  start: () => void | Promise<void>;
  stop: () => Promise<string>;
  abort: () => void;
};

export function createWebSpeechPtt(opts: {
  lang?: string;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
}): SttSession {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return {
      start: () =>
        opts.onError?.("Speech recognition not available in this webview"),
      stop: async () => "",
      abort: () => {},
    };
  }

  let rec: SpeechRecognitionLike | null = null;
  let finals: string[] = [];
  let lastInterim = "";
  let resolveStop: ((t: string) => void) | null = null;
  let active = false;

  const finish = () => {
    const parts = [...finals];
    if (lastInterim) parts.push(lastInterim);
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    finals = [];
    lastInterim = "";
    active = false;
    if (resolveStop) {
      const r = resolveStop;
      resolveStop = null;
      r(text);
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      finals = [];
      lastInterim = "";
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = opts.lang || "en-US";

      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const piece = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) {
            finals.push(piece.trim());
            lastInterim = "";
          } else {
            interim += piece;
          }
        }
        if (interim) {
          lastInterim = interim.trim();
          opts.onInterim?.(
            [...finals, lastInterim].join(" ").replace(/\s+/g, " ").trim(),
          );
        } else if (finals.length) {
          opts.onInterim?.(finals.join(" ").replace(/\s+/g, " ").trim());
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        opts.onError?.(ev.error || "stt error");
      };

      rec.onend = () => {
        if (active && rec) {
          try {
            rec.start();
          } catch {
            finish();
          }
        } else {
          finish();
        }
      };

      try {
        rec.start();
      } catch (e) {
        active = false;
        opts.onError?.(String(e));
      }
    },

    stop() {
      return new Promise<string>((resolve) => {
        if (!active && !rec) {
          resolve("");
          return;
        }
        resolveStop = resolve;
        active = false;
        try {
          rec?.stop();
        } catch {
          finish();
        }
        window.setTimeout(() => {
          if (resolveStop) finish();
        }, 800);
      });
    },

    abort() {
      active = false;
      resolveStop = null;
      finals = [];
      lastInterim = "";
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
    },
  };
}

/** Prefer Voxtype daemon (no webview mic). Fallback: MediaRecorder. */
export function createLocalWhisperPtt(opts: {
  onError?: (message: string) => void;
  preferVoxtypeDaemon?: boolean;
}): SttSession {
  const useDaemon = opts.preferVoxtypeDaemon !== false;
  const inner = useDaemon
    ? createVoxtypeDaemonPtt({ onError: opts.onError })
    : createMediaRecorderPtt({ onError: opts.onError });
  return {
    start: () => inner.start(),
    stop: () => inner.stop(),
    abort: () => inner.abort(),
  };
}
