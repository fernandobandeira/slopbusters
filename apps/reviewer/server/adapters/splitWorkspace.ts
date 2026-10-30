import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SplitLayer, SplitLayerPlan, SplitUnit } from '../../shared/domain/split'
import { byFile, filePatch, parseUnits, type PatchUnit } from '../../shared/domain/splitUnits'
import type { PullRequest } from '../../shared/domain/types'
import { UserError } from '../errors'
import { readConflictRevision } from './conflictRevision'
import { hardenedGit } from './git'
import type { GitHub } from './github'
import type { GitIdentity } from './gitIdentity'

/** The largest PR diff a split cuts into units; bigger PRs are split in T3 Code instead. */
const MAX_SPLIT_DIFF_BYTES = 4 * 1024 * 1024

/** A layer as built: its commit on the one below, before any PR is opened for it. */
export type BuiltLayer = Omit<SplitLayer, 'pullUrl' | 'pullNumber'>

/** A cut that could not be built; the model gets the reason back. */
export class LayerBuildError extends UserError {
  constructor(
    readonly layer: number,
    message: string,
  ) {
    super(message)
    this.name = 'LayerBuildError'
  }
}

export interface SplitWorkspace {
  /** A checkout of the PR head with its history, for the models to read. */
  directory: string
  pull: PullRequest
  /** The merge base the layers build on. */
  baseSha: string
  units: SplitUnit[]
  /** The patch text that applies a unit, for the prompt. */
  patch: (id: string) => string
  /**
   * Commit each layer on the one below from the merge base, applying only its units, and check
   * that the top layer's tree is the PR head's tree.
   */
  build: (layers: readonly SplitLayerPlan[], identity: GitIdentity) => Promise<BuiltLayer[]>
  /** Push every layer's branch; a branch pushed by an earlier run moves from its known commit. */
  publish: (layers: readonly BuiltLayer[], previous: readonly BuiltLayer[]) => Promise<void>
  close: () => Promise<void>
}

interface Options {
  dataDirectory: string
  pull: PullRequest
  github: GitHub
  signal: AbortSignal
  remoteUrl?: (repository: string) => string
}

const credentials = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential']

/** A separate repository holds the PR and its base, builds the layers, and pushes them. */
export async function openSplitWorkspace(options: Options): Promise<SplitWorkspace> {
  const { signal, github } = options
  const root = join(options.dataDirectory, 'split-workspaces')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'split-'))
  const git = (args: string[], extra: { network?: 'fetch' | 'push'; indexFile?: string } = {}) =>
    hardenedGit(directory, args, { signal, ...extra })
  try {
    const revision = await readConflictRevision(github, options.pull, signal, 'the split')
    const pull = { ...options.pull, headSha: revision.headSha, baseSha: revision.baseSha }
    const remote =
      options.remoteUrl ?? ((repository: string) => `https://github.com/${repository}.git`)
    await git(['init', '--template=', '--initial-branch=split'])
    await git(['check-ref-format', `refs/heads/${pull.headBranch}`])
    await fetchCommit(git, remote(revision.headRepository), pull.headSha)
    await fetchCommit(git, remote(revision.baseRepository), pull.baseSha)
    const baseSha = (await git(['merge-base', pull.baseSha, pull.headSha])).trim()
    if (!baseSha) throw new UserError('The PR and its base share no history to split from.')
    await git(['checkout', '--quiet', '--detach', pull.headSha])
    const diff = await git(
      ['diff', '--binary', '-M', '--no-color', '--no-ext-diff', baseSha, pull.headSha],
      { indexFile: undefined },
    )
    if (Buffer.byteLength(diff) > MAX_SPLIT_DIFF_BYTES)
      throw new UserError('This PR’s diff is too large to split here. Split it in T3 Code.')
    const patches = parseUnits(diff)
    if (!patches.length) throw new UserError('This PR has no changes to split.')
    const byId = new Map(patches.map((unit) => [unit.id, unit]))
    const headRemote = remote(revision.headRepository)
    return {
      directory,
      pull,
      baseSha,
      units: patches.map(({ fileHeader: _header, body: _body, ...unit }) => unit),
      patch: (id) => {
        const unit = byId.get(id)
        return unit ? filePatch([unit]) : ''
      },
      build: (layers, identity) =>
        buildLayers({ git, directory, pull, baseSha, byId, layers, identity }),
      publish: async (layers, previous) => {
        for (const layer of layers) {
          signal.throwIfAborted()
          const known = previous.find((item) => item.branch === layer.branch)?.sha ?? ''
          await git(
            [
              ...credentials,
              'push',
              '--porcelain',
              `--force-with-lease=refs/heads/${layer.branch}:${known}`,
              headRemote,
              `${layer.sha}:refs/heads/${layer.branch}`,
            ],
            { network: 'push' },
          )
        }
      },
      close: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function buildLayers(request: {
  git: (args: string[], extra?: { indexFile?: string }) => Promise<string>
  directory: string
  pull: PullRequest
  baseSha: string
  byId: Map<string, PatchUnit>
  layers: readonly SplitLayerPlan[]
  identity: GitIdentity
}): Promise<BuiltLayer[]> {
  const { git, pull, byId, identity } = request
  const scratch = join(request.directory, '.git', 'split')
  await mkdir(scratch, { recursive: true })
  const built: BuiltLayer[] = []
  let parent = request.baseSha
  for (const [index, layer] of request.layers.entries()) {
    const number = index + 1
    const indexFile = join(scratch, `index-${String(number)}`)
    await rm(indexFile, { force: true })
    await git(['read-tree', `${parent}^{tree}`], { indexFile })
    const units = layer.units.map((id) => byId.get(id)).filter((unit) => unit !== undefined)
    for (const [fileIndex, group] of byFile(units).entries()) {
      const patchFile = join(scratch, `layer-${String(number)}-${String(fileIndex)}.patch`)
      await writeFile(patchFile, filePatch(group))
      try {
        await git(['apply', '--cached', '--recount', '--whitespace=nowarn', patchFile], {
          indexFile,
        })
      } catch (error) {
        throw new LayerBuildError(
          number,
          `Layer ${String(number)} "${layer.title}" does not apply to ${group[0]?.path ?? 'a file'} on the layer below: ${reason(error)}`,
        )
      }
    }
    const tree = (await git(['write-tree'], { indexFile })).trim()
    const sha = (
      await git([
        '-c',
        `user.name=${identity.name}`,
        '-c',
        `user.email=${identity.email}`,
        'commit-tree',
        tree,
        '-p',
        parent,
        '-m',
        `${layer.title}\n\n${layer.description}`,
      ])
    ).trim()
    const stat = await numstat(git, parent, sha)
    built.push({
      title: layer.title,
      description: layer.description,
      units: [...layer.units],
      branch: branchName(pull.headBranch, number, layer.title),
      sha,
      ...stat,
    })
    parent = sha
  }
  const top = (await git(['rev-parse', `${parent}^{tree}`])).trim()
  const head = (await git(['rev-parse', `${pull.headSha}^{tree}`])).trim()
  if (top !== head) {
    const drift = (await git(['diff', '--stat', parent, pull.headSha])).trim()
    throw new LayerBuildError(
      request.layers.length,
      `The stack does not add up to the PR. After the top layer these files still differ from the PR head:\n${drift}`,
    )
  }
  return built
}

async function numstat(
  git: (args: string[]) => Promise<string>,
  parent: string,
  sha: string,
): Promise<{ additions: number; deletions: number }> {
  let additions = 0
  let deletions = 0
  for (const line of (await git(['diff', '--numstat', parent, sha])).split('\n')) {
    const [added, deleted] = line.split('\t')
    additions += Number(added) || 0
    deletions += Number(deleted) || 0
  }
  return { additions, deletions }
}

/** `<pr-branch>-<n>-<title words>`, beside the PR's own branch rather than under it. */
export function branchName(headBranch: string, number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `${headBranch}-${String(number)}${slug ? `-${slug}` : ''}`
}

async function fetchCommit(
  git: (args: string[], extra: { network?: 'fetch' }) => Promise<string>,
  remote: string,
  sha: string,
) {
  if (!/^[a-f\d]{40,64}$/.test(sha)) throw new UserError('Invalid PR revision.')
  await git(
    [...credentials, 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', remote, sha],
    { network: 'fetch' },
  )
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 500)
}
