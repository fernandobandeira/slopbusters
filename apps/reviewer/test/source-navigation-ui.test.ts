// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceContextDialog } from '../src/features/source-navigation/SourceContextDialog'
import { SourceNavigationResults } from '../src/features/source-navigation/SourceNavigationResults'
import { SymbolContextMenu } from '../src/features/source-navigation/SymbolContextMenu'
import { DiffSide } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'github-dark', resolvedTheme: 'dark' }),
}))
vi.mock('../src/vendor/t3/components/diffs/StyledDiffCodeView', () => ({
  StyledDiffCodeView: () => createElement('div', null, 'Source viewer'),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const target = (path: string, line: number) => ({
  path,
  line,
  column: 4,
  endLine: line,
  endColumn: 11,
  name: 'Account',
})
const revision = {
  path: 'src/accounts.ts',
  sha: 'saved',
  content: 'interface Account {}',
  symbols: [],
}
const request = {
  side: DiffSide.right,
  path: revision.path,
  line: 1,
  column: 11,
  kind: 'references' as const,
}

const fileId = fixturePull().files.at(0)?.id
if (!fileId) throw new Error('Missing fixture file')

describe('source navigation requests', () => {
  it('shows a reference search immediately, even before source content is available, then displays grouped results', async () => {
    let complete!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    const pull = fixturePull()
    const props = {
      pull,
      fileId: fileId,
      initialRequest: request,
      onRetry: vi.fn(),
      onClose: vi.fn(),
    }
    const view = render(createElement(SourceContextDialog, props))

    expect(screen.getByRole('status').textContent).toContain('Finding references…')
    view.rerender(
      createElement(SourceContextDialog, {
        ...props,
        content: { fileId: props.fileId, old: null, new: revision },
      }),
    )
    complete(
      Response.json({
        language: 'typescript',
        mode: 'semantic',
        targets: [target('src/a.ts', 1), target('src/a.ts', 22), target('src/b.ts', 10)],
        warnings: [],
      }),
    )

    await screen.findByRole('complementary', { name: 'References' })
    expect(screen.queryByText('Finding references…')).toBeNull()
    expect(screen.getByText('3 matches in 2 files')).toBeTruthy()
    expect(screen.getByRole('button', { name: '22:4 Account' })).toBeTruthy()
  })

  it('opens a single definition directly without a results panel', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          language: 'typescript',
          mode: 'semantic',
          targets: [target('src/definition.ts', 8)],
          warnings: [],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...revision, path: 'src/definition.ts' }))
    vi.stubGlobal('fetch', fetch)
    const pull = fixturePull()
    render(
      createElement(SourceContextDialog, {
        pull,
        fileId: fileId,
        initialRequest: { ...request, kind: 'definition' },
        onRetry: vi.fn(),
        onClose: vi.fn(),
      }),
    )

    await screen.findByRole('heading', { name: 'src/definition.ts' })
    await waitFor(() => {
      expect(screen.queryByText('Opening source…')).toBeNull()
    })
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('source navigation results', () => {
  it('opens another match in the current file without fetching that file again', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        language: 'typescript',
        mode: 'semantic',
        warnings: [],
        targets: [target(revision.path, 1), target(revision.path, 2)],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(SourceContextDialog, {
        pull: fixturePull(),
        fileId,
        initialRequest: request,
        content: { fileId, old: null, new: revision },
        onRetry: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    const result = await screen.findByRole('button', { name: '2:4 Account' })
    fireEvent.click(result)
    await waitFor(() => {
      expect(result.getAttribute('aria-current')).toBe('location')
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('groups files, filters by path or line, highlights selection and opens the requested occurrence', () => {
    const onOpen = vi.fn()
    const chosen = target('src/other/accounts.ts', 22)
    render(
      createElement(SourceNavigationResults, {
        navigation: {
          kind: 'references',
          language: 'typescript',
          mode: 'semantic',
          warnings: [],
          targets: [target('src/accounts.ts', 1), chosen, target('src/other/accounts.ts', 24)],
        },
        selected: chosen,
        busy: false,
        onOpen,
      }),
    )

    expect(screen.getAllByText('accounts.ts')).toHaveLength(2)
    const selected = screen.getByRole('button', { name: '22:4 Account' })
    expect(selected.getAttribute('aria-current')).toBe('location')
    fireEvent.click(selected)
    expect(onOpen).toHaveBeenCalledWith(chosen)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } })
    expect(screen.getByText('2 matches in 1 file')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '22' } })
    expect(screen.getByText('1 match in 1 file')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.getByText('No matching results.')).toBeTruthy()
  })
})

describe('symbol menu eligibility', () => {
  it.each([true, false, null])(
    'keeps definition and reference actions usable while checking implementation eligibility (%s)',
    async (implementation) => {
      let complete!: (value: Response) => void
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              complete = resolve
            }),
        ),
      )
      render(
        createElement(SymbolContextMenu, {
          selection: { text: 'Account', line: 1, column: 11, x: 10, y: 10 },
          source: { pullId: 'pull', side: DiffSide.right, path: revision.path },
          onNavigate: vi.fn(),
          onClose: vi.fn(),
        }),
      )

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByRole('menuitem', { name: 'Go to definition' })).toBeTruthy()
      expect(within(menu).getByRole('menuitem', { name: 'Show references' })).toBeTruthy()
      expect(within(menu).getByRole('status').textContent).toContain('Checking symbol actions…')
      complete(Response.json({ implementation }))

      await waitFor(() => {
        expect(within(menu).queryByRole('status')).toBeNull()
      })
      expect(Boolean(within(menu).queryByRole('menuitem', { name: 'Show implementations' }))).toBe(
        implementation !== false,
      )
    },
  )
})
