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
        createElement(LinusCompanion, {
          repository: 'review-room/example',
          pulls: [],
          available: true,
        }),
      ),
    )
    expect(markup).toBe('')
  })
  it('embeds selection controls in the chat bubble with cancellation before confirmation', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(LinusCompanion, {
          repository: 'review-room/example',
          pulls: [],
          available: true,
          preferences: { organization: { provider: Provider.codex, model: 'gpt-6.1-sol' } },
          selection: {
            active: true,
            urls: ['https://github.com/review-room/example/pull/1'],
            onChoose: vi.fn(),
            onChange: vi.fn(),
            onCancel: vi.fn(),
          },
        }),
      ),
    )
    expect(markup).toContain('linus-bubble')
    expect(markup).toContain('aria-label="Select PRs for Linus"')
    expect(markup).toContain('1 / 20 selected')
    expect(markup).toContain('Review 1 PR')
    expect(markup.indexOf('Cancel')).toBeLessThan(markup.indexOf('Review 1 PR'))
    expect(markup).not.toContain('Choose PRs</button>')
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
