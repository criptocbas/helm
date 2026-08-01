import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MarkerType, type Edge } from "@xyflow/react";
import {
  extractText,
  parseSessionUpdatePayload,
  parseSubagentFinished,
  parseSubagentSpawned,
  pickAllowOption,
  toolStatus,
  toolTitle,
} from "../lib/acpParse";
import { setAcpHandlers } from "../lib/acpListeners";
import { findAgentNode } from "../lib/conductor";
import { nextId } from "../lib/ids";
import { notifyOs } from "../lib/notify";
import { loadPrefs, type PermissionMode } from "../lib/prefs";
import {
  appendAssistantChunk,
  appendThoughtChunk,
  createStreamBufferMap,
  type StreamBuf,
} from "../lib/streamBuffers";
import type {
  AgentInfo,
  AgentNodeData,
  AgentNodeState,
  ChatItem,
  SubagentNodeData,
} from "../types/board";
import {
  isAgentData,
  MAX_TRANSCRIPT,
  type HelmNode,
} from "../types/helm";

type Args = {
  setNodes: Dispatch<SetStateAction<HelmNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setConnected: (v: boolean) => void;
  setAgentInfo: (v: AgentInfo | null) => void;
  setError: (v: string | null) => void;
  selectedIdRef: React.MutableRefObject<string | null>;
  nodesRef: React.MutableRefObject<HelmNode[]>;
  permissionModeRef: React.MutableRefObject<PermissionMode>;
  streamBufs: React.MutableRefObject<Map<string, StreamBuf>>;
};

/**
 * Wire Tauri ACP events into React state.
 * Subscriptions are process-wide singletons (see acpListeners.ts) so
 * React StrictMode cannot attach two handlers and double every token.
 */
export function useAcpBridge({
  setNodes,
  setEdges,
  setConnected,
  setAgentInfo,
  setError,
  selectedIdRef,
  nodesRef,
  permissionModeRef,
  streamBufs,
}: Args) {
  const setNodesRef = useRef(setNodes);
  const setEdgesRef = useRef(setEdges);
  const setConnectedRef = useRef(setConnected);
  const setAgentInfoRef = useRef(setAgentInfo);
  const setErrorRef = useRef(setError);
  setNodesRef.current = setNodes;
  setEdgesRef.current = setEdges;
  setConnectedRef.current = setConnected;
  setAgentInfoRef.current = setAgentInfo;
  setErrorRef.current = setError;

  const patchBySession = useRef(
    (sessionId: string, patch: (data: AgentNodeData) => AgentNodeData) => {
      setNodesRef.current((prev) =>
        prev.map((n) => {
          if (n.type !== "agent" || !isAgentData(n.data)) return n;
          if (n.data.sessionId !== sessionId) return n;
          return { ...n, data: patch(n.data) };
        }),
      );
    },
  );

  useEffect(() => {
    if (streamBufs.current.size === 0) {
      streamBufs.current = createStreamBufferMap();
    }

    const handleSessionUpdate = (payload: unknown) => {
      const parsed = parseSessionUpdatePayload(payload);
      if (!parsed) return;
      const { sessionId, kind, update } = parsed;
      const patch = patchBySession.current;

      if (kind === "agent_message_chunk") {
        const chunk = extractText(update.content);
        if (!chunk) return;
        const { id, text } = appendAssistantChunk(
          streamBufs.current,
          sessionId,
          chunk,
        );
        patch(sessionId, (data) => {
          const rest = data.transcript.filter((i) => i.id !== id);
          const item: ChatItem = { id, role: "assistant", text };
          let transcript = [...rest, item];
          if (transcript.length > MAX_TRANSCRIPT) {
            transcript = transcript.slice(-MAX_TRANSCRIPT);
          }
          return {
            ...data,
            state: "working",
            lastLine: text.slice(-160),
            transcript,
          };
        });
      } else if (kind === "agent_thought_chunk") {
        const chunk = extractText(update.content);
        if (!chunk) return;
        const preview = appendThoughtChunk(
          streamBufs.current,
          sessionId,
          chunk,
        );
        patch(sessionId, (data) => ({
          ...data,
          state: "working",
          lastLine: preview,
        }));
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const title = toolTitle(update);
        const status = toolStatus(update);
        const line = status ? `${title} · ${status}` : title;
        const toolId =
          (typeof update.toolCallId === "string" && update.toolCallId) ||
          (typeof update.tool_call_id === "string" && update.tool_call_id) ||
          nextId("tool");
        patch(sessionId, (data) => {
          const existing = data.transcript.findIndex(
            (i) => i.id === `tool-${toolId}`,
          );
          let transcript = data.transcript.slice();
          const item: ChatItem = {
            id: `tool-${toolId}`,
            role: "tool",
            text: title,
            meta: status || undefined,
          };
          if (existing >= 0) transcript[existing] = item;
          else transcript = [...transcript, item].slice(-MAX_TRANSCRIPT);
          return {
            ...data,
            state: "working",
            lastLine: line,
            transcript,
          };
        });
      } else if (kind === "subagent_spawned") {
        const spawned = parseSubagentSpawned(update);
        if (!spawned) return;
        const parent = findAgentNode(nodesRef.current, sessionId);
        if (!parent) return;
        const childNodeId = `sub-${spawned.subagentId}`;
        const edgeId = `e-${parent.id}-${childNodeId}`;

        setNodesRef.current((prev) => {
          if (prev.some((n) => n.id === childNodeId)) {
            return prev.map((n) =>
              n.id === childNodeId
                ? {
                    ...n,
                    data: {
                      ...(n.data as SubagentNodeData),
                      state: "working" as AgentNodeState,
                      label: spawned.description,
                      lastLine: "Running…",
                      subagentType: spawned.subagentType,
                      model: spawned.model,
                    },
                  }
                : n,
            );
          }
          const siblings = prev.filter(
            (n) =>
              n.type === "subagent" &&
              (n.data as SubagentNodeData).parentNodeId === parent.id,
          ).length;
          const child: HelmNode = {
            id: childNodeId,
            type: "subagent",
            position: {
              x: parent.position.x + (siblings % 3) * 200 - 100,
              y: parent.position.y + 200 + Math.floor(siblings / 3) * 120,
            },
            data: {
              kind: "subagent",
              subagentId: spawned.subagentId,
              parentSessionId: sessionId,
              parentNodeId: parent.id,
              label: spawned.description,
              state: "working",
              lastLine: "Running…",
              subagentType: spawned.subagentType,
              model: spawned.model,
            },
          };
          return [
            ...prev.map((n) =>
              n.id === parent.id && isAgentData(n.data)
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      lastLine: `Spawned: ${spawned.description}`,
                      transcript: [
                        ...n.data.transcript,
                        {
                          id: nextId("subcard"),
                          role: "subagent" as const,
                          text: spawned.description,
                          meta: "running",
                        },
                      ].slice(-MAX_TRANSCRIPT),
                    },
                  }
                : n,
            ),
            child,
          ];
        });

        setEdgesRef.current((prev) => {
          if (prev.some((e) => e.id === edgeId)) return prev;
          return [
            ...prev,
            {
              id: edgeId,
              source: parent.id,
              target: childNodeId,
              type: "smoothstep",
              animated: true,
              style: { stroke: "var(--thought)" },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "var(--thought)",
              },
              label: "spawned",
            },
          ];
        });

        patch(sessionId, (data) => ({ ...data, state: "working" }));
      } else if (kind === "subagent_finished") {
        const fin = parseSubagentFinished(update);
        if (!fin) return;
        const childNodeId = `sub-${fin.subagentId}`;
        const doneState: AgentNodeState =
          fin.status === "failed" ? "failed" : "completed";
        setNodesRef.current((prev) =>
          prev.map((n) => {
            if (n.id === childNodeId && n.type === "subagent") {
              return {
                ...n,
                data: {
                  ...(n.data as SubagentNodeData),
                  state: doneState,
                  lastLine: fin.summary,
                },
              };
            }
            if (
              n.type === "agent" &&
              isAgentData(n.data) &&
              n.data.sessionId === sessionId
            ) {
              return {
                ...n,
                data: {
                  ...n.data,
                  lastLine: `Subagent ${fin.status}: ${fin.summary.slice(0, 100)}`,
                  transcript: [
                    ...n.data.transcript,
                    {
                      id: nextId("subdone"),
                      role: "subagent" as const,
                      text: fin.summary,
                      meta: fin.status,
                    },
                  ].slice(-MAX_TRANSCRIPT),
                },
              };
            }
            return n;
          }),
        );
        setEdgesRef.current((prev) =>
          prev.map((e) =>
            e.target === childNodeId
              ? { ...e, animated: false, style: { stroke: "var(--text-faint)" } }
              : e,
          ),
        );

        const parent = findAgentNode(nodesRef.current, sessionId);
        if (
          parent &&
          parent.id !== selectedIdRef.current &&
          isAgentData(parent.data)
        ) {
          notifyOs(
            "Helm · subagent finished",
            `${parent.data.label}: ${fin.summary.slice(0, 80)}`,
          );
        }
      }
    };

    const clear = setAcpHandlers({
      onStatus: (payload) => {
        setConnectedRef.current(Boolean(payload?.running));
        if (!payload?.running) {
          setAgentInfoRef.current(null);
          setNodesRef.current((prev) =>
            prev.map((n) => {
              if (n.type === "agent" && isAgentData(n.data)) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    state: "disconnected" as AgentNodeState,
                  },
                };
              }
              if (n.type === "subagent") {
                return {
                  ...n,
                  data: {
                    ...(n.data as SubagentNodeData),
                    state: "disconnected" as AgentNodeState,
                  },
                };
              }
              return n;
            }),
          );
        }
      },
      onSessionUpdate: handleSessionUpdate,
      onPermission: (payload) => {
        const sid = payload.sessionId;
        const mode = permissionModeRef.current || loadPrefs().permissionMode;
        if (sid) {
          patchBySession.current(sid, (data) => ({
            ...data,
            state: "needs_input",
            lastLine: "Permission required…",
          }));
          const parent = findAgentNode(nodesRef.current, sid);
          if (
            parent &&
            parent.id !== selectedIdRef.current &&
            isAgentData(parent.data)
          ) {
            notifyOs(
              "Helm · needs you",
              `${parent.data.label} needs permission`,
            );
          }
        }
        if (mode === "auto") {
          const optionId = pickAllowOption(payload.options ?? []);
          if (optionId) {
            void invoke("permission_respond", {
              requestId: payload.requestId,
              optionId,
            }).catch((e) => setErrorRef.current(String(e)));
          }
        }
      },
      onPlanApproval: (payload) => {
        const sid = payload.sessionId;
        const mode = permissionModeRef.current || loadPrefs().permissionMode;
        if (sid) {
          patchBySession.current(sid, (data) => ({
            ...data,
            state: "needs_input",
            lastLine: "Plan ready — approve?",
          }));
          const parent = findAgentNode(nodesRef.current, sid);
          if (
            parent &&
            parent.id !== selectedIdRef.current &&
            isAgentData(parent.data)
          ) {
            notifyOs(
              "Helm · plan ready",
              `${parent.data.label} waits for plan approval`,
            );
          }
        }
        if (mode === "auto") {
          void invoke("plan_approval_respond", {
            requestId: payload.requestId,
            outcome: "approved",
            feedback: null,
          }).catch((e) => setErrorRef.current(String(e)));
        }
      },
    });

    return clear;
  }, [nodesRef, permissionModeRef, selectedIdRef, streamBufs]);
}
