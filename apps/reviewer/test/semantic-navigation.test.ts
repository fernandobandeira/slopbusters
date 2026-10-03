import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { navigateTypeScript } from '../server/semanticNavigation'

function position(source: string, word: string, line: number) {
  return { line, column: source.split('\n')[line - 1]!.indexOf(word) + 1 }
}

describe('virtual TypeScript symbol navigation', () => {
  it('finds interface and method implementations in files outside the import graph', () => {
    const contract = 'export interface Runner { run(): void }\n'
    const files = new Map([
      ['src/contract.ts', contract],
      [
        'src/runner.ts',
        "import { Runner } from './contract'\nexport class Worker implements Runner { run() {} }\n",
      ],
      ['src/unrelated.ts', 'export class Other { run() {} }\n'],
    ])
    expect(
      navigateTypeScript(files, {
        path: 'src/contract.ts',
        kind: 'implementation',
        ...position(contract, 'Runner', 1),
      }),
    ).toMatchObject([{ path: 'src/runner.ts', name: 'Worker', line: 2 }])
    expect(
      navigateTypeScript(files, {
        path: 'src/contract.ts',
        kind: 'implementation',
        ...position(contract, 'run', 1),
      }),
    ).toMatchObject([{ path: 'src/runner.ts', name: 'run', line: 2 }])
  })
  it('finds usages of constants and parameters without their declarations or shadowed names', () => {
    const source = [
      'const count = 1',
      'console.log(count)',
      'function local(count: number) { return count }',
      'console.log(count)',
    ].join('\n')
    const files = new Map([['src/count.ts', source]])
    const request = { path: 'src/count.ts', ...position(source, 'count', 1) }
    expect(
      navigateTypeScript(files, { ...request, kind: 'references' }).map((t) => t.line),
    ).toEqual([1, 2, 4])
    expect(navigateTypeScript(files, { ...request, kind: 'usages' }).map((t) => t.line)).toEqual([
      2, 4,
    ])
    expect(
      navigateTypeScript(files, {
        path: 'src/count.ts',
        kind: 'usages',
        ...position(source, 'count', 3),
      }),
    ).toMatchObject([{ path: 'src/count.ts', name: 'count', line: 3, column: 40 }])
  })
  it('finds imported function usages across aliases and re-exports without definitions', () => {
    const main = "import { exported as selected } from './index'\nselected()\n"
    const files = new Map([
      ['src/main.ts', main],
      ['src/index.ts', "export { implementation as exported } from './implementation'\n"],
      ['src/implementation.ts', 'export function implementation() {}\nimplementation()\n'],
      ['src/other.ts', "import { implementation } from './implementation'\nimplementation()\n"],
    ])
    const targets = navigateTypeScript(files, {
      path: 'src/main.ts',
      kind: 'usages',
      ...position(main, 'selected', 2),
    })
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/main.ts', line: 2 }),
        expect.objectContaining({ path: 'src/implementation.ts', line: 2 }),
        expect.objectContaining({ path: 'src/other.ts', line: 2 }),
      ]),
    )
    expect(targets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'src/implementation.ts', line: 1 })]),
    )
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
