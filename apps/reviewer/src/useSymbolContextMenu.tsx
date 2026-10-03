import { useEffect, useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { navigationKinds, navigationLabels, type NavigationKind } from '../shared/navigation'
import { contextSymbol, type SymbolOrigin, type SymbolSelection } from './symbolSelection'
import './sourceContext.css'

export function useSymbolContextMenu(
  onAction: (kind: NavigationKind, symbol: SymbolSelection) => void,
) {
  const popup = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{
    symbol: SymbolSelection
    x: number
    y: number
    owner: HTMLElement
  }>()
  useEffect(() => {
    if (selection) popup.current?.focus()
  }, [selection])
  function bind(node: HTMLElement, origin: SymbolOrigin) {
    // Restore focus to the source surface when Escape dismisses its menu.
    node.tabIndex = -1
    node.oncontextmenu = (event) => {
      const symbol = contextSymbol(event, origin)
      if (!symbol) return
      event.preventDefault()
      event.stopPropagation()
      setSelection({ symbol, x: event.clientX, y: event.clientY, owner: node })
    }
  }
  const menu = selection && (
    <Menu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) setSelection(undefined)
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          className="symbol-context-positioner"
          align="start"
          anchor={{
            getBoundingClientRect: () => DOMRect.fromRect({ x: selection.x, y: selection.y }),
          }}
        >
          <Menu.Popup
            ref={popup}
            className="symbol-context-menu"
            aria-label={`Navigate ${selection.symbol.text}`}
            finalFocus={() => (selection.owner.isConnected ? selection.owner : false)}
          >
            <div className="symbol-context-name">{selection.symbol.text}</div>
            {navigationKinds.map((kind) => (
              <Menu.Item
                key={kind}
                onClick={() => {
                  setSelection(undefined)
                  onAction(kind, selection.symbol)
                }}
              >
                {navigationLabels[kind]}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
  return { bind, menu }
}
