// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchingPaths, parseCodeReference } from '../shared/domain/codeReferences'
import { OpenCodeProvider } from '../src/components/CodeReferenceText'
import { FindingText } from '../src/components/FindingText'
import { SourceContextDialog } from '../src/features/source-navigation/SourceContextDialog'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'github-dark', resolvedTheme: 'dark' }),
}))
vi.mock('~/components/diffs/StyledDiffCodeView', () => ({
  StyledDiffCodeView: () => createElement('div', null, 'Source viewer'),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reading code references in prose', () => {
  it.each([
    ['sms-notifier.ts:340', { path: 'sms-notifier.ts', line: 340 }],
    ['senders/sms-sender.ts:106–113', { path: 'senders/sms-sender.ts', line: 106, endLine: 113 }],
    ['src/a.ts:12-14', { path: 'src/a.ts', line: 12, endLine: 14 }],
    ['src/a.ts:12:5', { path: 'src/a.ts', line: 12 }],
    ['src/a.ts#L7-L9', { path: 'src/a.ts', line: 7, endLine: 9 }],
    ['server/test/AGENTS.md', { path: 'server/test/AGENTS.md' }],
    ['./src/index.tsx:3', { path: 'src/index.tsx', line: 3 }],
  ])('reads %s', (text, expected) => {
    expect(parseCodeReference(text)).toEqual(expected)
  })

  it.each([
    'app.prisma',
    'SmsNotification.ContextCollectionRequestForCardholder',
    'user.name',
    'https://example.com/a.ts:3',
    'npm run build',
    'a.ts:20-3x',
  ])('leaves %s as text', (text) => {
    expect(parseCodeReference(text)).toBeUndefined()
  })

  it('matches a whole path, else the paths that end with it', () => {
    const paths = ['src/sms-notifier.ts', 'src/senders/sms-sender.ts', 'lib/senders/sms-sender.ts']
    expect(matchingPaths(paths, 'src/sms-notifier.ts')).toEqual(['src/sms-notifier.ts'])
    expect(matchingPaths(paths, 'sms-notifier.ts')).toEqual(['src/sms-notifier.ts'])
    expect(matchingPaths(paths, 'senders/sms-sender.ts')).toHaveLength(2)
    expect(matchingPaths(paths, 'notifier.ts')).toEqual([])
  })
})

describe('a finding that names code', () => {
  it('opens a file and line it names, and leaves other code as text', () => {
    const open = vi.fn()
    render(
      createElement(OpenCodeProvider, {
        open,
        children: createElement(FindingText, {
          children:
            '`sms-notifier.ts:340` uses `SmsNotification.Context` in the key.\n\n```ts\nconst a = 1\n```',
        }),
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'sms-notifier.ts:340' }))

    expect(open).toHaveBeenCalledWith({ path: 'sms-notifier.ts', line: 340 })
    expect(screen.queryByRole('button', { name: 'SmsNotification.Context' })).toBeNull()
    expect(screen.getByText('const a = 1')).toBeTruthy()
  })

  it('stays plain text where there is no PR to open code in', () => {
    render(createElement(FindingText, { children: 'See `sms-notifier.ts:340`.' }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('sms-notifier.ts:340').tagName).toBe('CODE')
  })
})

describe('opening a reference in the source dialog', () => {
  const revision = { sha: 'head', content: 'export const a = 1\n', symbols: [] }
  const props = {
    contents: new Map(),
    loadContent: vi.fn(() => Promise.reject(new Error('not loaded'))),
    split: false,
    onRetry: vi.fn(),
    onClose: vi.fn(),
  }

  it('finds the file in the PR head’s tree by its last segments and opens it', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('/source-tree')
          ? Response.json({
              sha: 'head',
              paths: ['server/senders/sms-sender.ts', 'README.md'],
              warnings: [],
            })
          : Response.json({ ...revision, path: 'server/senders/sms-sender.ts' }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(SourceContextDialog, {
        ...props,
        pull: fixturePull(),
        reference: { path: 'senders/sms-sender.ts', line: 106, endLine: 113 },
      }),
    )

    expect(
      await screen.findByRole('heading', { name: 'server/senders/sms-sender.ts' }),
    ).toBeTruthy()
    const sourceRequest = String(fetch.mock.calls.at(-1)?.[0])
    expect(sourceRequest).toContain('/source-file')
    expect(sourceRequest).toContain(encodeURIComponent('server/senders/sms-sender.ts'))
  })

  it('opens a PR file without reading the tree', async () => {
    const pull = fixturePull()
    const path = pull.files[0]?.path ?? ''
    const fetch = vi.fn(() => Promise.resolve(Response.json({ ...revision, path })))
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(SourceContextDialog, {
        ...props,
        pull,
        reference: { path: path.split('/').at(-1) ?? path, line: 2 },
      }),
    )

    expect(await screen.findByRole('heading', { name: path })).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('a reference that does not name one file', () => {
  const props = {
    contents: new Map(),
    loadContent: vi.fn(() => Promise.reject(new Error('not loaded'))),
    split: false,
    onRetry: vi.fn(),
    onClose: vi.fn(),
  }
  it('says when no file, or several, match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ sha: 'head', paths: ['a/x.ts', 'b/x.ts'], warnings: [] })),
      ),
    )
    const view = render(
      createElement(SourceContextDialog, {
        ...props,
        pull: fixturePull(),
        reference: { path: 'x.ts', line: 1 },
      }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'x.ts matches 2 files: a/x.ts, b/x.ts.',
    )

    view.rerender(
      createElement(SourceContextDialog, {
        ...props,
        pull: fixturePull(),
        reference: { path: 'gone.ts', line: 1 },
      }),
    )
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'No file matches gone.ts in this PR’s head.',
      )
    })
  })
})
