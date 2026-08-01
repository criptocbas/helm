/**
 * Local PTT backends:
 * 1. Voxtype daemon (preferred) — system mic, no webview permission
 * 2. MediaRecorder → voxtype/whisper CLI (needs getUserMedia — often blocked in WebKit)
 */

import { invoke } from "@tauri-apps/api/core";

export type LocalSttStatus = {
  available: boolean;
  backend: string;
  detail: string;
  ffmpeg: boolean;
  whisper: boolean;
  voxtype?: boolean;
  whisperBin: string | null;
};

export async function fetchLocalSttStatus(): Promise<LocalSttStatus> {
  return invoke<LocalSttStatus>("stt_status");
}

export type LocalPttSession = {
  start: () => Promise<void>;
  stop: () => Promise<string>;
  abort: () => void;
};

/** Preferred: Voxtype daemon records with the system microphone. */
export function createVoxtypeDaemonPtt(opts: {
  onError?: (msg: string) => void;
}): LocalPttSession {
  let active = false;
  return {
    async start() {
      active = true;
      try {
        await invoke("voxtype_ptt_start");
      } catch (e) {
        active = false;
        const msg = String(e);
        opts.onError?.(msg);
        throw e;
      }
    },
    async stop() {
      if (!active) return "";
      active = false;
      try {
        const text = await invoke<string>("voxtype_ptt_stop");
        return (text || "").trim();
      } catch (e) {
        opts.onError?.(String(e));
        return "";
      }
    },
    abort() {
      active = false;
      void invoke("voxtype_ptt_cancel").catch(() => {});
    },
  };
}

function pickMime(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of types) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(t)
    ) {
      return t;
    }
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const i = dataUrl.indexOf(",");
      resolve(i >= 0 ? dataUrl.slice(i + 1) : dataUrl);
    };
    reader.onerror = () =>
      reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** Fallback: browser MediaRecorder (often blocked in Tauri WebKit). */
export function createMediaRecorderPtt(opts: {
  onError?: (msg: string) => void;
}): LocalPttSession {
  let media: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mime = "audio/webm";
  let resolveStop: ((t: string) => void) | null = null;
  let aborted = false;

  function cleanup() {
    try {
      recorder?.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      media?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    media = null;
    recorder = null;
    chunks = [];
  }

  return {
    async start() {
      aborted = false;
      chunks = [];
      if (!navigator.mediaDevices?.getUserMedia) {
        opts.onError?.(
          "Microphone API not available in this webview. Use Voxtype path instead.",
        );
        throw new Error("getUserMedia missing");
      }
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Microphone permission denied";
        opts.onError?.(
          `Mic access failed: ${msg}. Helm will use Voxtype daemon when available (no browser mic needed).`,
        );
        throw e;
      }

      mime = pickMime();
      recorder = new MediaRecorder(media, { mimeType: mime });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.start(200);
    },

    stop() {
      return new Promise<string>((resolve) => {
        resolveStop = resolve;
        const rec = recorder;
        if (!rec || rec.state === "inactive") {
          cleanup();
          resolve("");
          return;
        }

        rec.onstop = async () => {
          const finish = (t: string) => {
            if (resolveStop) {
              const r = resolveStop;
              resolveStop = null;
              r(t);
            }
          };
          try {
            if (aborted) {
              cleanup();
              finish("");
              return;
            }
            const blob = new Blob(chunks, { type: mime });
            if (blob.size < 400) {
              cleanup();
              finish("");
              return;
            }
            const b64 = await blobToBase64(blob);
            const text = await invoke<string>("stt_transcribe", {
              audioB64: b64,
              mime,
            });
            cleanup();
            finish(text.trim());
          } catch (e) {
            cleanup();
            opts.onError?.(String(e));
            finish("");
          }
        };

        try {
          rec.stop();
        } catch {
          cleanup();
          resolve("");
        }
        window.setTimeout(() => {
          if (resolveStop) {
            const r = resolveStop;
            resolveStop = null;
            cleanup();
            r("");
          }
        }, 120_000);
      });
    },

    abort() {
      aborted = true;
      try {
        recorder?.stop();
      } catch {
        /* ignore */
      }
      cleanup();
      if (resolveStop) {
        resolveStop("");
        resolveStop = null;
      }
    },
  };
}
