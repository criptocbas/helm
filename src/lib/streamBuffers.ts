import { nextId } from "./ids";
import { MAX_ASSISTANT } from "../types/helm";

export type StreamBuf = {
  aId?: string;
  assistant: string;
  tId?: string;
  thought: string;
  /** Last raw chunk applied — skip exact consecutive duplicates from double delivery */
  lastChunk?: string;
};

export function createStreamBufferMap() {
  return new Map<string, StreamBuf>();
}

export function ensureBuf(
  map: Map<string, StreamBuf>,
  sessionId: string,
): StreamBuf {
  let b = map.get(sessionId);
  if (!b) {
    b = { assistant: "", thought: "" };
    map.set(sessionId, b);
  }
  return b;
}

export function clearStreamTurn(
  map: Map<string, StreamBuf>,
  sessionId: string,
) {
  map.set(sessionId, { assistant: "", thought: "" });
}

/**
 * Collapse stutter from double stream delivery:
 * "foo foo bar" → "foo bar"
 * "CheckingChecking" → "Checking"
 * "Grokrok" stays (not a full repeat) — only exact adjacent repeats.
 */
export function collapseStreamStutter(s: string): string {
  if (!s) return s;
  let out = s;
  // Adjacent identical words (with whitespace between)
  out = out.replace(/\b([A-Za-z0-9_./'`*-]{1,80})(\s+\1\b)+/g, "$1");
  // Adjacent identical tokens stuck together (length >= 2)
  // Apply a few passes for multi-stutter
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/([A-Za-z0-9_./'*-]{2,80})\1/g, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Merge a stream chunk. Handles:
 * - delta chunks (append)
 * - cumulative full-text chunks (replace when new starts with old)
 * - exact consecutive duplicates (ignore) — double listeners / double emit
 */
function mergeStreamText(
  prev: string,
  chunk: string,
  lastChunk: string | undefined,
): { text: string; lastChunk: string } {
  if (!chunk) return { text: prev, lastChunk: lastChunk ?? "" };

  // Exact consecutive duplicate event (most common double-listener case)
  if (lastChunk !== undefined && chunk === lastChunk) {
    return { text: prev, lastChunk };
  }

  if (!prev) {
    return { text: collapseStreamStutter(chunk), lastChunk: chunk };
  }
  if (chunk === prev) {
    return { text: prev, lastChunk: chunk };
  }

  // Cumulative stream: each event is the full text so far
  if (chunk.startsWith(prev) && chunk.length > prev.length) {
    return { text: collapseStreamStutter(chunk), lastChunk: chunk };
  }
  // New cumulative equals or shorter noise
  if (prev.startsWith(chunk) && prev.length >= chunk.length) {
    return { text: prev, lastChunk: chunk };
  }
  // Chunk already at end
  if (prev.endsWith(chunk)) {
    return { text: prev, lastChunk: chunk };
  }

  const merged = collapseStreamStutter(prev + chunk);
  return { text: merged, lastChunk: chunk };
}

export function appendAssistantChunk(
  map: Map<string, StreamBuf>,
  sessionId: string,
  chunk: string,
): { id: string; text: string } {
  const buf = ensureBuf(map, sessionId);
  if (!buf.aId) {
    buf.aId = nextId("msg");
    buf.assistant = "";
    buf.lastChunk = undefined;
  }
  const merged = mergeStreamText(buf.assistant, chunk, buf.lastChunk);
  buf.assistant = merged.text;
  buf.lastChunk = merged.lastChunk;
  if (buf.assistant.length > MAX_ASSISTANT) {
    buf.assistant = buf.assistant.slice(-MAX_ASSISTANT);
  }
  return { id: buf.aId, text: buf.assistant };
}

export function appendThoughtChunk(
  map: Map<string, StreamBuf>,
  sessionId: string,
  chunk: string,
): string {
  const buf = ensureBuf(map, sessionId);
  if (!buf.tId) {
    buf.tId = nextId("thought");
    buf.thought = "";
  }
  // Reuse lastChunk only for assistant; thought uses empty last for simplicity
  const merged = mergeStreamText(buf.thought, chunk, undefined);
  buf.thought = merged.text;
  if (buf.thought.length > 12_000) {
    buf.thought = "…\n" + buf.thought.slice(-10_000);
  }
  return buf.thought.length > 120 ? buf.thought.slice(-120) : buf.thought;
}
