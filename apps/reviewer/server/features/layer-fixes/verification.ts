import type { LayerFixSession, WorkerReport } from '../../../shared/domain/layerFix'
import type { ObservedCommand } from '../../adapters/t3Engine/threadTurns'

/** Exact commands only. A successful assertion never overrides a failed engine observation. */
export function checkProblems(
  report: WorkerReport,
  commands: readonly ObservedCommand[],
): string[] {
  const problems: string[] = []
  for (const claim of report.checks) {
    const observed = commands.filter((command) => command.input.trim() === claim.command.trim())
    if (!observed.length) problems.push(`${claim.command}: not observed`)
    else if (!observed.some((command) => command.exitCode === claim.exitCode))
      problems.push(
        `${claim.command}: claimed exit code ${String(claim.exitCode)} was not observed`,
      )
  }
  for (const command of commands) {
    if (command.exitCode === undefined) problems.push(`${command.input}: exit code not observed`)
    if (
      command.outputIndicatesFailure ||
      (command.exitCode !== undefined && command.exitCode !== 0)
    )
      problems.push(
        `${command.input}: observed failure (exit ${String(command.exitCode ?? 'unknown')})`,
      )
  }
  if (!report.checks.length) problems.push('No repository checks were reported.')
  for (const claim of report.checks) {
    if (
      !commands.some(
        (command) =>
          command.input.trim() === claim.command.trim() &&
          command.exitCode === 0 &&
          !command.outputIndicatesFailure,
      )
    )
      problems.push(`${claim.command}: no observed successful execution`)
  }
  return [...new Set(problems)]
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
  const problems: string[] = []
  for (const check of report.checks) {
    const observed = session.commands.find(
      (command) => command.input.trim() === check.command.trim(),
    )
    if (
      !observed?.input.startsWith('git rev-parse HEAD && ') ||
      observed.output?.split('\n')[0]?.trim() !== session.head
    )
      problems.push(`${check.command}: the tested HEAD was not observed at the final commit`)
  }
  return problems
}
