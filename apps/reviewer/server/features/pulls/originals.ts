import type { ChangedFile } from '../../../shared/domain/types'
import type { SourceRepository } from '../../adapters/sourceRepository'
import { logError } from '../../errors'
import { MAX_FILE_BYTES } from '../../limits'

/** Read immutable originals from the same Git objects used by local review checkouts. */
export async function loadOriginals(
  repository: SourceRepository,
  revision: { owner: string; repo: string; sha: string },
  files: ChangedFile[],
) {
  const candidates = files.filter((file) => file.status !== 'added' && file.status !== 'removed')
  if (!candidates.length) return
  const { owner, repo, sha } = revision
  try {
    // Prepare the revision once so a failed fetch does not retry for every changed file.
    const tree = await repository.tree(owner, repo, sha)
    const paths = new Set(
      tree.tree
        .filter(
          (entry) =>
            entry.type === 'blob' &&
            ['100644', '100755'].includes(entry.mode) &&
            entry.size <= MAX_FILE_BYTES,
        )
        .map((entry) => entry.path),
    )
    for (let offset = 0; offset < candidates.length; offset += 5) {
      await Promise.all(
        candidates.slice(offset, offset + 5).map(async (file) => {
          const path = file.previousPath ?? file.path
          if (!paths.has(path)) return
          try {
            const blob = await repository.file(owner, repo, sha, path)
            if (!blob.isBinary) file.oldContent = blob.text
          } catch (error) {
            logError('Loading original source for copy detection', error)
          }
        }),
      )
    }
  } catch (error) {
    logError('Loading local revision for copy detection', error)
  }
}
