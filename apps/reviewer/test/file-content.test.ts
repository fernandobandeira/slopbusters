import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFileContentLoader,
  createSourceProjectLoader,
} from '../server/features/navigation/fileContent'
import { runCommand } from '../server/adapters/process'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import { DiffSide, LineKind } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/adapters/process', () => ({ runCommand: vi.fn() }))
vi.mock('../server/adapters/sourceRepository', () => ({
  LocalSourceRepository: class {
    async tree() {
      throw new Error('Local Git unavailable')
    }
    async close() {}
  },
}))
const command = vi.mocked(runCommand)
const mergeSha = 'a'.repeat(40)

function fixture() {
  const pull = fixturePull()
  pull.mergeBaseSha = mergeSha
  const file = pull.files[0]!
  const oldText = file.oldContent!
  const newText =
    file.hunks[0]!.lines.filter((line) => line.kind !== LineKind.removed)
      .map((line) => line.text)
      .join('\n') + '\n'
  return { pull, file, oldText, newText }
}
function blob(text: string) {
  return {
    __typename: 'Blob',
    byteSize: Buffer.byteLength(text),
    isBinary: false,
    isTruncated: false,
    text,
  }
}
function response(oldText: string, newText: string) {
  return JSON.stringify({ data: { repository: { old: blob(oldText), new: blob(newText) } } })
}
beforeEach(() => command.mockReset())

describe('exact-revision file context', () => {
  it('reads both immutable sides using the diff merge base and previous path for renames', async () => {
    const { pull, file, oldText, newText } = fixture()
    file.previousPath = 'old folder/original.ts'
    file.path = 'new folder/renamed.ts'
    file.status = 'renamed'
    command.mockResolvedValueOnce(response(oldText, newText))
    const value = await createFileContentLoader()(pull, file.id)
    expect(value.old).toMatchObject({ path: file.previousPath, sha: mergeSha, content: oldText })
    expect(value.new).toMatchObject({ path: file.path, sha: pull.headSha, content: newText })
    expect(value.new?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'canEditProject', kind: 'function', line: 3 }),
      ]),
    )
    const input = JSON.parse(command.mock.calls[0]![0].input!)
    expect(input.variables).toMatchObject({
      oldExpression: `${mergeSha}:${file.previousPath}`,
      newExpression: `${pull.headSha}:${file.path}`,
    })
    expect(input.variables.oldExpression).not.toContain(pull.baseSha)
    expect(command.mock.calls[0]![0].maxOutputBytes).toBe(8 * 1024 * 1024)
  })
  it('resolves legacy snapshot merge bases from saved SHAs, coalesces active requests and caches content', async () => {
    const { pull, file, oldText, newText } = fixture()
    delete pull.mergeBaseSha
    command.mockResolvedValueOnce(mergeSha + '\n')
    command.mockResolvedValueOnce(response(oldText, newText))
    const load = createFileContentLoader()
    const [first, second] = await Promise.all([load(pull, file.id), load(pull, file.id)])
    expect(first).toBe(second)
    expect(await load(pull, file.id)).toBe(first)
    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[0]![0].args).toContain(
      `repos/${pull.owner}/${pull.repo}/compare/${pull.baseSha}...${pull.headSha}`,
    )
    expect(command.mock.calls[0]![0].args).not.toContain(pull.baseBranch)
    expect(command.mock.calls[0]![0].args).not.toContain(pull.headBranch)
    const changed = { ...pull, headSha: 'b'.repeat(40) }
    command.mockResolvedValueOnce('c'.repeat(40))
    command.mockResolvedValueOnce(response(oldText, newText))
    expect((await load(changed, file.id)).new?.sha).toBe(changed.headSha)
    expect(command).toHaveBeenCalledTimes(4)
  })
  it.each(['added', 'removed'])(
    'represents the missing side of a %s file without requesting a nonexistent blob',
    async (status) => {
      const { pull, file } = fixture()
      file.status = status
      file.hunks = []
      command.mockResolvedValueOnce(response('previous\n', 'current\n'))
      const value = await createFileContentLoader()(pull, file.id)
      const variables = JSON.parse(command.mock.calls[0]![0].input!).variables
      expect(value.old === null).toBe(status === 'added')
      expect(value.new === null).toBe(status === 'removed')
      expect(variables.includeOld).toBe(status !== 'added')
      expect(variables.includeNew).toBe(status !== 'removed')
    },
  )
  it('rejects file identifiers outside the snapshot and invalid paths or moving refs before invoking GitHub', async () => {
    const { pull, file } = fixture()
    const load = createFileContentLoader()
    expect(() => load(pull, 'unrelated-file')).toThrow('not part')
    expect(() => load({ ...pull, headSha: 'main' }, file.id)).toThrow()
    file.previousPath = '../outside.ts'
    expect(() => load(pull, file.id)).toThrow('invalid file path')
    expect(command).not.toHaveBeenCalled()
  })
  it.each([
    { isBinary: true, text: null },
    { isBinary: null },
    { isTruncated: true },
    { byteSize: 512 * 1024 + 1 },
    { text: '\0binary' },
    { __typename: 'Tree' },
  ])('rejects unavailable, binary, unknown or truncated text %j', async (changes) => {
    const { pull, file, oldText, newText } = fixture()
    command.mockResolvedValueOnce(
      JSON.stringify({
        data: { repository: { old: blob(oldText), new: { ...blob(newText), ...changes } } },
      }),
    )
    await expect(createFileContentLoader()(pull, file.id)).rejects.toThrow()
  })
  it('rejects content that does not match the saved hunk line positions and retries after failure', async () => {
    const { pull, file, oldText, newText } = fixture()
    const load = createFileContentLoader()
    command.mockResolvedValueOnce(response(oldText, '// different revision\n' + newText))
    await expect(load(pull, file.id)).rejects.toThrow('patch does not match')
    command.mockResolvedValueOnce(response(oldText, newText))
    await expect(load(pull, file.id)).resolves.toMatchObject({ fileId: file.id })
    expect(command).toHaveBeenCalledTimes(2)
  })
  it('does not cache partial GitHub errors or fall back to the current branch', async () => {
    const { pull, file, oldText, newText } = fixture()
    const load = createFileContentLoader()
    command.mockResolvedValueOnce(
      JSON.stringify({
        data: { repository: { old: blob(oldText), new: blob(newText) } },
        errors: [{ message: 'not accessible' }],
      }),
    )
    await expect(load(pull, file.id)).rejects.toThrow('not accessible')
    command.mockResolvedValueOnce(response(oldText, newText))
    expect((await load(pull, file.id)).new?.sha).toBe(pull.headSha)
  })
})

describe('file context API', () => {
  it('loads the saved snapshot and persists resolved legacy merge-base metadata without changing review state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'review-file-content-'))
    const { pull, file, oldText, newText } = fixture()
    delete pull.mergeBaseSha
    const store = new ReviewerStore({ dataDirectory: directory })
    store.savePull(pull)
    store.close()
    const server = await startReviewerServer({
      dataDirectory: directory,
      staticDirectory: directory,
      port: 0,
    })
    try {
      expect((await fetch(`${server.url}/api/pulls/missing/files/${file.id}/content`)).status).toBe(
        404,
      )
      expect(
        (await fetch(`${server.url}/api/pulls/${pull.id}/files/unrelated/content`)).status,
      ).toBe(400)
      expect(command).not.toHaveBeenCalled()
      command.mockResolvedValueOnce(mergeSha)
      let finishRead!: (output: string) => void
      command.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRead = resolve
          }),
      )
      const loading = fetch(`${server.url}/api/pulls/${pull.id}/files/${file.id}/content`)
      await vi.waitFor(() => {
        expect(command).toHaveBeenCalledTimes(2)
      })
      const writer = new ReviewerStore({ dataDirectory: directory })
      writer.savePull({
        ...pull,
        groups: pull.groups.map((group) => ({
          ...group,
          title: 'Updated grouping while context loads',
        })),
      })
      writer.close()
      finishRead(response(oldText, newText))
      const result = await loading
      expect(result.status).toBe(200)
      expect(await result.json()).toMatchObject({
        fileId: file.id,
        old: { sha: mergeSha },
        new: { sha: pull.headSha },
      })
      const reopened = new ReviewerStore({ dataDirectory: directory })
      expect(reopened.getPull(pull.id)).toMatchObject({
        mergeBaseSha: mergeSha,
        headSha: pull.headSha,
        baseSha: pull.baseSha,
      })
      expect(reopened.getPull(pull.id).groups[0]?.title).toBe(
        'Updated grouping while context loads',
      )
      expect(reopened.getDraft(pull.id).exists).toBe(false)
      reopened.close()
      expect(
        (await fetch(`${server.url}/api/pulls/${pull.id}/source-tree?side=current`)).status,
      ).toBe(400)
      expect(command).toHaveBeenCalledTimes(2)
      command.mockResolvedValueOnce(
        JSON.stringify({
          truncated: false,
          tree: [{ path: 'src/helper.ts', type: 'blob', mode: '100644' }],
        }),
      )
      const tree = await fetch(`${server.url}/api/pulls/${pull.id}/source-tree?side=RIGHT`)
      expect(await tree.json()).toMatchObject({
        sha: pull.headSha,
        paths: ['src/helper.ts'],
        warnings: [expect.stringContaining('Local source cache is unavailable')],
      })
      const absent = await fetch(
        `${server.url}/api/pulls/${pull.id}/source-file?side=RIGHT&path=src%2Fmissing.ts`,
      )
      expect(absent.status).toBe(400)
      expect(command).toHaveBeenCalledTimes(3)
      command.mockResolvedValueOnce(
        JSON.stringify({ data: { repository: { file: blob('export function helper() {}\n') } } }),
      )
      const source = await fetch(
        `${server.url}/api/pulls/${pull.id}/source-file?side=RIGHT&path=src%2Fhelper.ts`,
      )
      expect(source.status).toBe(200)
      expect(await source.json()).toMatchObject({
        path: 'src/helper.ts',
        sha: pull.headSha,
        symbols: [{ name: 'helper', kind: 'function' }],
      })
    } finally {
      await server.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('exact-revision source navigation', () => {
  function sourceTree(paths: string[], truncated = false) {
    return JSON.stringify({
      truncated,
      tree: paths.map((path) => ({ path, type: 'blob', mode: '100644' })),
    })
  }
  it('uses the merge base for left-side source and excludes symlinks, submodules and directories', async () => {
    const { pull } = fixture()
    command.mockResolvedValueOnce(
      JSON.stringify({
        truncated: false,
        tree: [
          { path: 'src/helper.ts', type: 'blob', mode: '100644' },
          { path: 'scripts/run', type: 'blob', mode: '100755' },
          { path: 'linked-secret', type: 'blob', mode: '120000' },
          { path: 'submodule', type: 'commit', mode: '160000' },
          { path: 'src', type: 'tree', mode: '040000' },
        ],
      }),
    )
    const source = createSourceProjectLoader()
    expect(await source.tree(pull, DiffSide.left)).toEqual({
      sha: mergeSha,
      paths: ['scripts/run', 'src/helper.ts'],
      warnings: [],
    })
    expect(command.mock.calls[0]![0].args).toContain(
      `repos/${pull.owner}/${pull.repo}/git/trees/${mergeSha}?recursive=1`,
    )
    await expect(source.file(pull, DiffSide.left, 'linked-secret')).rejects.toThrow('regular file')
    await expect(source.file(pull, DiffSide.left, 'submodule')).rejects.toThrow('regular file')
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('reads related files outside the changed diff only after verifying their immutable tree membership', async () => {
    const { pull } = fixture()
    const source = createSourceProjectLoader()
    const text = 'export function helper() { return 42 }\n'
    command.mockResolvedValueOnce(sourceTree(['src/helper.ts']))
    command.mockResolvedValueOnce(JSON.stringify({ data: { repository: { file: blob(text) } } }))
    const [first, second] = await Promise.all([
      source.file(pull, DiffSide.right, 'src/helper.ts'),
      source.file(pull, DiffSide.right, 'src/helper.ts'),
    ])
    expect(first).toBe(second)
    expect(first).toMatchObject({
      sha: pull.headSha,
      path: 'src/helper.ts',
      content: text,
      symbols: [{ name: 'helper', kind: 'function', line: 1, endLine: 1 }],
    })
    expect(JSON.parse(command.mock.calls[1]![0].input!).variables.expression).toBe(
      `${pull.headSha}:src/helper.ts`,
    )
    expect(await source.file(pull, DiffSide.right, 'src/helper.ts')).toBe(first)
    await expect(source.file(pull, DiffSide.right, 'src/not-in-tree.ts')).rejects.toThrow(
      'regular file',
    )
    await expect(source.file(pull, DiffSide.right, '../private.ts')).rejects.toThrow(
      'invalid file path',
    )
    expect(command).toHaveBeenCalledTimes(2)
  })
  it('reports truncation and file count limits without inventing unavailable paths', async () => {
    const { pull } = fixture()
    command.mockResolvedValueOnce(
      sourceTree(
        Array.from({ length: 10001 }, (_, i) => `src/file-${String(i).padStart(5, '0')}.ts`),
        true,
      ),
    )
    const source = createSourceProjectLoader()
    const tree = await source.tree(pull, DiffSide.right)
    expect(tree.paths).toHaveLength(10000)
    expect(tree.warnings).toEqual([
      expect.stringContaining('truncated'),
      expect.stringContaining('10,000'),
    ])
    await expect(source.file(pull, DiffSide.right, 'src/file-10000.ts')).rejects.toThrow(
      'regular file',
    )
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('skips unsupported paths without making the rest of the project unavailable', async () => {
    const { pull } = fixture()
    command.mockResolvedValueOnce(
      sourceTree(['src/helper.ts', '../outside.ts', 'odd\nfilename.ts']),
    )
    const result = await createSourceProjectLoader().tree(pull, DiffSide.right)
    expect(result.paths).toEqual(['src/helper.ts'])
    expect(result.warnings).toEqual([expect.stringContaining('unsupported characters')])
  })
  it('keeps cached files separate across revisions and rejects unsupported binary contents', async () => {
    const { pull } = fixture()
    const source = createSourceProjectLoader()
    command.mockResolvedValueOnce(sourceTree(['src/helper.ts']))
    command.mockResolvedValueOnce(
      JSON.stringify({ data: { repository: { file: blob('old helper') } } }),
    )
    expect((await source.file(pull, DiffSide.right, 'src/helper.ts')).content).toBe('old helper')
    const updated = { ...pull, headSha: 'd'.repeat(40) }
    command.mockResolvedValueOnce(sourceTree(['src/helper.ts']))
    command.mockResolvedValueOnce(
      JSON.stringify({ data: { repository: { file: { ...blob('binary'), isBinary: true } } } }),
    )
    await expect(source.file(updated, DiffSide.right, 'src/helper.ts')).rejects.toThrow('binary')
    command.mockResolvedValueOnce(
      JSON.stringify({ data: { repository: { file: blob('new helper') } } }),
    )
    expect((await source.file(updated, DiffSide.right, 'src/helper.ts')).content).toBe('new helper')
    expect(command).toHaveBeenCalledTimes(5)
  })
})
