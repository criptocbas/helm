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
  onConnectClick: () => void;
  onSpawnClick: () => void;
  onPaletteClick: () => void;
};

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
  onConnectClick,
  onSpawnClick,
  onPaletteClick,
}: Props) {
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
          color="rgba(255,255,255,0.06)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === "subagent"
              ? "#2a2f4a"
              : n.type === "terminal"
                ? "#0f2a2c"
                : "#1a2233"
          }
          maskColor="rgba(7,9,15,0.7)"
        />
      </ReactFlow>

      {empty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto text-center max-w-md px-6 py-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] backdrop-blur-sm">
            <h1 className="text-xl font-bold tracking-tight m-0 mb-2">
              Take the helm
            </h1>
            <p className="text-[13px] text-[var(--text-muted)] m-0 mb-5 leading-relaxed">
              Connect to Grok, spawn agents onto the infinite board, and conduct
              the fleet. Subagents appear as child nodes. Boards autosave.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {!connected ? (
                <button
                  type="button"
                  onClick={onConnectClick}
                  className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold"
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSpawnClick}
                  className="px-4 py-2 rounded-[var(--radius)] bg-[var(--accent)] text-[var(--accent-fg)] text-[13px] font-semibold"
                >
                  Spawn first agent
                </button>
              )}
              <button
                type="button"
                onClick={onPaletteClick}
                className="px-4 py-2 rounded-[var(--radius)] border border-[var(--border)] text-[13px] text-[var(--text-muted)]"
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
