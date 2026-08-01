/**
 * Process-wide singleton ACP event subscriptions.
 * React StrictMode mounts hooks twice; without a singleton we attach two
 * Tauri listeners and every stream chunk is applied twice → "word word" stutter.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AcpListenerHandlers = {
  onStatus: (payload: { running?: boolean }) => void;
  onSessionUpdate: (payload: unknown) => void;
  onPermission: (payload: {
    requestId: number;
    sessionId: string | null;
    options: { optionId: string; kind: string; name?: string }[];
  }) => void;
  onPlanApproval: (payload: {
    requestId: number;
    sessionId: string;
  }) => void;
};

let handlers: AcpListenerHandlers | null = null;
let started = false;
let startPromise: Promise<void> | null = null;
const unsubs: UnlistenFn[] = [];

async function ensureStarted() {
  if (started) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    if (started) return;

    const call = <T,>(fn: ((p: T) => void) | undefined, payload: T) => {
      try {
        fn?.(payload);
      } catch (e) {
        console.error("[helm acp listener]", e);
      }
    };

    unsubs.push(
      await listen<{ running?: boolean }>("acp://status", (ev) => {
        call(handlers?.onStatus, ev.payload ?? {});
      }),
    );
    unsubs.push(
      await listen<unknown>("acp://session-update", (ev) => {
        call(handlers?.onSessionUpdate, ev.payload);
      }),
    );
    unsubs.push(
      await listen<{
        requestId: number;
        sessionId: string | null;
        options: { optionId: string; kind: string; name?: string }[];
      }>("acp://permission", (ev) => {
        call(handlers?.onPermission, ev.payload);
      }),
    );
    unsubs.push(
      await listen<{
        requestId: number;
        sessionId: string;
      }>("acp://plan-approval", (ev) => {
        call(handlers?.onPlanApproval, ev.payload);
      }),
    );

    started = true;
  })();

  return startPromise;
}

/**
 * Register handlers for the singleton ACP bridge.
 * Returns unsubscribe for this registrant (does not tear down the socket).
 */
export function setAcpHandlers(next: AcpListenerHandlers): () => void {
  handlers = next;
  void ensureStarted();
  return () => {
    if (handlers === next) {
      handlers = null;
    }
  };
}
