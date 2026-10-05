import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { navigateTypeScript } from '../server/features/navigation/semanticNavigation'

function position(source: string, word: string, line: number) {
  return { line, column: source.split('\n')[line - 1]!.indexOf(word) + 1 }
}

describe('virtual TypeScript symbol navigation', () => {
  it('finds interface method implementations across files without including unrelated names', () => {
    const contract = 'export interface Runner { run(): number }'
    const files = new Map([
      ['src/contract.ts', contract],
      [
        'src/runner.ts',
        "import { Runner } from './contract'\nexport class Task implements Runner { run() { return 1 } }",
      ],
      ['src/unrelated.ts', 'export class Other { run() { return 2 } }'],
    ])
    expect(
      navigateTypeScript(files, {
        path: 'src/contract.ts',
        kind: 'implementation',
        ...position(contract, 'run', 1),
      }),
    ).toMatchObject([{ path: 'src/runner.ts', line: 2, name: 'run' }])
  })
  it('follows imported aliases through re-exports to the original implementation', () => {
    const main = "import { exported as selected } from './index'\nselected()\n"
    const files = new Map([
      ['src/main.ts', main],
      ['src/index.ts', "export { implementation as exported } from './implementation'\n"],
      ['src/implementation.ts', 'export function implementation() { return 42 }\n'],
    ])
    expect(
      navigateTypeScript(files, {
        path: 'src/main.ts',
        kind: 'definition',
        ...position(main, 'selected', 2),
      }),
    ).toEqual([
      {
        path: 'src/implementation.ts',
        name: 'implementation',
        line: 1,
        column: 17,
        endLine: 1,
        endColumn: 31,
      },
    ])
  })
  it('resolves configured aliases and JSX component definitions inside the virtual project', () => {
    const main = "import { Panel } from '@ui/Panel'\nexport const App = () => <Panel />\n"
    const files = new Map([
      ['app/main.tsx', main],
      ['app/ui/Panel.tsx', 'export const Panel = () => <section />\n'],
    ])
    expect(
      navigateTypeScript(
        files,
        { path: 'app/main.tsx', kind: 'definition', ...position(main, 'Panel', 2) },
        { baseUrl: '/review', paths: { '@ui/*': ['app/ui/*'] }, jsx: ts.JsxEmit.Preserve },
      ),
    ).toMatchObject([{ path: 'app/ui/Panel.tsx', name: 'Panel', line: 1, column: 14 }])
  })
  it('returns actual cross-file symbol references while excluding shadowed names, comments and strings', () => {
    const main = [
      "import { send as deliver } from './send'",
      'deliver()',
      "const message = 'deliver send'",
      '// deliver() send()',
      'function local(deliver: () => void) { deliver() }',
    ].join('\n')
    const files = new Map([
      ['src/main.ts', main],
      ['src/send.ts', 'export function send() {}\nsend()\n'],
      ['src/unrelated.ts', 'export function send() {}\nsend()\n'],
    ])
    const refs = navigateTypeScript(files, {
      path: 'src/main.ts',
      kind: 'references',
      ...position(main, 'deliver', 2),
    })
    expect(refs.map(({ path, line, name }) => ({ path, line, name }))).toEqual([
      { path: 'src/main.ts', line: 1, name: 'send' },
      { path: 'src/main.ts', line: 1, name: 'deliver' },
      { path: 'src/main.ts', line: 2, name: 'deliver' },
      { path: 'src/send.ts', line: 1, name: 'send' },
      { path: 'src/send.ts', line: 2, name: 'send' },
    ])
  })
  it('supports JavaScript module definitions and one-based UTF16 locations across CRLF lines', () => {
    const main = "import { helper } from './helper.js'\r\nconst emoji = '😀'; helper()\r\n"
    const files = new Map([
      ['src/main.js', main],
      ['src/helper.js', '// source\r\nexport function helper() {}\r\n'],
    ])
    expect(
      navigateTypeScript(files, {
        path: 'src/main.js',
        kind: 'definition',
        ...position(main, 'helper', 2),
      }),
    ).toEqual([
      { path: 'src/helper.js', name: 'helper', line: 2, column: 17, endLine: 2, endColumn: 23 },
    ])
  })
  it('never consults host filesystem libraries or loads repository plugins and rejects paths outside the virtual root', () => {
    const read = vi.spyOn(ts.sys, 'readFile').mockImplementation(() => {
      throw new Error('Host filesystem touched')
    })
    const exists = vi.spyOn(ts.sys, 'fileExists').mockImplementation(() => {
      throw new Error('Host filesystem touched')
    })
    try {
      const main = "import fs from 'node:fs'\nconst value = 1\nvalue\n"
      const files = new Map([['main.ts', main]])
      expect(
        navigateTypeScript(
          files,
          { path: 'main.ts', kind: 'definition', line: 3, column: 1 },
          { plugins: [{ name: 'malicious-plugin' }], types: ['node'], baseUrl: '/tmp' },
        ),
      ).toMatchObject([{ path: 'main.ts', name: 'value', line: 2 }])
      expect(
        navigateTypeScript(files, {
          path: '../outside.ts',
          kind: 'definition',
          line: 1,
          column: 1,
        }),
      ).toEqual([])
      expect(read).not.toHaveBeenCalled()
      expect(exists).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      exists.mockRestore()
    }
  })
  it('does not invent a definition for unavailable modules or invalid caret positions', () => {
    const main = "import { missing } from './not-loaded'\nmissing()\n"
    const files = new Map([['main.ts', main]])
    expect(
      navigateTypeScript(files, { path: 'main.ts', kind: 'definition', line: 2, column: 1 }),
    ).toEqual([])
    expect(
      navigateTypeScript(files, { path: 'main.ts', kind: 'definition', line: 500, column: 1 }),
    ).toEqual([])
    expect(
      navigateTypeScript(files, { path: 'main.ts', kind: 'definition', line: 2, column: 200 }),
    ).toEqual([])
  })
})
