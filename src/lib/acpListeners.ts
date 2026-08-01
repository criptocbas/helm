/**
 * Process-wide singleton ACP event subscriptions.
 * React StrictMode mounts hooks twice; without a singleton we attach two
 * Tauri listeners and every stream chunk is applied twice → "word word" stutter.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PermissionOption } from "./approvals";

export type PermissionEventPayload = {
  requestId: number;
  sessionId: string | null;
  options: PermissionOption[];
  toolCall?: unknown;
  raw?: unknown;
};

export type PlanApprovalEventPayload = {
  requestId: number;
  sessionId: string;
  toolCallId?: string | null;
  planContent?: string | null;
};

export type AcpListenerHandlers = {
  onStatus: (payload: { running?: boolean }) => void;
  onSessionUpdate: (payload: unknown) => void;
  onPermission: (payload: PermissionEventPayload) => void;
  onPlanApproval: (payload: PlanApprovalEventPayload) => void;
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
      await listen<PermissionEventPayload>("acp://permission", (ev) => {
        call(handlers?.onPermission, ev.payload);
      }),
    );
    unsubs.push(
      await listen<PlanApprovalEventPayload>("acp://plan-approval", (ev) => {
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
