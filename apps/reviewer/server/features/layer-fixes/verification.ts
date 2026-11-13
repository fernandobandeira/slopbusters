import type { LayerFixSession, WorkerReport } from '../../../shared/domain/layerFix'
import type { ObservedCommand } from '../../adapters/t3Engine/threadTurns'

/**
 * Each claimed check is judged by its last run the engine observed, on the exact command the
 * report names: it must have run, exited 0 without indicating failure, and match the claimed exit
 * code. Other commands, such as a search that found nothing or a test run before the fix, are the
 * worker's own business and never count against it.
 */
export function checkProblems(
  report: WorkerReport,
  commands: readonly ObservedCommand[],
): string[] {
  if (!report.checks.length) return ['No repository checks were reported.']
  return report.checks.flatMap((claim) => {
    const last = lastRun(commands, claim.command)
    if (!last) return [`${claim.command}: not observed`]
    if (last.exitCode === undefined) return [`${claim.command}: exit code not observed`]
    if (last.exitCode !== 0 || last.outputIndicatesFailure)
      return [`${claim.command}: observed failure (exit ${String(last.exitCode)})`]
    if (claim.exitCode !== last.exitCode)
      return [`${claim.command}: claimed exit code ${String(claim.exitCode)}, observed 0`]
    return []
  })
}

function lastRun(commands: readonly ObservedCommand[], command: string) {
  return commands.filter((item) => item.input.trim() === command.trim()).at(-1)
}

export function reportProblems(session: LayerFixSession): string[] {
  const report = session.report
  if (!report) return ['The worker did not return a valid report.']
  const problems = checkProblems(report, session.commands)
  problems.push(...testedHeadProblems(session, report))
  const expected = session.fixes.filter((fix) => !fix.field)
  for (const fix of expected) {
    const results = report.fixes.filter((result) => result.id === fix.id)
    const result = results[0]
    if (results.length !== 1 || !result) {
      problems.push(`${fix.id}: missing or repeated report`)
      continue
    }
    if (result.status !== 'applied') problems.push(`${fix.id}: ${result.status}: ${result.note}`)
    if (result.status === 'applied' && !result.commits.length)
      problems.push(`${fix.id}: missing commit`)
    for (const commit of result.commits)
      if (!session.commits.includes(commit))
        problems.push(`${fix.id}: commit ${commit} is not in start..HEAD`)
    problems.push(...checkedProblems(session, fix.id))
  }
  for (const fix of report.fixes)
    if (!expected.some((item) => item.id === fix.id))
      problems.push(`${fix.id}: unexpected fix in report`)
  return problems
}

/** Remote movement is a stop even if another author, rather than this worker, caused it. */
export function remoteMovement(
  start: string,
  remote: string,
  tip: string,
): 'pushed' | 'moved' | undefined {
  if (remote === start) return undefined
  return remote === tip ? 'pushed' : 'moved'
}

function checkedProblems(session: LayerFixSession, id: string): string[] {
  const checked = session.results.find((item) => item.entry === id)
  return checked?.status === 'applied'
    ? []
    : [`${id}: ${checked?.status ?? 'not checked'}: ${checked?.note ?? ''}`]
}

function testedHeadProblems(session: LayerFixSession, report: WorkerReport): string[] {
  return report.checks.flatMap((check) => {
    const last = lastRun(session.commands, check.command)
    const tested = last?.input.trim().startsWith('git rev-parse HEAD && ')
      ? last.output?.split('\n')[0]?.trim()
      : undefined
    return tested === session.head
      ? []
      : [`${check.command}: the tested HEAD was not observed at the final commit`]
  })
}
