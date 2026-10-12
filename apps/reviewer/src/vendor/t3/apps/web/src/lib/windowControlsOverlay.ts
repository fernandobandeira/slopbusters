// Shim for T3 Code's apps/web/src/lib/windowControlsOverlay.ts. Upstream measures
// the Electron window-controls overlay; the reviewer draws no native title bar.
export function useNativeTitlebarHeight(): number {
  return 0;
}
