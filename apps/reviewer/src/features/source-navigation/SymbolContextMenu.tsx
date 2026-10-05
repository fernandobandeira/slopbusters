import { Menu } from '@base-ui/react/menu'
import { useEffect, useState } from 'react'
import * as routes from '../../../shared/api'
import { call } from '../../lib/api'
import type { NavigationRequest } from '../../../shared/domain/navigation'
import type { CodeSymbol } from '../review/diff/codeSymbols'
import '../../sourceContext.css'

export interface SymbolMenuSelection extends CodeSymbol {
  x: number
  y: number
}

interface Props {
  selection?: SymbolMenuSelection
  source?: { pullId: string; side: NavigationRequest['side']; path: string }
  onNavigate: (kind: NavigationRequest['kind']) => void
  onClose: () => void
}

export function SymbolContextMenu({ selection, source, onNavigate, onClose }: Props) {
  const { checking, implementation } = useImplementationSupport(selection, source)
  const anchor = selection
    ? { getBoundingClientRect: () => new DOMRect(selection.x, selection.y, 0, 0) }
    : null
  return (
    <Menu.Root
      open={Boolean(selection)}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          anchor={anchor}
          positionMethod="fixed"
          align="start"
          sideOffset={2}
          className="symbol-menu-positioner"
        >
          <Menu.Popup
            className="symbol-context-menu"
            aria-label={`Actions for ${selection?.text ?? 'symbol'}`}
          >
            <Menu.Group>
              <Menu.GroupLabel className="symbol-menu-label">{selection?.text}</Menu.GroupLabel>
              <Menu.Item
                onClick={() => {
                  onNavigate('definition')
                }}
              >
                Go to definition
              </Menu.Item>
              <Menu.Item
                onClick={() => {
                  onNavigate('references')
                }}
              >
                Show references
              </Menu.Item>
              {checking && (
                <div className="symbol-menu-label" role="status">
                  Checking symbol actions…
                </div>
              )}
              {implementation && (
                <Menu.Item
                  onClick={() => {
                    onNavigate('implementation')
                  }}
                >
                  Show implementations
                </Menu.Item>
              )}
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function useImplementationSupport(selection: Props['selection'], source: Props['source']) {
  const key =
    selection && source
      ? JSON.stringify([source.pullId, source.side, source.path, selection.line, selection.column])
      : undefined
  const [support, setSupport] = useState<{ key: string; implementation: boolean | null }>()
  useEffect(() => {
    if (!selection || !source || !key) return
    const controller = new AbortController()
    void call(
      routes.getSymbolActions,
      {
        params: { id: source.pullId },
        body: {
          side: source.side,
          path: source.path,
          line: selection.line,
          column: selection.column,
        },
      },
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSupport({ key, ...result })
      })
      .catch(() => {
        // A failed eligibility check must not prevent navigation.
        if (!controller.signal.aborted) setSupport({ key, implementation: null })
      })
    return () => {
      controller.abort()
    }
  }, [key, selection, source])
  const checking = Boolean(key && support?.key !== key)
  const implementation = !key || (support?.key === key && support.implementation !== false)
  return { checking, implementation }
}
