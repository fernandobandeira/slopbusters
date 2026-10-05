import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LanguageServers, defaultLanguageServers } from '../server/adapters/languageServers'
import { LanguageServerNavigation } from '../server/adapters/lspNavigation'
import { DiffSide } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

// Optional real-server checks. Set this to a directory containing bin/gopls,
// rust-analyzer and python/node_modules/.bin/pyright-langserver, with toolchains on PATH.
const tools = process.env.SLOPBUSTERS_LSP_TEST_TOOLS
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
})

describe.skipIf(!tools)('real installed language servers', () => {
  it.each([
    {
      language: 'go',
      command: join(tools ?? '', 'bin/gopls'),
      path: 'use.go',
      source:
        'package review\nimport picked "example.test/review/selected"\nfunc use() { picked.Run() }',
      word: 'Run',
      line: 3,
      files: {
        'go.mod': 'module example.test/review\ngo 1.24\n',
        'selected/service.go': 'package selected\nfunc Run() int { return 1 }\n',
        'unrelated/service.go': 'package unrelated\nfunc Run() int { return 2 }\n',
      },
      target: 'selected/service.go',
    },
    {
      language: 'python',
      command: join(tools ?? '', 'python/node_modules/.bin/pyright-langserver'),
      path: 'use.py',
      source: 'from selected import run as chosen\nchosen()\n',
      word: 'chosen',
      line: 2,
      files: {
        'selected.py': 'def run():\n    return 1\n',
        'unrelated.py': 'def run():\n    return 2\n',
      },
      target: 'selected.py',
    },
    {
      language: 'rust',
      command: join(tools ?? '', 'rust-analyzer'),
      path: 'src/lib.rs',
      source: 'mod selected;\nmod unrelated;\npub fn use_it() { selected::run(); }\n',
      word: 'run',
      line: 3,
      files: {
        'Cargo.toml': '[package]\nname="review"\nversion="0.1.0"\nedition="2021"\n',
        'src/selected.rs': 'pub fn run() -> i32 { 1 }\n',
        'src/unrelated.rs': 'pub fn run() -> i32 { 2 }\n',
      },
      target: 'src/selected.rs',
    },
    {
      language: 'cpp',
      command: '/usr/bin/clangd',
      path: 'use.cpp',
      source: '#include "service.h"\nint use() { return run(); }\n',
      word: 'run',
      line: 2,
      files: {
        'service.h': 'inline int run() { return 1; }\n',
        'unrelated.cpp': 'static int run() { return 2; }\n',
      },
      target: 'service.h',
    },
  ])(
    'resolves $language imports to the actual declaration, excluding unrelated names',
    async ({ language, command, path, source, word, line, files, target }) => {
      const dataDirectory = await mkdtemp(join(tmpdir(), 'slopbusters-real-lsp-'))
      cleanup.push(() => rm(dataDirectory, { recursive: true, force: true }))
      const servers = new LanguageServers(dataDirectory)
      const configuration = defaultLanguageServers().find((server) => server.language === language)!
      await servers.save([{ ...configuration, command }])
      const contents = new Map<string, string>(
        Object.entries({ ...files, [path]: source }) as [string, string][],
      )
      const loader = {
        tree: async () => ({ sha: 'saved-revision', paths: [...contents.keys()], warnings: [] }),
        file: async (_pull: unknown, _side: unknown, path: string) => ({
          path,
          sha: 'saved-revision',
          content: contents.get(path)!,
          symbols: [],
        }),
      }
      const navigation = new LanguageServerNavigation(loader, servers)
      cleanup.push(() => navigation.close())
      const result = await navigation.navigate(fixturePull(), {
        side: DiffSide.right,
        path,
        line,
        column: source.split('\n')[line - 1]!.indexOf(word) + 1,
        kind: 'definition',
      })
      expect(result, JSON.stringify(result)).toMatchObject({ mode: 'semantic' })
      expect(
        result?.targets.map((location) => location.path),
        JSON.stringify(result),
      ).toEqual([target])
      const references = await navigation.navigate(fixturePull(), {
        side: DiffSide.right,
        path,
        line,
        column: source.split('\n')[line - 1]!.indexOf(word) + 1,
        kind: 'references',
      })
      expect(references, JSON.stringify(references)).toMatchObject({ mode: 'semantic' })
      expect(
        references?.targets.some((location) => location.path === path),
        JSON.stringify(references),
      ).toBe(true)
      expect(references?.targets.some((location) => location.path.includes('unrelated'))).toBe(
        false,
      )
    },
    60_000,
  )
})
