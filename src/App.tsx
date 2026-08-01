import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Edge,
  type Node,
  type NodeTypes,
  type OnConnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AgentNode } from "./canvas/nodes/AgentNode";
import { SubagentNode } from "./canvas/nodes/SubagentNode";
import { TerminalNode } from "./canvas/nodes/TerminalNode";
import { BoardCanvas } from "./components/BoardCanvas";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { TopBar } from "./components/TopBar";
import { TranscriptDock } from "./components/TranscriptDock";
import {
  appendUserTurn,
  findByLabel,
  listAgents,
  promptConductorAgent,
  spawnAgentSession,
  spawnTerminalNode,
  stopAgent as conductorStop,
  type ConductorAgent,
} from "./lib/conductor";
import { loadPrefs, savePrefs, type PermissionMode } from "./lib/prefs";
import { createStreamBufferMap, clearStreamTurn } from "./lib/streamBuffers";
import { useAcpBridge } from "./hooks/useAcpBridge";
import { useBoardPersistence } from "./hooks/useBoardPersistence";
import { VoiceHudStrip } from "./components/VoiceBar";
import { SessionTabs, sessionsFromNodes } from "./components/SessionTabs";
import {
  NeedsYouStrip,
  needsYouFromNodes,
} from "./components/NeedsYouStrip";
import { PermissionCard } from "./components/PermissionCard";
import { PlanApprovalCard } from "./components/PlanApprovalCard";
import { TuiMaximizeOverlay } from "./components/TuiMaximizeOverlay";
import { HelmUiProvider } from "./lib/helmUi";
import type { PendingPermission, PendingPlan } from "./lib/approvals";
import { useVoice } from "./voice/useVoice";
import type {
  AgentInfo,
  BoardListItem,
  GrokStatus,
  SessionInfo,
  SubagentNodeData,
  TerminalNodeData,
} from "./types/board";
import { isAgentData, type HelmNode } from "./types/helm";

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  subagent: SubagentNode,
  terminal: TerminalNode,
};

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<HelmNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [grok, setGrok] = useState<GrokStatus | null>(null);
  const [projectCwd, setProjectCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busySessions, setBusySessions] = useState<Set<string>>(new Set());
  const [dockOpen, setDockOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState("Untitled board");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () => loadPrefs().permissionMode,
  );
  const [voiceEnabled, setVoiceEnabled] = useState(
    () => loadPrefs().voiceEnabled,
  );
  const [maximizedNodeId, setMaximizedNodeId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<PendingPermission | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const streamBufs = useRef(createStreamBufferMap());
  const selectedIdRef = useRef<string | null>(null);
  const nodesRef = useRef<HelmNode[]>([]);
  const rfRef = useRef<ReactFlowInstance<HelmNode, Edge> | null>(null);
  const permissionModeRef = useRef(permissionMode);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    permissionModeRef.current = permissionMode;
  }, [permissionMode]);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const selectedAgent = useMemo(() => {
    if (selected?.type === "agent" && isAgentData(selected.data)) {
      return selected.data;
    }
    if (selected?.type === "subagent") {
      const parentId = (selected.data as SubagentNodeData).parentNodeId;
      const parent = nodes.find((n) => n.id === parentId);
      if (parent?.type === "agent" && isAgentData(parent.data)) return parent.data;
    }
    return null;
  }, [selected, nodes]);

  const selectedLabel = selected?.data.label ?? "";

  const sessionTabs = useMemo(() => sessionsFromNodes(nodes), [nodes]);
  const needsYouItems = useMemo(() => needsYouFromNodes(nodes), [nodes]);
  const firstRun = nodes.length === 0;

  const maximizedSession = useMemo(() => {
    if (!maximizedNodeId) return null;
    const n = nodes.find((x) => x.id === maximizedNodeId);
    if (!n) return null;
    if (n.type === "agent" && isAgentData(n.data) && n.data.mode === "tui" && n.data.shellKey) {
      return {
        label: n.data.label,
        shellKey: n.data.shellKey,
        cwd: n.data.cwd,
        command: n.data.command ?? null,
        kind: "tui" as const,
      };
    }
    if (n.type === "terminal" && n.data.kind === "terminal") {
      return {
        label: n.data.label,
        shellKey: n.data.shellKey,
        cwd: n.data.cwd,
        command: null as string[] | null,
        kind: "terminal" as const,
      };
    }
    return null;
  }, [maximizedNodeId, nodes]);

  const focusSession = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      const n = nodesRef.current.find((x) => x.id === nodeId);
      if (n && rfRef.current) {
        rfRef.current.setCenter(
          n.position.x + ((n.style?.width as number) || 450) / 2,
          n.position.y + ((n.style?.height as number) || 300) / 2,
          { zoom: rfRef.current.getZoom(), duration: 220 },
        );
      }
    },
    [],
  );

  const maximizeNode = useCallback((nodeId: string) => {
    setMaximizedNodeId(nodeId);
    setSelectedId(nodeId);
  }, []);

  const minimizeNode = useCallback(() => {
    setMaximizedNodeId(null);
  }, []);

  const markTuiLive = useCallback(
    (nodeId: string) => {
      setNodes((prev) =>
        prev.map((x) =>
          x.id === nodeId && isAgentData(x.data)
            ? {
                ...x,
                data: {
                  ...x.data,
                  missing: false,
                  state: "working",
                  lastLine: "TUI respawned — session live.",
                },
              }
            : x,
        ),
      );
    },
    [setNodes],
  );

  // Drop maximize if the node was deleted
  useEffect(() => {
    if (maximizedNodeId && !nodes.some((n) => n.id === maximizedNodeId)) {
      setMaximizedNodeId(null);
    }
  }, [nodes, maximizedNodeId]);

  const helmUi = useMemo(
    () => ({
      maximizedNodeId,
      maximizeNode,
      minimizeNode,
      markTuiLive,
    }),
    [maximizedNodeId, maximizeNode, minimizeNode, markTuiLive],
  );

  const flowCenter = useCallback(() => {
    return (
      rfRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 200, y: 160 }
    );
  }, []);

  useAcpBridge({
    setNodes,
    setEdges,
    setConnected,
    setAgentInfo,
    setError,
    selectedIdRef,
    nodesRef,
    permissionModeRef,
    streamBufs,
    setPendingPermission,
    setPendingPlan,
  });

  const { persistBoard, loadBoard, newBoard } = useBoardPersistence({
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
  });

  // Boot
  useEffect(() => {
    void (async () => {
      try {
        const status = await invoke<GrokStatus>("grok_status");
        setGrok(status);
        const cwd = await invoke<string>("default_cwd");
        setProjectCwd(cwd);
        const info = await invoke<AgentInfo | null>("agent_info");
        if (info) {
          setAgentInfo(info);
          setConnected(true);
        }
        const list = await invoke<BoardListItem[]>("board_list");
        setBoards(list);
        const active = await invoke<string | null>("board_active_id");
        if (active) {
          await loadBoard(active, { reconnectSessions: false });
        } else {
          const id = await invoke<string>("board_new_id");
          setBoardId(id);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persistBoard();
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persistBoard]);

  const reattachSessions = useCallback(async () => {
    for (const a of listAgents(nodesRef.current)) {
      if (!a.sessionId) continue;
      try {
        await invoke<SessionInfo>("session_load", {
          sessionId: a.sessionId,
          cwd: a.cwd,
        });
        setNodes((prev) =>
          prev.map((x) =>
            x.id === a.nodeId && isAgentData(x.data)
              ? {
                  ...x,
                  data: {
                    ...x.data,
                    state: "idle",
                    missing: false,
                    lastLine:
                      x.data.state === "disconnected" ||
                      x.data.lastLine === "Could not reattach session."
                        ? "Session reattached."
                        : x.data.lastLine,
                  },
                }
              : x,
          ),
        );
      } catch {
        setNodes((prev) =>
          prev.map((x) =>
            x.id === a.nodeId && isAgentData(x.data)
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
  }, [setNodes]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const info = await invoke<AgentInfo>("agent_start");
      setAgentInfo(info);
      setConnected(true);
      await reattachSessions();
    } catch (e) {
      setError(String(e));
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }, [reattachSessions]);

  const disconnect = useCallback(async () => {
    try {
      await invoke("agent_stop");
      setConnected(false);
      setAgentInfo(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const pickProject = useCallback(async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setProjectCwd(dir);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const spawnAgent = useCallback(
    async (label?: string) => {
      // Full Grok TUI does not require ACP connect — it is its own session.
      if (!projectCwd) {
        setError("Pick a project folder first.");
        return;
      }
      setError(null);
      try {
        const count = listAgents(nodesRef.current).length;
        const center = flowCenter();
        const { node } = await spawnAgentSession({
          cwd: projectCwd,
          label,
          tui: true,
          alwaysApprove: permissionMode === "auto",
          position: {
            x: center.x - 450 + (count % 2) * 40,
            y: center.y - 280 + Math.floor(count / 2) * 30,
          },
          existingAgentCount: count,
        });
        setNodes((prev) => [...prev, node]);
        setSelectedId(node.id);
      } catch (e) {
        setError(String(e));
      }
    },
    [projectCwd, setNodes, flowCenter, permissionMode],
  );

  const sendPromptToAgent = useCallback(
    async (agent: ConductorAgent, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setError(null);
      const busyKey = agent.sessionId || agent.shellKey || agent.nodeId;
      if (agent.sessionId) {
        clearStreamTurn(streamBufs.current, agent.sessionId);
      }
      setNodes((prev) =>
        prev.map((n) =>
          n.id === agent.nodeId && isAgentData(n.data)
            ? { ...n, data: appendUserTurn(n.data, trimmed) }
            : n,
        ),
      );
      setBusySessions((s) => new Set(s).add(busyKey));
      try {
        await promptConductorAgent(agent, trimmed);
        setNodes((prev) =>
          prev.map((n) =>
            n.id === agent.nodeId && isAgentData(n.data)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    state: "working",
                    lastLine:
                      agent.mode === "tui"
                        ? "Sent to Grok TUI"
                        : n.data.lastLine,
                  },
                }
              : n,
          ),
        );
      } catch (e) {
        setError(String(e));
        setNodes((prev) =>
          prev.map((n) =>
            n.id === agent.nodeId && isAgentData(n.data)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    state: "failed",
                    lastLine: String(e),
                  },
                }
              : n,
          ),
        );
      } finally {
        setBusySessions((s) => {
          const n = new Set(s);
          n.delete(busyKey);
          return n;
        });
      }
    },
    [setNodes],
  );

  const spawnTerminal = useCallback(() => {
    if (!projectCwd) {
      setError("Pick a project folder first.");
      return;
    }
    const count = nodesRef.current.filter((n) => n.type === "terminal").length;
    const center = flowCenter();
    const node = spawnTerminalNode({
      cwd: projectCwd,
      position: {
        x: center.x - 200 + count * 24,
        y: center.y + 40 + count * 16,
      },
      existingTerminalCount: count,
    });
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
  }, [projectCwd, setNodes, flowCenter]);

  const selectedConductor = useMemo((): ConductorAgent | null => {
    if (!selected || selected.type !== "agent" || !isAgentData(selected.data)) {
      // subagent → parent
      if (selected?.type === "subagent") {
        const parentId = (selected.data as SubagentNodeData).parentNodeId;
        return (
          listAgents(nodes).find((a) => a.nodeId === parentId) ?? null
        );
      }
      return null;
    }
    return (
      listAgents(nodes).find((a) => a.nodeId === selected.id) ?? null
    );
  }, [selected, nodes]);

  const sendPrompt = useCallback(async () => {
    const text = prompt.trim();
    if (!text || !selectedConductor) return;
    // TUI agents: inject into embedded grok; ACP: session_prompt
    if (
      selectedConductor.mode === "acp" &&
      !selectedConductor.sessionId
    ) {
      return;
    }
    if (selectedConductor.mode === "tui" && !selectedConductor.shellKey) {
      return;
    }
    setPrompt("");
    await sendPromptToAgent(selectedConductor, text);
  }, [prompt, selectedConductor, sendPromptToAgent]);

  const focusAgentByName = useCallback((name: string): boolean => {
    const agent = findByLabel(nodesRef.current, name);
    if (!agent) return false;
    focusSession(agent.nodeId);
    return true;
  }, [focusSession]);

  const tellAgentByName = useCallback(
    async (name: string, message: string): Promise<boolean> => {
      const agent = findByLabel(nodesRef.current, name);
      if (!agent) return false;
      if (agent.mode === "tui" && !agent.shellKey) return false;
      if (agent.mode === "acp" && !agent.sessionId) return false;
      focusSession(agent.nodeId);
      await sendPromptToAgent(agent, message);
      return true;
    },
    [sendPromptToAgent, focusSession],
  );

  const stopSelected = useCallback(async () => {
    const agent = selectedConductor;
    if (!agent) return;
    try {
      if (agent.mode === "tui" && agent.shellKey) {
        // Kill the embedded grok TUI process
        await invoke("pty_kill_session", { sessionId: agent.shellKey });
        setNodes((prev) =>
          prev.map((n) =>
            n.id === agent.nodeId && isAgentData(n.data)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    state: "idle",
                    lastLine: "TUI stopped.",
                  },
                }
              : n,
          ),
        );
        return;
      }
      if (!agent.sessionId) return;
      await conductorStop(agent.sessionId);
      clearStreamTurn(streamBufs.current, agent.sessionId);
      setNodes((prev) =>
        prev.map((n) =>
          n.type === "agent" &&
          isAgentData(n.data) &&
          n.data.sessionId === agent.sessionId
            ? { ...n, data: { ...n.data, state: "idle", lastLine: "Stopped." } }
            : n,
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  }, [selectedConductor, setNodes]);

  const stopAll = useCallback(async () => {
    for (const a of listAgents(nodesRef.current)) {
      if (!a.sessionId) continue;
      try {
        await conductorStop(a.sessionId);
        clearStreamTurn(streamBufs.current, a.sessionId);
        setNodes((prev) =>
          prev.map((n) =>
            n.type === "agent" &&
            isAgentData(n.data) &&
            n.data.sessionId === a.sessionId
              ? {
                  ...n,
                  data: { ...n.data, state: "idle", lastLine: "Stopped." },
                }
              : n,
          ),
        );
      } catch {
        /* continue */
      }
    }
  }, [setNodes]);

  const respondPermission = useCallback(
    async (optionId: string | null) => {
      if (!pendingPermission) return;
      setApprovalBusy(true);
      try {
        await invoke("permission_respond", {
          requestId: pendingPermission.requestId,
          optionId,
        });
        setPendingPermission(null);
        if (pendingPermission.sessionId) {
          // clear needs_input if we still own that session
          setNodes((prev) =>
            prev.map((n) =>
              n.type === "agent" &&
              isAgentData(n.data) &&
              n.data.sessionId === pendingPermission.sessionId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      state: "working",
                      lastLine: optionId
                        ? "Permission granted"
                        : "Permission denied",
                    },
                  }
                : n,
            ),
          );
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setApprovalBusy(false);
      }
    },
    [pendingPermission, setNodes],
  );

  const respondPlan = useCallback(
    async (outcome: "approved" | "cancelled") => {
      if (!pendingPlan) return;
      setApprovalBusy(true);
      try {
        await invoke("plan_approval_respond", {
          requestId: pendingPlan.requestId,
          outcome,
          feedback: null,
        });
        setPendingPlan(null);
        setNodes((prev) =>
          prev.map((n) =>
            n.type === "agent" &&
            isAgentData(n.data) &&
            n.data.sessionId === pendingPlan.sessionId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    state: outcome === "approved" ? "working" : "idle",
                    lastLine:
                      outcome === "approved"
                        ? "Plan approved"
                        : "Plan cancelled",
                  },
                }
              : n,
          ),
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setApprovalBusy(false);
      }
    },
    [pendingPlan, setNodes],
  );

  const pendingAgentLabel = useMemo(() => {
    const sid = pendingPermission?.sessionId || pendingPlan?.sessionId;
    if (!sid) return undefined;
    return listAgents(nodes).find((a) => a.sessionId === sid)?.label;
  }, [pendingPermission, pendingPlan, nodes]);

  const agentCount = useMemo(() => listAgents(nodes).length, [nodes]);

  const { hud: voiceHud, startListening, stopListening } = useVoice(
    {
      onSpawn: (label) => spawnAgent(label),
      onStop: () => stopSelected(),
      onStopAll: () => stopAll(),
      onFocus: focusAgentByName,
      onTell: tellAgentByName,
      onPrompt: async (text) => {
        const agent =
          selectedConductor ||
          listAgents(nodesRef.current).find(
            (a) => a.shellKey || a.sessionId,
          ) ||
          null;
        if (!agent) {
          setError("Select or spawn an agent before voice prompts.");
          return;
        }
        focusSession(agent.nodeId);
        await sendPromptToAgent(agent, text);
      },
      onInterim: (text) => setPrompt(text),
      onError: (msg) => setError(msg),
    },
    voiceEnabled,
  );

  const renameSelected = useCallback(() => {
    if (!selected || selected.type !== "agent" || !isAgentData(selected.data))
      return;
    const next = window.prompt("Agent name", selected.data.label);
    if (!next?.trim()) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === selected.id && isAgentData(n.data)
          ? { ...n, data: { ...n.data, label: next.trim() } }
          : n,
      ),
    );
  }, [selected, setNodes]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    const removing = nodesRef.current.find((n) => n.id === selectedId);
    if (removing?.type === "terminal") {
      const shellKey = (removing.data as TerminalNodeData).shellKey;
      void invoke("pty_kill_session", { sessionId: shellKey }).catch(() => {});
    }
    setNodes((prev) => {
      const target = prev.find((n) => n.id === selectedId);
      if (!target) return prev;
      if (target.type === "agent") {
        return prev.filter(
          (n) =>
            n.id !== selectedId &&
            !(
              n.type === "subagent" &&
              (n.data as SubagentNodeData).parentNodeId === selectedId
            ),
        );
      }
      return prev.filter((n) => n.id !== selectedId);
    });
    setEdges((prev) =>
      prev.filter((e) => e.source !== selectedId && e.target !== selectedId),
    );
    setSelectedId(null);
  }, [selectedId, setEdges, setNodes]);

  const onConnect: OnConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            style: { stroke: "var(--text-faint)" },
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedId(sel[0]?.id ?? null);
  }, []);

  const togglePermissionMode = useCallback(() => {
    setPermissionMode((m) => {
      const next: PermissionMode = m === "auto" ? "ask" : "auto";
      savePrefs({ permissionMode: next });
      return next;
    });
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((v) => {
      const next = !v;
      savePrefs({ voiceEnabled: next });
      return next;
    });
  }, []);

  const selectedBusy = selectedConductor
    ? busySessions.has(
        selectedConductor.sessionId ||
          selectedConductor.shellKey ||
          selectedConductor.nodeId,
      )
    : false;

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "connect",
        label: connected ? "Disconnect Grok" : "Connect to Grok",
        run: () => {
          if (connected) void disconnect();
          else void connect();
        },
      },
      {
        id: "spawn",
        label: "Spawn agent",
        hint: "conductor",
        run: () => void spawnAgent(),
      },
      {
        id: "terminal",
        label: "Spawn terminal",
        disabled: !projectCwd,
        run: () => spawnTerminal(),
      },
      {
        id: "stop",
        label: "Stop selected agent",
        disabled: !selectedConductor,
        run: () => void stopSelected(),
      },
      {
        id: "stop-all",
        label: "Stop all agents",
        run: () => void stopAll(),
      },
      {
        id: "rename",
        label: "Rename selected agent",
        disabled: selected?.type !== "agent",
        run: () => renameSelected(),
      },
      {
        id: "remove",
        label: "Remove selected node",
        disabled: !selectedId,
        run: () => removeSelected(),
      },
      {
        id: "project",
        label: "Pick project folder",
        run: () => void pickProject(),
      },
      {
        id: "perms",
        label:
          permissionMode === "auto"
            ? "Permission: auto / always-approve (toggle → ask)"
            : "Permission: ask / safe (toggle → auto dogfood)",
        hint: "default is ask",
        run: () => togglePermissionMode(),
      },
      {
        id: "voice",
        label: voiceEnabled ? "Disable voice" : "Enable voice",
        hint: "Space PTT",
        run: () => toggleVoice(),
      },
      {
        id: "save",
        label: "Save board",
        hint: "Ctrl+S",
        run: () => void persistBoard(),
      },
      {
        id: "new-board",
        label: "New board",
        run: () => void newBoard(),
      },
      {
        id: "dock",
        label: dockOpen ? "Hide transcript dock" : "Show transcript dock",
        run: () => setDockOpen((v) => !v),
      },
      {
        id: "fit",
        label: "Fit view",
        run: () => rfRef.current?.fitView({ padding: 0.2 }),
      },
      ...boards.slice(0, 8).map((b) => ({
        id: `board-${b.id}`,
        label: `Open board: ${b.name}`,
        hint: `${b.nodeCount} agents`,
        run: () => void loadBoard(b.id, { reconnectSessions: connected }),
      })),
    ],
    [
      connected,
      connect,
      disconnect,
      spawnAgent,
      spawnTerminal,
      projectCwd,
      stopSelected,
      stopAll,
      selectedAgent,
      selected,
      selectedId,
      renameSelected,
      removeSelected,
      pickProject,
      permissionMode,
      togglePermissionMode,
      voiceEnabled,
      toggleVoice,
      persistBoard,
      newBoard,
      dockOpen,
      boards,
      loadBoard,
    ],
  );

  return (
    <HelmUiProvider value={helmUi}>
      <div className="flex flex-col h-full">
        <TopBar
          boardName={boardName}
          onBoardNameChange={setBoardName}
          connected={connected}
          connecting={connecting}
          grok={grok}
          agentInfo={agentInfo}
          projectCwd={projectCwd}
          saveState={saveState}
          permissionMode={permissionMode}
          voiceEnabled={voiceEnabled}
          voiceHud={voiceHud}
          voiceTargetLabel={selectedAgent?.label ?? null}
          agentCount={agentCount}
          firstRun={firstRun}
          onConnect={() => void connect()}
          onDisconnect={() => void disconnect()}
          onPickProject={() => void pickProject()}
          onSpawnAgent={() => void spawnAgent()}
          onSpawnTerminal={() => spawnTerminal()}
          onOpenPalette={() => setPaletteOpen(true)}
          onTogglePermissionMode={togglePermissionMode}
          onToggleVoice={toggleVoice}
          onMicDown={() => startListening()}
          onMicUp={() => void stopListening()}
        />

        <NeedsYouStrip
          items={needsYouItems}
          selectedId={selectedId}
          onFocus={focusSession}
        />

        <SessionTabs
          tabs={sessionTabs}
          selectedId={selectedId}
          maximizedId={maximizedNodeId}
          onSelect={focusSession}
          onMaximize={maximizeNode}
          onMinimize={minimizeNode}
        />

        {error ? (
          <div className="px-4 py-2 text-[12px] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg))] text-[var(--danger)] border-b border-[var(--border)] shrink-0 flex items-center gap-2">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              className="underline text-[var(--text-muted)]"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        ) : null}

        {pendingPermission || pendingPlan ? (
          <div className="approval-dock shrink-0 border-b border-[var(--border)] px-3 py-2 bg-[var(--bg-panel)] flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
            {pendingPermission ? (
              <PermissionCard
                pending={pendingPermission}
                agentLabel={pendingAgentLabel}
                busy={approvalBusy}
                onAllow={(id) => void respondPermission(id)}
                onDeny={(id) => void respondPermission(id)}
                onDismiss={() => setPendingPermission(null)}
              />
            ) : null}
            {pendingPlan ? (
              <PlanApprovalCard
                pending={pendingPlan}
                agentLabel={pendingAgentLabel}
                busy={approvalBusy}
                onApprove={() => void respondPlan("approved")}
                onCancel={() => void respondPlan("cancelled")}
                onDismiss={() => setPendingPlan(null)}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 relative flex">
            <BoardCanvas
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              onInit={(inst) => {
                rfRef.current = inst;
              }}
              onNodeDoubleClick={(node) => {
                if (node.type === "agent") {
                  setSelectedId(node.id);
                  if (isAgentData(node.data) && node.data.mode === "tui") {
                    maximizeNode(node.id);
                    return;
                  }
                  if (isAgentData(node.data) && node.data.mode === "acp") {
                    setDockOpen(true);
                  }
                }
                if (node.type === "terminal") {
                  setSelectedId(node.id);
                  maximizeNode(node.id);
                }
              }}
              empty={nodes.length === 0}
              connected={connected}
              projectCwd={projectCwd}
              connecting={connecting}
              onConnectClick={() => void connect()}
              onPickProject={() => void pickProject()}
              onSpawnClick={() => void spawnAgent()}
              onPaletteClick={() => setPaletteOpen(true)}
            />
            <VoiceHudStrip
              hud={voiceHud}
              voiceEnabled={voiceEnabled}
              targetLabel={selectedAgent?.label ?? null}
            />
          </div>

          <TranscriptDock
            open={dockOpen && !!selectedAgent && !maximizedNodeId}
            onClose={() => setDockOpen(false)}
            agent={selectedAgent}
            label={selectedLabel || "Agent"}
          />
        </div>

        <Composer
          selectedAgent={selectedAgent}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSend={() => void sendPrompt()}
          onStop={() => void stopSelected()}
          onOpenDock={() => setDockOpen(true)}
          busy={selectedBusy}
          promptRef={promptRef}
        />

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          actions={paletteActions}
        />

        {maximizedSession ? (
          <TuiMaximizeOverlay
            label={maximizedSession.label}
            shellKey={maximizedSession.shellKey}
            cwd={maximizedSession.cwd}
            command={maximizedSession.command}
            kind={maximizedSession.kind}
            onMinimize={minimizeNode}
          />
        ) : null}
      </div>
    </HelmUiProvider>
  );
}
