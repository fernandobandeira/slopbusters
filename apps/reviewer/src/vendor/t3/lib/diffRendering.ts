import type { ThemeId } from '../../../themes'
export type DiffThemeName = ThemeId;
export function resolveDiffThemeName(theme: ThemeId): DiffThemeName { return theme; }
export const DIFF_SURFACE_THEME_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  /* Gutter, context, and row tints all derive from the code surface the diff
     body sits on — mixing from the canvas leaves the gutter looking unthemed
     when a palette separates the two. */
  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(
    in srgb,
    var(--code-background) 95%,
    var(--code-foreground)
  );
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));

  --diffs-bg-addition-override: light-dark(
    color-mix(in srgb, var(--code-background) 50%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 70%, var(--diff-addition))
  );
  --diffs-bg-addition-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 35%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 60%, var(--diff-addition))
  );
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code-background) 85%, var(--diff-addition));
  --diffs-bg-addition-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 80%,
    var(--diff-addition)
  );

  --diffs-bg-deletion-override: light-dark(
    color-mix(in srgb, var(--code-background) 50%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 70%, var(--diff-deletion))
  );
  --diffs-bg-deletion-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 35%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 60%, var(--diff-deletion))
  );
  --diffs-bg-deletion-hover-override: color-mix(
    in srgb,
    var(--code-background) 85%,
    var(--diff-deletion)
  );
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 80%,
    var(--diff-deletion)
  );

  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}
`;
