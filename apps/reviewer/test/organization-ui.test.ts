import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provider, type PullRequest } from '../shared/domain/types'
import { loadDraft } from '../src/features/review/drafts'
import { OrganizationEmptyState } from '../src/features/review/OrganizationEmptyState'
import { OrganizationSettings } from '../src/features/settings/OrganizationSettings'
import { organizationDefaults } from '../shared/domain/preferences'
import { ReviewWorkspace } from '../src/features/review/ReviewWorkspace'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/features/review/useReviewDraft', () => ({
  useReviewDraft: (pull: PullRequest) => ({
    draft: loadDraft(pull),
    ready: true,
    setDraft: vi.fn(),
    flush: vi.fn(),
  }),
}))
vi.mock('../src/app/ThemeProvider', () => ({
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
        organization: { provider: Provider.codex, model: organizationDefaults.codex.model },
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
    'shows a centered loader with no review UI (empty groups: %s)',
    (empty) => {
      const pull = fixturePull()
      if (empty) pull.groups = []

      const markup = renderWorkspace(pull)

      expect(markup.match(/id="organization-title"/g)).toHaveLength(1)
      expect(markup).toContain('Organizing changes…')
      expect(markup).toContain('gpt-6.1-sol')
      expect(markup).toContain('role="status"')
      expect(markup).not.toContain('name="organization-provider"')
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

  it('shows progress and cancellation with progress and cancellation while working', () => {
    const markup = renderToStaticMarkup(
      createElement(OrganizationEmptyState, {
        organization: { provider: Provider.claude, model: organizationDefaults.claude.model },
        organizing: true,
        onOrganize: vi.fn(),
        onCancel: vi.fn(),
      }),
    )

    expect(markup).not.toContain('fieldset')
    expect(markup).toContain('Organizing changes…')
    expect(markup).toContain('claude-opus-5-5')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Cancel')
  })
})

describe('organization settings', () => {
  it.each([Provider.codex, Provider.claude])(
    'suggests the requested default for %s',
    (provider) => {
      const markup = renderToStaticMarkup(
        createElement(OrganizationSettings, {
          organization: { provider, model: organizationDefaults[provider].model },
          firstRun: true,
          onSave: vi.fn(),
        }),
      )
      expect(markup).toContain(organizationDefaults[provider].model)
      expect(markup).toContain(organizationDefaults[provider].label)
      expect(markup).toContain('Get started')
    },
  )
  it('lets a failed run retry and open settings without another provider picker', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OrganizationEmptyState, {
          organizing: false,
          failed: true,
          onOrganize: vi.fn(),
        }),
      ),
    )
    expect(markup).toContain('Try again')
    expect(markup).toContain('href="/settings"')
    expect(markup).not.toContain('fieldset')
  })
})
