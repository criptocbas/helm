import { createContext, useContext, type ReactNode } from "react";

type HelmUiValue = {
  maximizedNodeId: string | null;
  maximizeNode: (nodeId: string) => void;
  minimizeNode: () => void;
};

const HelmUiContext = createContext<HelmUiValue>({
  maximizedNodeId: null,
  maximizeNode: () => {},
  minimizeNode: () => {},
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
