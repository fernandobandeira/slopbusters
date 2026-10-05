import {
  MAX_DIFF_FILE_CACHE_ENTRIES,
  MAX_SOURCE_TREE_CACHE_ENTRIES,
  MAX_SOURCE_FILE_CACHE_ENTRIES,
  MAX_GITHUB_TREE_OUTPUT_BYTES,
  MAX_GITHUB_GRAPHQL_OUTPUT_BYTES,
  MAX_GITHUB_BLOB_OUTPUT_BYTES,
} from '../../limits'
import { z } from 'zod'
import { DiffSide, type ChangedFile, type PullRequest } from '../../../shared/domain/types'
import type {
  PullFileContent,
  RevisionFileContent,
  SourceTree,
} from '../../../shared/domain/fileContent'
import { createGitHub, type GitHub } from '../../adapters/github'
import { createMergeBaseLookup } from '../pulls/mergeBase'
import { createCache } from '../../cache'
import { UserError, logError } from '../../errors'
import { MAX_FILE_BYTES, MAX_FILE_CACHE_BYTES, MAX_SOURCE_CACHE_BYTES } from '../../limits'
import { getRevisionSymbols } from '../../adapters/treeSymbols'
import type { SourceRepository } from '../../adapters/sourceRepository'

const commitSha = z.string().regex(/^[a-f\d]{40}(?:[a-f\d]{24})?$/i)
const repositoryName = z
  .string()
  .max(100)
  .regex(/^[\w.-]+$/)
  .refine((value) => value !== '.' && value !== '..')
const blobSchema = z.object({
  __typename: z.literal('Blob'),
  byteSize: z.number().int().nonnegative(),
  isBinary: z.boolean().nullable(),
  isTruncated: z.boolean(),
  text: z.string().nullable(),
})

function filePath(path: string): string {
  if (
    !path ||
    path.length > 2000 ||
    /[\0\r\n]/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new UserError('The snapshot contains an invalid file path.')
  return path
}

async function readBlob(value: unknown, path: string, sha: string): Promise<RevisionFileContent> {
  const result = blobSchema.safeParse(value)
  if (!result.success)
    throw new UserError(`The saved version of ${path} is no longer available as a text file.`)
  const blob = result.data
  if (blob.isBinary !== false || blob.text == null || blob.text.includes('\0'))
    throw new UserError(`Context is unavailable for binary or unsupported text files: ${path}.`)
  if (
    blob.isTruncated ||
    blob.byteSize > MAX_FILE_BYTES ||
    Buffer.byteLength(blob.text) > MAX_FILE_BYTES
  )
    throw new UserError(`Context expansion supports files up to 512 KiB: ${path}.`)
  return { path, sha, content: blob.text, symbols: await getRevisionSymbols(path, blob.text) }
}

function validatePatch(file: ChangedFile, content: PullFileContent): void {
  const oldLines = content.old?.content.split('\n')
  const newLines = content.new?.content.split('\n')
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      for (const [number, lines] of [
        [line.oldLine, oldLines],
        [line.newLine, newLines],
      ] as const) {
        if (
          number != null &&
          (!lines || lines[number - 1]?.replace(/\r$/, '') !== line.text.replace(/\r$/, ''))
        )
          throw new UserError(
            'The saved patch does not match this file revision. Reload the PR before expanding context.',
          )
      }
    }
  }
}

/** Per-server bounded cache uses immutable commit pairs, never a current branch or PR head. */
export function createFileContentLoader(
  repository?: SourceRepository,
  github: GitHub = createGitHub(),
  mergeBase = createMergeBaseLookup(github),
) {
  const cache = createCache<PullFileContent>({
    max: MAX_DIFF_FILE_CACHE_ENTRIES,
    maxBytes: MAX_FILE_CACHE_BYTES,
    sizeOf: (value) =>
      Buffer.byteLength(value.old?.content ?? '') + Buffer.byteLength(value.new?.content ?? ''),
  })
  async function load(pull: PullRequest, file: ChangedFile): Promise<PullFileContent> {
    const oldPath = file.status === 'added' ? null : filePath(file.previousPath ?? file.path)
    const newPath = file.status === 'removed' ? null : filePath(file.path)
    const oldSha = oldPath == null ? null : await mergeBase(pull)
    if (repository) {
      try {
        const [oldContent, newContent] = await Promise.all([
          oldPath == null
            ? null
            : repository
                .file(pull.owner, pull.repo, oldSha!, oldPath)
                .then((blob) => readBlob(blob, oldPath, oldSha!)),
          newPath == null
            ? null
            : repository
                .file(pull.owner, pull.repo, pull.headSha, newPath)
                .then((blob) => readBlob(blob, newPath, pull.headSha)),
        ])
        const value = { fileId: file.id, old: oldContent, new: newContent }
        validatePatch(file, value)
        return value
      } catch (error) {
        logError('Local file context unavailable; falling back to GitHub', error)
      }
    }
    const variables = {
      owner: pull.owner,
      name: pull.repo,
      oldExpression: oldPath == null ? '' : `${oldSha}:${oldPath}`,
      newExpression: newPath == null ? '' : `${pull.headSha}:${newPath}`,
      includeOld: oldPath != null,
      includeNew: newPath != null,
    }
    const query = `query($owner:String!,$name:String!,$oldExpression:String!,$newExpression:String!,$includeOld:Boolean!,$includeNew:Boolean!) {
      repository(owner:$owner,name:$name) {
        old:object(expression:$oldExpression) @include(if:$includeOld) { __typename ... on Blob {byteSize isBinary isTruncated text} }
        new:object(expression:$newExpression) @include(if:$includeNew) { __typename ... on Blob {byteSize isBinary isTruncated text} }
      }
    }`
    const output = await github.graphql(query, variables, false, {
      maxOutputBytes: MAX_GITHUB_TREE_OUTPUT_BYTES,
    })
    const result = z
      .object({
        data: z
          .object({
            repository: z
              .object({ old: z.unknown().optional(), new: z.unknown().optional() })
              .nullable(),
          })
          .nullable()
          .optional(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .parse(output)
    if (result.errors?.length || !result.data?.repository)
      throw new UserError('Could not read exact-revision file context from GitHub. Please retry.')
    const [oldContent, newContent] = await Promise.all([
      oldPath == null ? null : readBlob(result.data.repository.old, oldPath, oldSha!),
      newPath == null ? null : readBlob(result.data.repository.new, newPath, pull.headSha),
    ])
    const value: PullFileContent = {
      fileId: file.id,
      old: oldContent,
      new: newContent,
    }
    validatePatch(file, value)
    return value
  }

  return function fileContent(pull: PullRequest, fileId: string): Promise<PullFileContent> {
    repositoryName.parse(pull.owner)
    repositoryName.parse(pull.repo)
    commitSha.parse(pull.baseSha)
    commitSha.parse(pull.headSha)
    const file = pull.files.find((file) => file.id === fileId)
    if (!file) throw new UserError('This file is not part of the saved PR snapshot.')
    filePath(file.path)
    if (file.previousPath) filePath(file.previousPath)
    const key = JSON.stringify([
      pull.owner,
      pull.repo,
      pull.baseSha,
      pull.headSha,
      pull.mergeBaseSha,
      file.id,
      file.path,
      file.previousPath,
      file.status,
    ])
    return cache.load(key, () => load(pull, file))
  }
}

/** Source navigation is limited to regular files present in the saved revision's Git tree. */
export function createSourceProjectLoader(
  repository?: SourceRepository,
  github: GitHub = createGitHub(),
  mergeBase = createMergeBaseLookup(github),
) {
  const trees = createCache<SourceTree>({ max: MAX_SOURCE_TREE_CACHE_ENTRIES })
  const files = createCache<RevisionFileContent>({
    max: MAX_SOURCE_FILE_CACHE_ENTRIES,
    maxBytes: MAX_SOURCE_CACHE_BYTES,
    sizeOf: (file) => Buffer.byteLength(file.content),
  })
  const localTrees = new WeakSet<SourceTree>()

  function tree(pull: PullRequest, side: DiffSide): Promise<SourceTree> {
    repositoryName.parse(pull.owner)
    repositoryName.parse(pull.repo)
    commitSha.parse(pull.headSha)
    commitSha.parse(pull.baseSha)
    z.enum(DiffSide).parse(side)
    const key = JSON.stringify([
      pull.owner,
      pull.repo,
      pull.baseSha,
      pull.headSha,
      pull.mergeBaseSha,
      side,
    ])
    return trees.load(key, async () => {
      const sha = side === DiffSide.right ? pull.headSha : await mergeBase(pull)
      const warnings: string[] = []
      let raw: unknown
      let local = false
      if (repository) {
        try {
          raw = await repository.tree(pull.owner, pull.repo, sha)
          local = true
        } catch {
          warnings.push(
            'Local source cache is unavailable; navigation is loading source from GitHub.',
          )
        }
      }
      if (!local) {
        raw = await github.rest(`repos/${pull.owner}/${pull.repo}/git/trees/${sha}?recursive=1`, {
          maxOutputBytes: MAX_GITHUB_GRAPHQL_OUTPUT_BYTES,
        })
      }
      const result = z
        .object({
          truncated: z.boolean(),
          tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
        })
        .parse(raw)
      const regular = result.tree.filter(
        (item) => item.type === 'blob' && ['100644', '100755'].includes(item.mode),
      )
      const validPaths: string[] = []
      for (const item of regular) {
        try {
          validPaths.push(filePath(item.path))
        } catch {
          // Unusual Git filenames do not make every other source file unavailable.
        }
      }
      const paths = [...new Set(validPaths)].sort().slice(0, local ? undefined : 10000)
      if (result.truncated)
        warnings.push(
          'GitHub returned a truncated source tree. Some definitions may be unavailable.',
        )
      if (!local && validPaths.length > 10000)
        warnings.push(
          'Source navigation is limited to the first 10,000 regular files in this revision.',
        )
      if (validPaths.length !== regular.length)
        warnings.push(
          'Some source paths use unsupported characters and are unavailable for navigation.',
        )
      const value = { sha, paths, warnings }
      if (local) localTrees.add(value)
      return value
    })
  }

  async function file(
    pull: PullRequest,
    side: DiffSide,
    path: string,
  ): Promise<RevisionFileContent> {
    filePath(path)
    const revision = await tree(pull, side)
    if (!revision.paths.includes(path))
      throw new UserError(
        'This path is not an available regular file in the saved source revision.',
      )
    const key = JSON.stringify([pull.owner, pull.repo, revision.sha, path])
    async function readSource(): Promise<RevisionFileContent> {
      if (localTrees.has(revision))
        return readBlob(
          await repository!.file(pull.owner, pull.repo, revision.sha, path),
          path,
          revision.sha,
        )
      const query = `query($owner:String!,$name:String!,$expression:String!) {repository(owner:$owner,name:$name) {file:object(expression:$expression) {__typename ... on Blob {byteSize isBinary isTruncated text}}}}`
      const output = await github.graphql(
        query,
        { owner: pull.owner, name: pull.repo, expression: `${revision.sha}:${path}` },
        false,
        { maxOutputBytes: MAX_GITHUB_BLOB_OUTPUT_BYTES },
      )
      const result = z
        .object({
          data: z
            .object({ repository: z.object({ file: z.unknown() }).nullable() })
            .nullable()
            .optional(),
          errors: z.array(z.object({ message: z.string() })).optional(),
        })
        .parse(output)
      if (result.errors?.length || !result.data?.repository)
        throw new UserError('Could not read exact-revision source from GitHub. Please retry.')
      return readBlob(result.data.repository.file, path, revision.sha)
    }
    return files.load(key, readSource)
  }
  return { tree, file }
}
