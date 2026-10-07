import { z } from 'zod'
import type { PullRequest } from '../../shared/domain/types'
import type { GitHub } from './github'
import { NetworkError } from './network'

export interface CiFailure {
  name: string
  url?: string
  summary: string
  log: string
}

const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure', 'action_required']
const MAX_LOG_CHARS = 40_000
const MAX_ERROR_LINES_CHARS = 10_000
const MAX_SUMMARY_CHARS = 4_000
const MAX_LOG_BYTES = 64 * 1024 * 1024

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.string().nullable().optional(),
      app: z.object({ slug: z.string() }).nullable().optional(),
      output: z
        .object({
          title: z.string().nullable().optional(),
          summary: z.string().nullable().optional(),
        })
        .optional(),
    }),
  ),
})
const statusesSchema = z.object({
  statuses: z.array(
    z.object({
      context: z.string(),
      state: z.string(),
      description: z.string().nullable().optional(),
      target_url: z.string().nullable().optional(),
    }),
  ),
})

/** Failing checks on the PR head, with the failed step of each GitHub Actions log. */
export async function loadCiFailures(
  github: GitHub,
  pull: PullRequest,
  signal: AbortSignal,
): Promise<CiFailure[]> {
  const commit = `repos/${pull.owner}/${pull.repo}/commits/${pull.headSha}`
  const [runs, statuses] = await Promise.all([
    github.rest(`${commit}/check-runs?filter=latest&per_page=100`, { signal }),
    github.rest(`${commit}/status`, { signal }),
  ])
  const failures: CiFailure[] = []
  for (const run of checkRunsSchema.parse(runs).check_runs) {
    if (!FAILED_CONCLUSIONS.includes(run.conclusion ?? '')) continue
    failures.push({
      name: run.name,
      url: run.html_url ?? undefined,
      summary: clip(
        [run.output?.title, run.output?.summary].filter(Boolean).join('\n'),
        MAX_SUMMARY_CHARS,
      ),
      log:
        run.app?.slug === 'github-actions'
          ? await actionsLog(github, `repos/${pull.owner}/${pull.repo}`, run.id, signal)
          : '',
    })
  }
  for (const status of statusesSchema.parse(statuses).statuses) {
    if (!['failure', 'error'].includes(status.state)) continue
    failures.push({
      name: status.context,
      url: status.target_url ?? undefined,
      summary: clip(status.description ?? '', MAX_SUMMARY_CHARS),
      log: '',
    })
  }
  return failures
}

async function actionsLog(github: GitHub, repository: string, job: number, signal: AbortSignal) {
  try {
    const log = await github.rest(`${repository}/actions/jobs/${String(job)}/logs`, {
      raw: true,
      allowEscapeSequences: true,
      maxOutputBytes: MAX_LOG_BYTES,
      signal,
    })
    return failedStep(String(log))
  } catch (error) {
    // Expired or oversized logs still leave the check name and summary for the models.
    if (signal.aborted || error instanceof NetworkError) throw error
    return ''
  }
}

/** Keeps the step that raised the last error: its error lines, then its tail. */
export function failedStep(log: string) {
  const lines = log
    .replace(/\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[\d;]*[A-Za-z]/g, '')
    .split('\n')
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''))
  const lastError = lines.findLastIndex((line) => line.startsWith('##[error]'))
  const end = lastError === -1 ? lines.length : lastError + 1
  const start = Math.max(
    0,
    lines.slice(0, end).findLastIndex((line) => line.startsWith('##[group]Run ')),
  )
  const step = lines.slice(start, end)
  const tail = step.join('\n').slice(-MAX_LOG_CHARS)
  const errors = step
    .filter((line) => /\berror\b|##\[error\]|\bFAIL\b|✕|×/i.test(line) && !tail.includes(line))
    .join('\n')
  return [clip(errors, MAX_ERROR_LINES_CHARS), tail].filter(Boolean).join('\n…\n')
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text
}
