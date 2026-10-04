import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinusCompanion } from '../src/LinusCompanion'
import { SettingsPage } from '../src/SettingsPage'
import { Provider } from '../shared/types'

vi.mock('../src/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'nord', setTheme: vi.fn(), error: '' }),
}))

vi.mock('../src/useLinusSession', () => ({
  useLinusSession: () => ({
    session: undefined,
    loading: false,
    busy: false,
    error: '',
    act: vi.fn(),
    reload: vi.fn(),
  }),
}))
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }))
afterEach(() => vi.unstubAllGlobals())

describe('Linus entry and model settings', () => {
  it('renders the invitation before any saved session exists', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(LinusCompanion, {
          repository: 'review-room/example',
          pulls: [],
          available: true,
        }),
      ),
    )
    expect(markup).toContain('Want me to look over your PRs?')
    expect(markup).toContain('Choose PRs')
    expect(markup).toContain('/linus/neutral.png')
    expect(markup).toContain('Close Linus')
  })
  it('keeps the invitation off other inboxes until a session exists', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(LinusCompanion, {
          repository: 'review-room/example',
          pulls: [],
          available: false,
        }),
      ),
    )
    expect(markup).toBe('')
  })
  it('offers only the shared primary setting and one companion setting', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(SettingsPage, {
          inboxUrl: '/',
          organization: { provider: Provider.codex, model: 'gpt-6.1-sol' },
          onSave: vi.fn(),
          onSaveCompanion: vi.fn(),
        }),
      ),
    )
    expect(markup).toContain('Primary model')
    expect(markup).toContain('Companion model')
    expect(markup).toContain('claude-opus-5-5')
    expect(markup.match(/class="organization-settings"/g)).toHaveLength(2)
    expect(markup).not.toContain('Reconciliation model')
  })
})
