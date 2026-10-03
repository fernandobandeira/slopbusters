import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provider, type PullRequest } from '../shared/types'
import { loadDraft } from '../src/drafts'
import { OrganizationEmptyState } from '../src/OrganizationEmptyState'
import { ReviewWorkspace } from '../src/ReviewWorkspace'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/useReviewDraft', () => ({
  useReviewDraft: (pull: PullRequest) => ({
    draft: loadDraft(pull),
    ready: true,
    setDraft: vi.fn(),
    flush: vi.fn(),
  }),
}))
vi.mock('../src/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'github-dark', resolvedTheme: 'dark' }),
}))
vi.mock('../src/vendor/t3/components/diffs/StyledDiffCodeView', () => ({
  StyledDiffCodeView: () => createElement('div', null, 'Rendered diffs'),
}))

function renderWorkspace(pull: PullRequest) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/repos/review-room/example/pulls/128'] },
      createElement(ReviewWorkspace, {
        pull,
        onUpdate: vi.fn(),
        onReload: vi.fn(),
        reloading: false,
        inboxUrl: '/',
      }),
    ),
  )
}

describe('organization before review', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { pathname: '/', search: '' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])(
    'shows one organization prompt with no review UI (empty groups: %s)',
    (empty) => {
      const pull = fixturePull()
      if (empty) pull.groups = []

      const markup = renderWorkspace(pull)

      expect(markup.match(/id="organization-title"/g)).toHaveLength(1)
      expect(markup).toContain('Organize changes into groups')
      expect(markup).toContain('value="claude"')
      expect(markup).toContain('value="codex"')
      expect(markup).toContain('Organize changes</button>')
      expect(markup).toContain('Back to inbox')
      expect(markup).not.toContain('Review navigation')
      expect(markup).not.toContain('Code changes')
      expect(markup).not.toContain('Rendered diffs')
      expect(markup).not.toContain('Submit review')
      expect(markup).not.toContain('diff sections viewed')
      for (const file of pull.files) expect(markup).not.toContain(file.path)
    },
  )

  it.each([Provider.claude, Provider.codex])(
    'opens the review workspace after %s organization',
    (provider) => {
      const markup = renderWorkspace({ ...fixturePull(), groupingSource: provider })

      expect(markup).toContain('Review navigation')
      expect(markup).toContain('Enforce project edit permissions')
      expect(markup).toContain('Rendered diffs')
      expect(markup).toContain('Submit review')
      expect(markup).not.toContain('organization-title')
    },
  )

  it('keeps the organization prompt visible with progress and cancellation while working', () => {
    const markup = renderToStaticMarkup(
      createElement(OrganizationEmptyState, {
        provider: Provider.claude,
        organizing: true,
        onProviderChange: vi.fn(),
        onOrganize: vi.fn(),
        onCancel: vi.fn(),
      }),
    )

    expect(markup).toContain('<fieldset class="organization-providers" disabled="">')
    expect(markup).toContain('Organizing…')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Cancel')
  })
})
