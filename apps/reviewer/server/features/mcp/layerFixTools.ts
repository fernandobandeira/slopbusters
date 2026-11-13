import type { LayerFixSession } from '../../../shared/domain/layerFix'
import { UserError } from '../../errors'
import type { LayerFixJobs } from '../layer-fixes/layerFixJobs'
import type { StackReviewJobs } from '../stack-review/stackReviewJobs'
import { PANEL_POLL_MS } from './limits'
import { pause, target } from './panelTools'

export class LayerFixTools {
  constructor(
    private readonly jobs: Pick<LayerFixJobs, 'start' | 'latest'>,
    private readonly stacks: Pick<StackReviewJobs, 'latest'>,
  ) {}
  apply(pullRequest: string): string {
    const { url, repository } = target(pullRequest)
    const running = this.jobs.latest(url)
    if (running?.status === 'running') return report(running)
    const stack = this.stacks.latest(repository, [url])
    if (!stack) throw new UserError('Review this stack before applying fixes.')
    return report(this.jobs.start(stack.id, url))
  }
  async read(pullRequest: string, seconds: number, signal: AbortSignal): Promise<string> {
    const { url } = target(pullRequest)
    const deadline = Date.now() + seconds * 1000
    for (;;) {
      const session = this.jobs.latest(url)
      if (!session)
        return 'No layer fix worker has run. Call apply_layer_fixes after reviewing the stack.'
      const remaining = deadline - Date.now()
      if (session.status !== 'running' || signal.aborted || remaining <= 0) return report(session)
      await pause(Math.min(PANEL_POLL_MS, remaining), signal)
    }
  }
}

function report(session: LayerFixSession): string {
  return [
    'The worker commits locally in an app-owned worktree and pushes nothing.',
    `${session.outcome ?? session.status}: ${session.progress}`,
    session.error ?? '',
    session.worktree
      ? `Worktree: ${session.worktree.path}\nBranch: ${session.worktree.branch}`
      : '',
    ...session.commits.map((sha) => `Commit: ${sha}`),
    ...session.results.map((item) => `${item.entry}: ${item.status}: ${item.note}`),
    ...session.commands.map(
      (item) =>
        `${item.input}: observed exit ${String(item.exitCode ?? 'unknown')}${item.outputIndicatesFailure ? ' (failure)' : ''}`,
    ),
    ...session.left.map((item) => `Left for the author: ${item}`),
    session.thread ? `Thread: ${session.thread.threadId} (open it in Slopbusters).` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
