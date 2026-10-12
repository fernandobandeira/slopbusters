import type { CodeViewItem, DiffTokenEventBaseProps } from '@pierre/diffs'
import { type ComponentProps } from 'react'
import { StyledDiffCodeView } from '~/components/diffs/StyledDiffCodeView'
import { useTheme } from '~/hooks/useTheme'

type StyledProps<LAnnotation> = ComponentProps<typeof StyledDiffCodeView<LAnnotation>>

type Props<LAnnotation> = StyledProps<LAnnotation> & {
  /** Right-click on a code token, resolved through the app's symbol lookup. */
  readonly onTokenContextMenu?: (
    token: DiffTokenEventBaseProps,
    event: MouseEvent,
    item: CodeViewItem<LAnnotation>,
  ) => void
}

/** Review-specific chrome layered on T3 Code's styled viewer without editing it. */
const REVIEW_DIFF_CSS = `
/* Pierre moves the utility slot into the hovered row. Hide only that number's ink,
   preserving its width so the code does not shift when the comment button appears. */
[data-column-number]:has(> [data-gutter-utility-slot]) > [data-line-number-content] {
  visibility: hidden;
}

[data-column-number] > [data-gutter-utility-slot] {
  inset-inline: 0 !important;
  justify-content: center !important;
  align-items: flex-start !important;
  z-index: 3;
}

::slotted([slot='gutter-utility-slot']) {
  position: static !important;
  display: grid;
  place-items: center;
  height: var(--diffs-line-height);
}

[data-diffs-header] [data-title][role='button'] {
  cursor: pointer;
}

[data-diffs-header] [data-title][role='button']:focus-visible {
  outline: 1px solid var(--code-foreground);
  outline-offset: 3px;
  border-radius: 2px;
}

[data-diff-span][data-whitespace-only] {
  background-color: transparent !important;
}
`

/** The reviewer's diff surface: T3 Code's viewer plus symbol menus and gutter comment buttons. */
export function ReviewDiffCodeView<LAnnotation = undefined>({
  onTokenContextMenu,
  unsafeCSSExtra,
  options,
  ...props
}: Props<LAnnotation>) {
  const { contextMenuToken } = useTheme()
  return (
    <StyledDiffCodeView<LAnnotation>
      {...props}
      unsafeCSSExtra={unsafeCSSExtra ? `${REVIEW_DIFF_CSS}\n${unsafeCSSExtra}` : REVIEW_DIFF_CSS}
      options={{
        ...options,
        onPostRender: (node, _instance, phase, context) => {
          node.oncontextmenu = onTokenContextMenu
            ? (event) => {
                const token = contextMenuToken?.(event)
                if (token) onTokenContextMenu(token, event, context.item)
              }
            : null
          markWhitespaceOnlySpans(node)
          // Pierre types the callback per item kind, so each branch forwards its own context.
          return context.type === 'diff'
            ? options?.onPostRender?.(node, context.instance, phase, context)
            : options?.onPostRender?.(node, context.instance, phase, context)
        },
      }}
    />
  )
}

// Whitespace-only word decorations add noise around indentation without
// identifying changed code. Keep the text and line coordinates intact.
function markWhitespaceOnlySpans(node: HTMLElement) {
  for (const span of node.shadowRoot?.querySelectorAll('[data-diff-span]') ?? []) {
    span.toggleAttribute('data-whitespace-only', !span.textContent.trim())
  }
}
