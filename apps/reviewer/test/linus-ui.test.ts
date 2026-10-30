import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinusCompanion } from '../src/features/linus/LinusCompanion'
import { SettingsPage } from '../src/features/settings/SettingsPage'
import { Provider } from '../shared/domain/types'

vi.mock('../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'nord', setTheme: vi.fn(), error: '' }),
}))

vi.mock('../src/features/linus/useLinusSession', () => ({
  useLinusSession: () => ({
    session: undefined,
    loading: false,
    busy: false,
    error: '',
    act: vi.fn(),
    sendToPanel: vi.fn(),
    askAgain: vi.fn(),
    reload: vi.fn(),
  }),
}))
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }))
afterEach(() => vi.unstubAllGlobals())

describe('Linus entry and model settings', () => {
  it('keeps the companion hidden until a review is requested', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(LinusCompanion, { repository: 'review-room/example', pulls: [] }),
      ),
    )
    expect(markup).toBe('')
  })
  it('offers only a primary provider and names the fixed models', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(SettingsPage, {
          inboxUrl: '/',
          organization: { provider: Provider.codex, model: 'gpt-6.1-sol' },
          onSave: vi.fn(),
        }),
      ),
    )
    expect(markup).toContain('Primary provider')
    expect(markup).not.toContain('Companion model')
    expect(markup.match(/class="organization-settings"/g)).toHaveLength(1)
    expect(markup).toContain('Reviews run on Sol 6.1 and Opus 5.5.')
    expect(markup).toContain('Astra 6 and Fable 5.1 check panel')
    expect(markup).not.toContain('<input id=')
  })
})
