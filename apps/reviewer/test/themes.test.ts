import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@pierre/diffs'
import { createThemePreferenceWriter, DEFAULT_THEME, getTheme, isThemeId, themePalette, themes, type ThemeId } from '../src/themes'

describe('reviewer themes', () => {
  it('loads each selectable palette locally with the same ID and scheme as the diff renderer', async () => {
    for (const descriptor of themes) {
      const theme = await resolveTheme(descriptor.id)
      expect(theme.name).toBe(descriptor.id)
      expect(theme.type).toBe(descriptor.type)
      const palette = themePalette(theme)
      expect(palette['--background']).toBe(theme.bg)
      expect(palette['--code-background']).toBe(theme.bg)
      expect(palette['--foreground']).toBe(theme.fg)
      expect(palette['--code-foreground']).toBe(theme.fg)
      expect(Object.values(palette).every((color) => typeof color === 'string' && color.length > 0)).toBe(true)
    }
  })

  it('validates stored IDs and includes requested theme families with light variants', () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true)
    for (const value of ['unsupported', undefined, null, 1, '__proto__'])
      expect(isThemeId(value)).toBe(false)
    for (const id of ['nord', 'tokyo-night', 'catppuccin-mocha', 'solarized-dark', 'one-dark-pro'])
      expect(isThemeId(id)).toBe(true)
    expect(getTheme('catppuccin-latte').type).toBe('light')
    expect(getTheme('solarized-light').type).toBe('light')
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length)
  })
})

describe('theme preference writes', () => {
  it('serializes rapid changes so the latest choice is persisted last', async () => {
    const saved: ThemeId[] = []
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const write = createThemePreferenceWriter(async (theme) => {
      if (theme === 'nord') await pending
      saved.push(theme)
    })

    const first = write('nord')
    const second = write('tokyo-night')
    const third = write('solarized-light')
    await Promise.resolve()
    expect(saved).toEqual([])
    release!()
    await Promise.all([first, second, third])
    expect(saved).toEqual(['nord', 'tokyo-night', 'solarized-light'])
  })

  it('reports failed writes and continues saving subsequent choices', async () => {
    const saved: ThemeId[] = []
    const write = createThemePreferenceWriter(async (theme) => {
      if (theme === 'nord') throw new Error('Storage unavailable')
      saved.push(theme)
    })

    const failed = write('nord')
    const recovered = write('github-light')
    await expect(failed).rejects.toThrow('Storage unavailable')
    await recovered
    expect(saved).toEqual(['github-light'])
  })
})
