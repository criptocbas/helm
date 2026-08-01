import { createContext, useContext, type ReactNode } from "react";

type HelmUiValue = {
  maximizedNodeId: string | null;
  maximizeNode: (nodeId: string) => void;
  minimizeNode: () => void;
  /** After user Respawn on a restored TUI — clear missing so autoSpawn works again */
  markTuiLive: (nodeId: string) => void;
};

const HelmUiContext = createContext<HelmUiValue>({
  maximizedNodeId: null,
  maximizeNode: () => {},
  minimizeNode: () => {},
  markTuiLive: () => {},
});

export function HelmUiProvider({
  value,
  children,
}: {
  value: HelmUiValue;
  children: ReactNode;
}) {
  return (
    <HelmUiContext.Provider value={value}>{children}</HelmUiContext.Provider>
  );
}

export function useHelmUi() {
  return useContext(HelmUiContext);
}
