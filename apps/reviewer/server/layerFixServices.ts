import { fixInstructions } from './adapters/fixInstructions'
import { join } from 'node:path'
import type { LayerFixStore } from './adapters/layerFixStore'
import type { StackReviewJobs } from './features/stack-review/stackReviewJobs'
import type { savedModels } from './features/models'
import type { createEngines } from './adapters/t3Engine/engines'
import type { createPullService } from './features/pulls/github'
import type { StructuredTurns } from './adapters/t3Engine/engineTurns'
import type { localSnapshotLoader } from './features/panel/localRound'
import type { PullRequest } from '../shared/domain/types'
import type { ReviewCheckout } from './adapters/reviewWorkspaces'
import { parsePullUrl } from '../shared/domain/pullUrl'
import { UserError } from './errors'
import { prepareFixWorktree } from './adapters/fixWorktrees'
import { fixHead, fixCommits, readFixHead, preventFixPush } from './adapters/fixVerification'
import { LayerFixJobs } from './features/layer-fixes/layerFixJobs'
import { createLayerFixChecker } from './features/layer-fixes/checkFixes'

export function createLayerFixJobs({
  store,
  stackReviewJobs,
  models,
  engines,
  options,
  pulls,
  turns,
  loadLocal,
  openRepository,
}: {
  store: LayerFixStore
  stackReviewJobs: StackReviewJobs
  models: () => ReturnType<typeof savedModels>
  engines: ReturnType<typeof createEngines>
  options: { dataDirectory: string; sourceRemoteUrl?: (owner: string, repo: string) => string }
  pulls: ReturnType<typeof createPullService>
  turns: StructuredTurns
  loadLocal: ReturnType<typeof localSnapshotLoader>
  openRepository: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
}) {
  return new LayerFixJobs({
    store,
    stack: (id) => stackReviewJobs.get(id),
    models,
    workspace: (repository) => engines.hosts.workerWorkspace(repository),
    turns: engines.threadTurns ?? {
      run: () => {
        throw new UserError('The bundled engine is unavailable.')
      },
    },
    prepare: (checkout, url, sha, run) =>
      prepareFixWorktree(checkout, parsePullUrl(url), sha, {
        root: join(options.dataDirectory, 'layer-fix-worktrees'),
        remoteUrl: options.sourceRemoteUrl,
        run,
      }),
    instructions: fixInstructions,
    preventPush: preventFixPush,
    head: fixHead,
    tip: readFixHead,
    commits: fixCommits,
    revision: (url) => pulls.fetchPullRevision(parsePullUrl(url)),
    check: createLayerFixChecker({ turns, loadLocal, openRepository }),
  })
}
