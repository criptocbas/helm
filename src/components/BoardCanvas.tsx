import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type NodeTypes,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type Node,
  type ReactFlowInstance,
  BackgroundVariant,
} from "@xyflow/react";
import type { HelmNode } from "../types/helm";
import type { HelmTheme } from "../lib/theme";

type Props = {
  nodes: HelmNode[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange<HelmNode>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: OnConnect;
  onSelectionChange: (args: { nodes: Node[] }) => void;
  onInit: (inst: ReactFlowInstance<HelmNode, Edge>) => void;
  onNodeDoubleClick: (node: HelmNode) => void;
  empty: boolean;
  connected: boolean;
  projectCwd: string;
  connecting?: boolean;
  /** Canvas minimap / dots track stage theme */
  theme?: HelmTheme;
  onConnectClick: () => void;
  onPickProject: () => void;
  onSpawnClick: () => void;
  onPaletteClick: () => void;
};

function stageChrome(theme: HelmTheme | undefined) {
  const light = theme === "light";
  return {
    dots: light ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.06)",
    mask: light ? "rgba(238,241,246,0.78)" : "rgba(7,9,15,0.7)",
    agent: light ? "#dce3ef" : "#1a2233",
    subagent: light ? "#d4daf0" : "#2a2f4a",
    terminal: light ? "#cfe8eb" : "#0f2a2c",
  };
}

/**
 * First-run guided steps when the board is empty.
 * 1 Connect → 2 Pick project (if empty) → 3 Spawn first TUI.
 */
function firstRunStep(connected: boolean, projectCwd: string): 1 | 2 | 3 {
  if (!connected) return 1;
  if (!projectCwd.trim()) return 2;
  return 3;
}

export function BoardCanvas({
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onInit,
  onNodeDoubleClick,
  empty,
  connected,
  projectCwd,
  connecting,
  theme,
  onConnectClick,
  onPickProject,
  onSpawnClick,
  onPaletteClick,
}: Props) {
  const step = firstRunStep(connected, projectCwd);
  const chrome = stageChrome(theme);

  return (
    <div className="flex-1 min-w-0 relative">
      <ReactFlow
        className="helm-flow"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onSelectionChange={onSelectionChange}
        onInit={onInit}
        onNodeDoubleClick={(_, node) => onNodeDoubleClick(node as HelmNode)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={chrome.dots}
        />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === "subagent"
              ? chrome.subagent
              : n.type === "terminal"
                ? chrome.terminal
                : chrome.agent
          }
          maskColor={chrome.mask}
        />
      </ReactFlow>

      {empty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto text-center max-w-md px-6 py-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] backdrop-blur-sm">
            <h1 className="text-xl font-bold tracking-tight m-0 mb-2">
              Take the helm
            </h1>
            <p className="text-[13px] text-[var(--text-muted)] m-0 mb-4 leading-relaxed">
              Three steps to your first agent on the board. Voice and permission
              tools unlock after you spawn.
            </p>

            <ol className="first-run-steps text-left m-0 mb-5 pl-0 list-none">
              <li className={step === 1 ? "active" : step > 1 ? "done" : ""}>
                <span className="step-n">1</span>
                <span>Connect to Grok</span>
              </li>
              <li className={step === 2 ? "active" : step > 2 ? "done" : ""}>
                <span className="step-n">2</span>
                <span>Pick project folder</span>
              </li>
              <li className={step === 3 ? "active" : ""}>
                <span className="step-n">3</span>
                <span>Spawn first TUI agent</span>
              </li>
            </ol>

            <div className="flex gap-2 justify-center flex-wrap">
              {step === 1 ? (
                <button
                  type="button"
                  onClick={onConnectClick}
                  disabled={!!connecting}
                  className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "1 · Connect to Grok"}
                </button>
              ) : null}
              {step === 2 ? (
                <button
                  type="button"
                  onClick={onPickProject}
                  className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold"
                >
                  2 · Pick project folder
                </button>
              ) : null}
              {step === 3 ? (
                <button
                  type="button"
                  onClick={onSpawnClick}
                  className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold"
                >
                  3 · Spawn first agent
                </button>
              ) : null}
              <button
                type="button"
                onClick={onPaletteClick}
                className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] text-[13px] text-[var(--text-faint)]"
                title="Advanced commands (Ctrl+K)"
              >
                Commands
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
