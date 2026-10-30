import { useEffect } from 'react'
import * as routes from '../../../shared/api'
import { matchingPaths, type CodeReference } from '../../../shared/domain/codeReferences'
import type { NavigationTarget } from '../../../shared/domain/navigation'
import type { RevisionFileContent } from '../../../shared/domain/fileContent'
import { DiffSide, type PullRequest } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'

/**
 * Open the place a reviewer named: find the one file in the PR head it means, load it, and
 * mark its lines. A request started after this one, such as a navigation, takes over.
 */
export function useReferenceSource({
  pull,
  reference,
  claim,
  isLatest,
  onOpen,
  onError,
  onSettled,
}: {
  pull: PullRequest
  reference?: CodeReference
  /** Start a request that takes over from earlier ones; returns its version. */
  claim: () => number
  isLatest: (version: number) => boolean
  onOpen: (visit: { file: RevisionFileContent; target: NavigationTarget }) => void
  onError: (error: string) => void
  onSettled: () => void
}) {
  useEffect(() => {
    if (!reference) return
    const controller = new AbortController()
    const version = claim()
    const current = () => !controller.signal.aborted && isLatest(version)
    void resolveReference(pull, reference, controller.signal)
      .then(async (path) => {
        const file = await call(
          routes.getSourceFile,
          { params: { id: pull.id }, query: { side: DiffSide.right, path } },
          { signal: controller.signal },
        )
        if (current()) onOpen({ file, target: referenceTarget(path, reference) })
      })
      .catch((failure: unknown) => {
        if (current()) onError(message(failure))
      })
      .finally(() => {
        if (current()) onSettled()
      })
    return () => {
      controller.abort()
    }
    // The callbacks are read when the source arrives, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, pull])
}

/** The named lines, whole, as a navigation destination the viewer highlights. */
function referenceTarget(path: string, reference: CodeReference): NavigationTarget {
  const line = reference.line ?? 1
  return {
    path,
    line,
    column: 1,
    endLine: reference.endLine ?? line,
    endColumn: Number.MAX_SAFE_INTEGER,
    name: '',
  }
}

/** The one file in the PR head a reference names: a PR file first, else any file in the tree. */
async function resolveReference(
  pull: PullRequest,
  reference: CodeReference,
  signal: AbortSignal,
): Promise<string> {
  const changed = matchingPaths(
    pull.files.map((file) => file.path),
    reference.path,
  )
  if (changed.length === 1 && changed[0]) return changed[0]
  const tree = await call(
    routes.getSourceTree,
    { params: { id: pull.id }, query: { side: DiffSide.right } },
    { signal },
  )
  const found = changed.length ? changed : matchingPaths(tree.paths, reference.path)
  const [only] = found
  if (found.length === 1 && only) return only
  if (!found.length) throw new Error(`No file matches ${reference.path} in this PR’s head.`)
  throw new Error(
    `${reference.path} matches ${String(found.length)} files: ${found.slice(0, 5).join(', ')}${found.length > 5 ? '…' : ''}.`,
  )
}
