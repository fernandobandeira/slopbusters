import { describe, expect, it, vi } from 'vitest'
import { createSourceNavigator } from '../server/navigation'
import { getRevisionSymbols } from '../server/treeSymbols'
import { DiffSide } from '../shared/types'
import { fixturePull } from './fixtures/pull'
import type { NavigationRequest } from '../shared/navigation'

function project(contents: Record<string, string>, warnings: string[] = []) {
  const tree = vi.fn(async () => ({ sha: 'saved-head', paths: Object.keys(contents), warnings }))
  const file = vi.fn(async (_pull, _side, path: string) => ({
    path,
    sha: 'saved-head',
    content: contents[path],
    symbols: await getRevisionSymbols(path, contents[path]),
  }))
  return { tree, file }
}
const request: NavigationRequest = {
  side: DiffSide.right,
  path: 'src/use.ts',
  line: 2,
  column: 1,
  kind: 'definition',
}

describe('revision source navigation', () => {
  it('loads implementers outside the selected interface import graph at the saved revision', async () => {
    const loader = project({
      'src/use.ts': 'export interface Runner { run(): number }',
      'src/runner.ts':
        "import { Runner } from './use'\nexport class Task implements Runner { run() { return 1 } }",
      'src/unrelated.ts': 'export class Other { run() { return 2 } }',
    })
    const result = await createSourceNavigator(loader)(fixturePull(), {
      ...request,
      line: 1,
      column: 27,
      kind: 'implementation',
      side: DiffSide.left,
    })
    expect(result.mode).toBe('semantic')
    expect(result.targets).toMatchObject([{ path: 'src/runner.ts', name: 'run' }])
    expect(loader.file.mock.calls.every(([, side]) => side === DiffSide.left)).toBe(true)
  })

  it('does not substitute text references for unsupported implementation lookup', async () => {
    const loader = project({ 'src/use.py': 'def run():\n    return 1\nrun()' })
    const result = await createSourceNavigator(loader)(fixturePull(), {
      ...request,
      path: 'src/use.py',
      line: 1,
      column: 5,
      kind: 'implementation',
    })
    expect(result.targets).toEqual([])
    expect(result.warnings.join(' ')).toContain('Implementation lookup requires a language server')
  })
  it('loads imported related files at the same saved side and resolves the actual definition', async () => {
    const loader = project({
      'src/use.ts': "import { run } from './service'\nrun()",
      'src/service.ts': 'export function run() { return 1 }',
      'other.ts': 'export function run() { return 2 }',
    })
    const pull = fixturePull()
    const result = await createSourceNavigator(loader)(pull, request)
    expect(result.mode).toBe('semantic')
    expect(result.targets.map((target) => target.path)).toEqual(['src/service.ts'])
    expect(
      loader.file.mock.calls.every(
        ([candidate, side]) => candidate === pull && side === DiffSide.right,
      ),
    ).toBe(true)
    expect(loader.file.mock.calls.map((call) => call[2])).not.toContain('other.ts')
  })

  it('honors nearest saved tsconfig paths without loading external configuration', async () => {
    const loader = project({
      'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
      'src/use.ts': "import { run } from '@/service'\nrun()",
      'src/service.ts': 'export function run() { return 1 }',
    })
    const result = await createSourceNavigator(loader)(fixturePull(), request)
    expect(result.targets.map((target) => target.path)).toEqual(['src/service.ts'])
  })

  it('includes usages in files outside the import graph but excludes unrelated same-name symbols', async () => {
    const loader = project({
      'src/use.ts': "import { run } from './service'\nrun()",
      'src/service.ts': 'export function run() { return 1 }',
      'src/other.ts': "import { run } from './service'\nrun()",
      'src/unrelated.ts': 'function run() {}\nrun()',
    })
    const result = await createSourceNavigator(loader)(fixturePull(), {
      ...request,
      kind: 'references',
    })
    expect(new Set(result.targets.map((target) => target.path))).toEqual(
      new Set(['src/use.ts', 'src/service.ts', 'src/other.ts']),
    )
  })

  it('uses bundled syntax for Python matches and labels their limits', async () => {
    const loader = project({
      'src/use.py': 'from service import run\nrun()',
      'src/service.py': 'def run():\n    return 1\n# run()\ntext = "run()"',
    })
    const navigate = createSourceNavigator(loader)
    const result = await navigate(fixturePull(), {
      ...request,
      path: 'src/use.py',
      kind: 'references',
    })
    expect(result.mode).toBe('text')
    expect(
      result.targets
        .filter((target) => target.path === 'src/service.py')
        .map((target) => target.line),
    ).toEqual([1])
    expect(result.warnings.join(' ')).toContain('not semantic references')
    const definition = await navigate(fixturePull(), { ...request, path: 'src/use.py' })
    expect(definition.targets[0]).toMatchObject({ path: 'src/service.py', line: 1, name: 'run' })
  })

  it('reports bounded and truncated results, coalesces requests, and keeps revisions separate', async () => {
    const contents: Record<string, string> = { 'src/use.py': 'run()' }
    for (let index = 0; index < 130; index++) contents[`src/source${index}.py`] = 'run()'
    const loader = project(contents, ['GitHub returned a truncated source tree.'])
    const navigate = createSourceNavigator(loader)
    const selection = { ...request, path: 'src/use.py', line: 1, kind: 'references' as const }
    const pull = fixturePull()
    const first = navigate(pull, selection)
    expect(navigate(pull, selection)).toBe(first)
    const result = await first
    expect(loader.file).toHaveBeenCalledTimes(120)
    expect(result.warnings.join(' ')).toContain('truncated source tree')
    expect(result.warnings.join(' ')).toContain('more results may exist')
    await navigate({ ...pull, headSha: 'another-saved-head' }, selection)
    expect(loader.tree).toHaveBeenCalledTimes(2)
  })

  it('rejects positions outside the selected exact source file', async () => {
    const navigate = createSourceNavigator(project({ 'src/use.ts': 'run()' }))
    await expect(navigate(fixturePull(), { ...request, line: 9 })).rejects.toThrow(
      'outside this file',
    )
  })
})
