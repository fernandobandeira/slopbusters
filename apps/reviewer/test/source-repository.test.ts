import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as processTools from '../server/adapters/process'
import { LocalSourceRepository } from '../server/adapters/sourceRepository'
import { createSourceProjectLoader } from '../server/features/navigation/fileContent'
import { createSourceNavigator } from '../server/features/navigation/navigation'
import { DiffSide } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'review-source-git-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const origin = join(directory, 'origin')
  await mkdir(origin)
  const git = async (...args: string[]) =>
    (
      await processTools.runCommand({
        command: 'git',
        cwd: origin,
        args: ['-c', 'user.name=Source Test', '-c', 'user.email=source@example.test', ...args],
      })
    ).trim()
  await git('init', '--template=', '--initial-branch=main')
  await mkdir(join(origin, 'src'))
  await writeFile(join(origin, 'src/use.ts'), "import { run } from './service'\nrun()\n")
  await writeFile(join(origin, 'src/service.ts'), 'export function run() { return 1 }\n')
  await writeFile(join(origin, 'src/odd\t"name.ts'), 'export const odd = 1\n')
  await writeFile(join(origin, 'binary.ts'), Buffer.from([0, 1, 2]))
  await writeFile(join(origin, 'large.ts'), 'x'.repeat(512 * 1024 + 1))
  await symlink('src/service.ts', join(origin, 'link.ts'))
  await git('add', '.')
  await git('commit', '-m', 'First revision')
  const base = await git('rev-parse', 'HEAD')
  await writeFile(join(origin, 'src/service.ts'), 'export function run() { return 2 }\n')
  await git('commit', '-am', 'Second revision')
  const head = await git('rev-parse', 'HEAD')
  const data = join(directory, 'data')
  const open = () => {
    const repository = new LocalSourceRepository(data, () => pathToFileURL(origin).href)
    cleanup.push(() => repository.close())
    return repository
  }
  const pull = { ...fixturePull(), headSha: head, baseSha: base, mergeBaseSha: base }
  return { origin, git, open, pull, base, head }
}

describe('persistent local source repositories', () => {
  it('coalesces downloads, serializes head/base fetches and reads the immutable side selected by navigation', async () => {
    const { open, pull, base, head } = await fixture()
    const commands = vi.spyOn(processTools, 'runCommand')
    const repository = open()
    const loader = createSourceProjectLoader(repository)
    const [right, sameRight, left] = await Promise.all([
      loader.file(pull, DiffSide.right, 'src/service.ts'),
      loader.file(pull, DiffSide.right, 'src/service.ts'),
      loader.file(pull, DiffSide.left, 'src/service.ts'),
    ])
    expect(right).toBe(sameRight)
    expect(right).toMatchObject({ sha: head, content: 'export function run() { return 2 }\n' })
    expect(left).toMatchObject({ sha: base, content: 'export function run() { return 1 }\n' })
    const fetches = commands.mock.calls.filter(([command]) => command.args.includes('fetch'))
    expect(fetches).toHaveLength(2)
    expect(fetches.map(([command]) => command.args.at(-1))).toEqual(
      expect.arrayContaining([`${head}:refs/review/${head}`, `${base}:refs/review/${base}`]),
    )
    expect(commands.mock.calls.every(([command]) => command.command === 'git')).toBe(true)
    const navigation = createSourceNavigator(loader)
    expect(
      await navigation(pull, {
        path: 'src/use.ts',
        side: DiffSide.right,
        line: 2,
        column: 1,
        kind: 'definition',
      }),
    ).toMatchObject({ mode: 'semantic', targets: [{ path: 'src/service.ts', name: 'run' }] })
  })

  it('reopens downloaded revisions after restart with the remote unavailable and fetches a new revision once', async () => {
    const { open, pull, head, origin, git } = await fixture()
    const first = open()
    await first.tree(pull.owner, pull.repo, head)
    await writeFile(join(origin, 'src/service.ts'), 'export function run() { return 3 }\n')
    await git('commit', '-am', 'Third revision')
    const next = await git('rev-parse', 'HEAD')
    await first.tree(pull.owner, pull.repo, next)
    await first.close()
    await rm(origin, { recursive: true, force: true })
    const commands = vi.spyOn(processTools, 'runCommand')
    const restarted = open()
    const loader = createSourceProjectLoader(restarted)
    expect((await loader.file(pull, DiffSide.right, 'src/service.ts')).content).toContain(
      'return 2',
    )
    expect(
      (await loader.file({ ...pull, headSha: next }, DiffSide.right, 'src/service.ts')).content,
    ).toContain('return 3')
    expect(commands.mock.calls.some(([command]) => command.args.includes('fetch'))).toBe(false)
  })

  it('does not expose symlinks, oversized or binary files, and preserves literal Git filenames', async () => {
    const { open, pull } = await fixture()
    const repository = open()
    const loader = createSourceProjectLoader(repository)
    const tree = await loader.tree(pull, DiffSide.right)
    expect(tree.paths).not.toContain('link.ts')
    expect((await loader.file(pull, DiffSide.right, 'src/odd\t"name.ts')).content).toContain(
      'const odd',
    )
    await expect(loader.file(pull, DiffSide.right, 'link.ts')).rejects.toThrow('regular file')
    await expect(loader.file(pull, DiffSide.right, 'large.ts')).rejects.toThrow('512 KiB')
    await expect(loader.file(pull, DiffSide.right, 'binary.ts')).rejects.toThrow('binary')
    await expect(loader.file(pull, DiffSide.right, '../outside.ts')).rejects.toThrow(
      'invalid file path',
    )
    expect(() => repository.tree('../outside', pull.repo, pull.headSha)).toThrow()
    expect(() => repository.tree(pull.owner, pull.repo, '--all')).toThrow()
  })

  it('keeps repositories separate even when commit identities are identical', async () => {
    const { open, pull } = await fixture()
    const commands = vi.spyOn(processTools, 'runCommand')
    const repository = open()
    await Promise.all([
      repository.tree(pull.owner, pull.repo, pull.headSha),
      repository.tree('another-owner', pull.repo, pull.headSha),
    ])
    const fetches = commands.mock.calls.filter(([command]) => command.args.includes('fetch'))
    expect(fetches).toHaveLength(2)
    expect(
      new Set(fetches.map(([command]) => command.args[command.args.indexOf('--git-dir') + 1])).size,
    ).toBe(2)
  })

  it('retries failed downloads and rejects new work after shutdown', async () => {
    const { open, pull } = await fixture()
    const original = processTools.runCommand
    const commands = vi.spyOn(processTools, 'runCommand')
    commands.mockImplementation((params) =>
      params.args.includes('fetch') ? Promise.reject(new Error('Offline')) : original(params),
    )
    const repository = open()
    await expect(repository.tree(pull.owner, pull.repo, pull.headSha)).rejects.toThrow('Offline')
    commands.mockRestore()
    expect(
      (await repository.tree(pull.owner, pull.repo, pull.headSha)).tree.length,
    ).toBeGreaterThan(0)
    await repository.close()
    expect(() => repository.tree(pull.owner, pull.repo, pull.headSha)).toThrow('shutting down')
  })
})
