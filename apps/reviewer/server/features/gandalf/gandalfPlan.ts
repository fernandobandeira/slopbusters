import type { PullStack, PullStackResult } from '../../../shared/domain/stacks'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { UserError } from '../../errors'
import { MAX_GANDALF_PULLS } from '../../limits'

/** Include every open layer so updates propagate through the entire selected stack. */
export function createGandalfPlanner(
  getStack: (url: string, refresh: boolean) => Promise<PullStackResult>,
) {
  return async (selected: string[], signal: AbortSignal) => {
    const urls = new Set<string>()
    for (const url of selected) {
      signal.throwIfAborted()
      if (urls.has(url)) continue
      const result = await getStack(url, true)
      signal.throwIfAborted()
      if (result.incomplete || result.summary)
        throw new UserError('The stack could not be loaded safely. Refresh it and retry.')
      if (!result.stack) {
        urls.add(url)
        continue
      }
      validateStack(result.stack, url)
      for (const layer of result.stack.items) if (layer.state === 'open') urls.add(layer.url)
    }
    if (urls.size > MAX_GANDALF_PULLS)
      throw new UserError(
        `The selected stacks exceed ${MAX_GANDALF_PULLS} open PRs. Select fewer stacks.`,
      )
    return [...urls]
  }
}

function validateStack(stack: PullStack, url: string) {
  const selected = parsePullUrl(url)
  const repository = `${selected.owner}/${selected.repo}`.toLowerCase()
  if (
    !stack.items.some((layer) => layer.number === selected.number) ||
    stack.items.some((layer) => {
      const pull = parsePullUrl(layer.url)
      return `${pull.owner}/${pull.repo}`.toLowerCase() !== repository
    })
  )
    throw new UserError(
      'The stack dependencies are ambiguous. Refresh the stack before resolving it.',
    )
  const open = stack.items.filter((layer) => layer.state === 'open')
  if (
    open.some((layer) =>
      stack.items.some(
        (parent) => parent.state === 'closed' && parent.headBranch === layer.baseBranch,
      ),
    )
  )
    throw new UserError(
      'An open stack layer depends on a closed, unmerged PR. Repair the stack before resolving it.',
    )
  for (const [index, layer] of open.entries()) {
    const previous = open[index - 1]
    if (previous && layer.baseBranch !== previous.headBranch)
      throw new UserError(
        'The open stack layers do not form a continuous branch chain. Refresh the stack and retry.',
      )
  }
}
