import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHub } from '../server/adapters/github'
import type { SourceRepository } from '../server/adapters/sourceRepository'
import { createPullService } from '../server/features/pulls/github'
import { MAX_FILE_BYTES } from '../server/limits'
import { TransferKind } from '../shared/domain/types'

const mergeBase = 'a'.repeat(40)
const block =
  'export function slug(value: string) {\n  return value.trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n'
const originals = new Map(
  Array.from({ length: 31 }, (_, index) => [
    `source-${index}.ts`,
    index === 30 ? block + '// padding\n'.repeat(15000) : `export const value = ${index}\n`,
  ]),
)

function fixture() {
  const metadata = {
    number: 1,
    html_url: 'https://github.com/example/project/pull/1',
    title: 'Copy helper',
    body: '',
    user: { login: 'alice' },
    state: 'open',
    updated_at: '',
    base: { ref: 'main', sha: 'b'.repeat(40) },
    head: { ref: 'feature', sha: 'c'.repeat(40) },
    labels: [],
    changed_files: 32,
  }
  const inputs = [...originals.keys()].map((path) => ({
    filename: path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: '@@ -0,0 +1 @@\n+// updated',
  }))
  const github: GitHub = {
    rest: vi.fn((path: string) =>
      Promise.resolve(path.includes('/compare/') ? mergeBase : metadata),
    ),
    paginate: vi.fn(() =>
      Promise.resolve([
        ...inputs,
        {
          filename: 'copy.ts',
          status: 'added',
          additions: 6,
          deletions: 0,
          patch:
            '@@ -0,0 +1,6 @@\n' +
            block
              .trimEnd()
              .split('\n')
              .map((line) => `+${line}`)
              .join('\n'),
        },
      ]),
    ),
    graphql: vi.fn(),
  }
  const repository: SourceRepository = {
    tree: vi.fn(() =>
      Promise.resolve({
        truncated: false as const,
        tree: [...originals].map(([path, text]) => ({
          path,
          mode: '100644',
          type: 'blob',
          oid: 'd'.repeat(40),
          size: Buffer.byteLength(text),
        })),
      }),
    ),
    file: vi.fn((_owner: string, _repo: string, _sha: string, path: string) => {
      const text = originals.get(path)
      if (text == null) throw new Error('Original source missing from fixture')
      return Promise.resolve({
        __typename: 'Blob' as const,
        byteSize: Buffer.byteLength(text),
        isBinary: false,
        isTruncated: false,
        text,
      })
    }),
  }
  return { github, repository, load: createPullService(github, undefined, repository).fetchPull }
}

afterEach(() => vi.restoreAllMocks())

describe('local copy sources while loading a pull request', () => {
  it('detects copies beyond the former file and character cutoffs without GitHub content reads', async () => {
    const { load, github, repository } = fixture()

    const pull = await load('https://github.com/example/project/pull/1')

    expect(pull.transfers).toMatchObject([
      { kind: TransferKind.copied, fromPath: 'source-30.ts', toPath: 'copy.ts', lineCount: 6 },
    ])
    expect(repository.file).toHaveBeenCalledTimes(31)
    expect(repository.file).toHaveBeenCalledWith('example', 'project', mergeBase, 'source-30.ts')
    expect(github.rest).toHaveBeenCalledTimes(3)
    expect(github.graphql).not.toHaveBeenCalled()
    expect(pull.warnings).toEqual([])
  })

  it('reads renamed source files using their original path at the merge base', async () => {
    const { load, github, repository } = fixture()
    const inputs = await github.paginate('unused')
    inputs[30] = {
      filename: 'renamed.ts',
      previous_filename: 'source-30.ts',
      status: 'renamed',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1 @@\n+// updated',
    }
    vi.mocked(github.paginate).mockResolvedValue(inputs)

    const pull = await load('https://github.com/example/project/pull/1')

    expect(repository.file).toHaveBeenCalledWith('example', 'project', mergeBase, 'source-30.ts')
    expect(pull.files.find((file) => file.path === 'renamed.ts')?.oldContent).toBe(
      originals.get('source-30.ts'),
    )
  })

  it('keeps diffs available when local source fails and logs once without a copy-limit warning', async () => {
    const { load, github, repository } = fixture()
    vi.mocked(repository.tree).mockRejectedValue(new Error('Local snapshot unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const pull = await load('https://github.com/example/project/pull/1')

    expect(pull.files).toHaveLength(32)
    expect(pull.warnings).toEqual([])
    expect(log).toHaveBeenCalledOnce()
    expect(repository.file).not.toHaveBeenCalled()
    expect(github.rest).toHaveBeenCalledTimes(3)
  })

  it('retains regular-file size checks and ignores binary originals', async () => {
    const { load, repository } = fixture()
    const tree = await repository.tree('example', 'project', mergeBase)
    tree.tree = tree.tree.map((entry, index) => ({
      ...entry,
      size: index === 0 ? MAX_FILE_BYTES + 1 : entry.size,
      mode: index === 1 ? '120000' : entry.mode,
    }))
    vi.mocked(repository.tree).mockResolvedValue(tree)
    vi.mocked(repository.file).mockResolvedValueOnce({
      __typename: 'Blob',
      byteSize: 1,
      isBinary: true,
      isTruncated: false,
      text: '\0',
    })

    const pull = await load('https://github.com/example/project/pull/1')

    expect(repository.file).toHaveBeenCalledTimes(29)
    expect(pull.files.slice(0, 3).every((file) => file.oldContent == null)).toBe(true)
    expect(pull.warnings).toEqual([])
  })
})
