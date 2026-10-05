import { resolveTheme, type ThemeRegistrationResolved } from '@pierre/diffs'

// Theme data comes from the Shiki bundles already used by the diff renderer.
// Keeping only descriptors here avoids importing every palette at startup.
export const themes = [
  { id: 'nord', name: 'Nord', type: 'dark' },
  { id: 'tokyo-night', name: 'Tokyo Night', type: 'dark' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', type: 'dark' },
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', type: 'dark' },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', type: 'dark' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', type: 'light' },
  { id: 'solarized-dark', name: 'Solarized Dark', type: 'dark' },
  { id: 'solarized-light', name: 'Solarized Light', type: 'light' },
  { id: 'one-dark-pro', name: 'One Dark', type: 'dark' },
  { id: 'one-light', name: 'One Light', type: 'light' },
  { id: 'github-dark', name: 'GitHub Dark', type: 'dark' },
  { id: 'github-light', name: 'GitHub Light', type: 'light' },
  { id: 'dracula', name: 'Dracula', type: 'dark' },
  { id: 'rose-pine', name: 'Rosé Pine', type: 'dark' },
  { id: 'rose-pine-moon', name: 'Rosé Pine Moon', type: 'dark' },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', type: 'light' },
  { id: 'gruvbox-dark-medium', name: 'Gruvbox Dark', type: 'dark' },
  { id: 'gruvbox-light-medium', name: 'Gruvbox Light', type: 'light' },
  { id: 'ayu-dark', name: 'Ayu Dark', type: 'dark' },
  { id: 'ayu-light', name: 'Ayu Light', type: 'light' },
  { id: 'everforest-dark', name: 'Everforest Dark', type: 'dark' },
  { id: 'everforest-light', name: 'Everforest Light', type: 'light' },
  { id: 'kanagawa-wave', name: 'Kanagawa', type: 'dark' },
  { id: 'monokai', name: 'Monokai', type: 'dark' },
] as const

export type ThemeId = (typeof themes)[number]['id']
export type ThemeType = 'dark' | 'light'
export const DEFAULT_THEME: ThemeId = 'nord'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && themes.some((theme) => theme.id === value)
}

export function getTheme(id: ThemeId) {
  return themes.find((theme) => theme.id === id)!
}

function readableForeground(color: string): string {
  const hex = color.match(/^#([a-f\d]{6})(?:[a-f\d]{2})?$/i)?.[1]
  if (!hex) return '#ffffff'
  const rgb = [0, 2, 4].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

export function themePalette(theme: ThemeRegistrationResolved): Record<string, string> {
  const colors = theme.colors ?? {}
  const light = theme.type === 'light'
  const background = theme.bg
  const foreground = theme.fg
  const mix = (amount: number) =>
    `color-mix(in srgb, ${background} ${100 - amount}%, ${foreground})`
  const color = (keys: string[], fallback: string) =>
    keys.map((key) => colors[key]).find(Boolean) ?? fallback
  const primary = color(['button.background', 'focusBorder'], light ? '#3069b3' : '#88c0d0')
  const success = color(
    ['gitDecoration.addedResourceForeground', 'charts.green'],
    light ? '#317a35' : '#a3be8c',
  )
  const destructive = color(
    ['errorForeground', 'gitDecoration.deletedResourceForeground', 'charts.red'],
    light ? '#bf3345' : '#ef8894',
  )
  const warning = color(
    ['editorWarning.foreground', 'charts.yellow'],
    light ? '#856000' : '#ebcb8b',
  )
  const info = color(['editorInfo.foreground', 'charts.blue'], light ? '#3069b3' : '#81a1c1')
  return {
    '--background': background,
    '--foreground': foreground,
    '--code-background': background,
    '--code-foreground': foreground,
    '--sidebar': color(['sideBar.background'], mix(2)),
    '--surface': color(['editorWidget.background', 'panel.background'], mix(4)),
    '--surface-hover': mix(8),
    '--surface-selected': `color-mix(in srgb, ${background} 88%, ${primary})`,
    '--surface-recessed': color(['input.background'], mix(2)),
    '--primary': primary,
    '--primary-foreground': color(['button.foreground'], readableForeground(primary)),
    '--secondary': color(['button.secondaryBackground'], mix(10)),
    '--secondary-foreground': color(['button.secondaryForeground'], foreground),
    '--muted': mix(6),
    '--muted-foreground': mix(65),
    '--contrast-muted-foreground': mix(75),
    '--accent': mix(10),
    '--accent-foreground': foreground,
    '--border': mix(15),
    '--input': mix(22),
    '--ring': color(['focusBorder'], primary),
    '--popover': color(['editorWidget.background'], mix(4)),
    '--popover-foreground': foreground,
    '--destructive': destructive,
    '--destructive-foreground': destructive,
    '--warning': warning,
    '--warning-foreground': readableForeground(warning),
    '--success': success,
    '--info': info,
    '--info-foreground': readableForeground(info),
    '--diff-addition': `color-mix(in srgb, ${background} 70%, ${success})`,
    '--diff-deletion': `color-mix(in srgb, ${background} 70%, ${destructive})`,
    '--app-scrollbar-thumb': mix(22),
    '--app-scrollbar-thumb-hover': mix(38),
  }
}

export async function loadThemePalette(id: ThemeId) {
  return themePalette(await resolveTheme(id))
}

// Waiting for each write prevents a slow older request overwriting the latest selection.
// A failed write must not stop the queue from saving a subsequent selection.
export function createThemePreferenceWriter(save: (theme: ThemeId) => Promise<unknown>) {
  let pending: Promise<unknown> = Promise.resolve()
  return (theme: ThemeId) => {
    const next = pending.then(() => save(theme))
    pending = next.catch(() => undefined)
    return next
  }
}
