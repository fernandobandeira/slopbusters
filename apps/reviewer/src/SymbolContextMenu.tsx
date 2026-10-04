import { Menu } from '@base-ui/react/menu'
import type { NavigationRequest } from '../shared/navigation'
import type { CodeSymbol } from './codeSymbols'
import './sourceContext.css'

export interface SymbolMenuSelection extends CodeSymbol {
  x: number
  y: number
}

interface Props {
  selection?: SymbolMenuSelection
  onNavigate: (kind: NavigationRequest['kind']) => void
  onClose: () => void
}

export function SymbolContextMenu({ selection, onNavigate, onClose }: Props) {
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
              <Menu.Item onClick={() => onNavigate('definition')}>Go to definition</Menu.Item>
              <Menu.Item onClick={() => onNavigate('references')}>Show references</Menu.Item>
              <Menu.Item onClick={() => onNavigate('implementation')}>
                Go to implementations
              </Menu.Item>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
