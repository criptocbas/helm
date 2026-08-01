import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type {
  AgentNodeData,
  BoardListItem,
  SavedBoard,
  SessionInfo,
  TerminalNodeData,
} from "../types/board";
import {
  emptyAgentData,
  isAgentData,
  type HelmNode,
} from "../types/helm";
import { nextId } from "../lib/ids";
import type { StreamBuf } from "../lib/streamBuffers";

type Args = {
  boardId: string | null;
  boardName: string;
  projectCwd: string;
  connected: boolean;
  nodesRef: MutableRefObject<HelmNode[]>;
  rfRef: MutableRefObject<ReactFlowInstance<HelmNode, Edge> | null>;
  streamBufs: MutableRefObject<Map<string, StreamBuf>>;
  setBoardId: (id: string | null) => void;
  setBoardName: (name: string) => void;
  setProjectCwd: (cwd: string) => void;
  setNodes: Dispatch<SetStateAction<HelmNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelectedId: (id: string | null) => void;
  setBoards: (b: BoardListItem[]) => void;
  setSaveState: (s: "idle" | "saving" | "saved") => void;
  setError: (e: string | null) => void;
  nodes: HelmNode[];
  edges: Edge[];
};

export function useBoardPersistence({
  boardId,
  boardName,
  projectCwd,
  connected,
  nodesRef,
  rfRef,
  streamBufs,
  setBoardId,
  setBoardName,
  setProjectCwd,
  setNodes,
  setEdges,
  setSelectedId,
  setBoards,
  setSaveState,
  setError,
  nodes,
  edges,
}: Args) {
  const saveTimer = useRef<number | null>(null);

  const buildSavedBoard = useCallback(async (): Promise<SavedBoard | null> => {
    if (!boardId) return null;
    const now = await invoke<string>("board_now");
    const vp = rfRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const savedNodes = nodesRef.current
      .filter((n) => n.type === "agent" || n.type === "terminal")
      .map((n) => {
        if (n.type === "terminal") {
          const d = n.data as TerminalNodeData;
          return {
            id: n.id,
            kind: "terminal",
            title: d.label,
            position: { x: n.position.x, y: n.position.y },
            data: {
              shellKey: d.shellKey,
              cwd: d.cwd,
              label: d.label,
            },
          };
        }
        const d = n.data as AgentNodeData;
        return {
          id: n.id,
          kind: "agent",
          title: d.label,
          position: { x: n.position.x, y: n.position.y },
          data: {
            mode: d.mode ?? "tui",
            sessionId: d.sessionId,
            shellKey: d.shellKey,
            command: d.command,
            cwd: d.cwd,
            label: d.label,
            lastLine: d.lastLine,
          },
        };
      });
    return {
      id: boardId,
      name: boardName,
      projectCwd,
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
      nodes: savedNodes,
      edges: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [boardId, boardName, projectCwd, nodesRef, rfRef]);

  const persistBoard = useCallback(async () => {
    const board = await buildSavedBoard();
    if (!board) return;
    setSaveState("saving");
    try {
      await invoke("board_save", { board });
      setSaveState("saved");
      const list = await invoke<BoardListItem[]>("board_list");
      setBoards(list);
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch (e) {
      setSaveState("idle");
      setError(String(e));
    }
  }, [buildSavedBoard, setBoards, setError, setSaveState]);

  useEffect(() => {
    if (!boardId) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistBoard();
    }, 1500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, boardName, projectCwd, boardId, persistBoard]);

  const loadBoard = useCallback(
    async (id: string, opts?: { reconnectSessions?: boolean }) => {
      try {
        const board = await invoke<SavedBoard>("board_load", { id });
        setBoardId(board.id);
        setBoardName(board.name);
        setProjectCwd(board.projectCwd);
        streamBufs.current.clear();

        const restored: HelmNode[] = board.nodes
          .filter((n) => n.kind === "agent" || n.kind === "terminal")
          .map((n) => {
            if (n.kind === "terminal") {
              const cwd =
                typeof n.data.cwd === "string" ? n.data.cwd : board.projectCwd;
              const label =
                typeof n.data.label === "string"
                  ? n.data.label
                  : n.title || "Terminal";
              const shellKey =
                typeof n.data.shellKey === "string"
                  ? n.data.shellKey
                  : nextId("shell");
              return {
                id: n.id,
                type: "terminal" as const,
                position: n.position,
                data: {
                  kind: "terminal" as const,
                  shellKey,
                  cwd,
                  label,
                },
              };
            }
            const sessionId =
              typeof n.data.sessionId === "string" ? n.data.sessionId : null;
            const cwd =
              typeof n.data.cwd === "string" ? n.data.cwd : board.projectCwd;
            const label =
              typeof n.data.label === "string"
                ? n.data.label
                : n.title || "Agent";
            const lastLine =
              typeof n.data.lastLine === "string"
                ? n.data.lastLine
                : "Restored from board.";
            const mode =
              n.data.mode === "acp" || n.data.mode === "tui"
                ? n.data.mode
                : sessionId
                  ? "acp"
                  : "tui";
            const shellKey =
              typeof n.data.shellKey === "string"
                ? n.data.shellKey
                : mode === "tui"
                  ? nextId("grok-tui")
                  : undefined;
            const command = Array.isArray(n.data.command)
              ? (n.data.command as string[])
              : mode === "tui"
                ? ["grok", "--cwd", cwd, "--always-approve"]
                : undefined;
            const data = emptyAgentData(label, cwd, sessionId, {
              mode,
              shellKey,
              command,
              lastLine,
              state: mode === "tui" ? "working" : "disconnected",
            });
            return {
              id: n.id,
              type: "agent" as const,
              position: n.position,
              data,
              style: mode === "tui" ? { width: 900, height: 560 } : undefined,
            };
          });

        setNodes(restored);
        setEdges([]);
        setSelectedId(restored[0]?.id ?? null);

        requestAnimationFrame(() => {
          rfRef.current?.setViewport(board.viewport);
        });

        if (opts?.reconnectSessions && connected) {
          for (const n of restored) {
            if (n.type !== "agent" || !isAgentData(n.data) || !n.data.sessionId)
              continue;
            try {
              await invoke<SessionInfo>("session_load", {
                sessionId: n.data.sessionId,
                cwd: n.data.cwd,
              });
              setNodes((prev) =>
                prev.map((x) =>
                  x.id === n.id && isAgentData(x.data)
                    ? {
                        ...x,
                        data: {
                          ...x.data,
                          state: "idle",
                          missing: false,
                          lastLine: "Session reattached.",
                        },
                      }
                    : x,
                ),
              );
            } catch {
              setNodes((prev) =>
                prev.map((x) =>
                  x.id === n.id && isAgentData(x.data)
                    ? {
                        ...x,
                        data: {
                          ...x.data,
                          state: "failed",
                          missing: true,
                          lastLine: "Could not reattach session.",
                        },
                      }
                    : x,
                ),
              );
            }
          }
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [
      connected,
      setBoardId,
      setBoardName,
      setProjectCwd,
      setNodes,
      setEdges,
      setSelectedId,
      setError,
      streamBufs,
      rfRef,
    ],
  );

  const newBoard = useCallback(async () => {
    await persistBoard();
    const id = await invoke<string>("board_new_id");
    setBoardId(id);
    setBoardName("Untitled board");
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    streamBufs.current.clear();
  }, [
    persistBoard,
    setBoardId,
    setBoardName,
    setNodes,
    setEdges,
    setSelectedId,
    streamBufs,
  ]);

  return { persistBoard, loadBoard, newBoard };
}
