// Shim for T3 Code's apps/web/src/hooks/useTheme.ts. Upstream resolves a stored
// appearance preference; the reviewer supplies its selected diff theme and its
// diff worker factory through this context (see src/app/ThemeProvider.tsx).
import type { DiffTokenEventBaseProps } from "@pierre/diffs";
import { createContext, useContext } from "react";

export interface DiffRuntime {
  /** Diff theme for the worker pool: "light", "dark", or a bundled Shiki theme name. */
  readonly resolvedTheme: string;
  readonly createWorker: () => Worker;
  readonly contextMenuToken?: (event: MouseEvent) => DiffTokenEventBaseProps | undefined;
}

export const DiffRuntimeContext = createContext<DiffRuntime>({
  resolvedTheme: "light",
  createWorker: () => {
    throw new Error("Diff worker factory is missing from the application root.");
  },
});

export function useTheme(): DiffRuntime {
  return useContext(DiffRuntimeContext);
}
