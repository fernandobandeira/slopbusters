import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { StackLayer } from '../../../shared/domain/stackReview'
import type { PullStackResult } from '../../../shared/domain/stacks'
import { UserError } from '../../errors'
import { validateStack } from '../gandalf/gandalfPlan'
import { MAX_STACK_REVIEW_LAYERS } from './limits'

export type ResolvedLayer = Pick<StackLayer, 'url' | 'number' | 'title'>

/**
 * The open layers of the stack a PR belongs to, bottom to top, freshly read from GitHub. A stack
 * that is incomplete, ambiguous or not one branch chain is refused, as Gandalf refuses it.
 */
export function createStackResolver(
  getStack: (url: string, refresh: boolean) => Promise<PullStackResult>,
) {
  return async (url: string, signal: AbortSignal): Promise<ResolvedLayer[]> => {
    const { number } = parsePullUrl(url)
    const result = await getStack(url, true)
    signal.throwIfAborted()
    if (result.incomplete || result.summary)
      throw new UserError(
        `The stack of PR #${String(number)} could not be loaded safely. ${result.warnings.join(' ')} Refresh it and retry.`.replace(
          /\s+/g,
          ' ',
        ),
      )
    if (!result.stack)
      throw new UserError(
        `PR #${String(number)} is not part of a stack. Ask the panel to review it on its own.`,
      )
    validateStack(result.stack, url)
    const open = result.stack.items.filter((layer) => layer.state === 'open')
    if (!open.length) throw new UserError('No layer of this stack is open.')
    if (open.length > MAX_STACK_REVIEW_LAYERS)
      throw new UserError(
        `The stack has ${String(open.length)} open layers; a stack review covers at most ${String(MAX_STACK_REVIEW_LAYERS)}.`,
      )
    return open.map((layer) => {
      const pull = parsePullUrl(layer.url)
      return {
        url: `https://github.com/${pull.owner}/${pull.repo}/pull/${String(pull.number)}`,
        number: layer.number,
        title: layer.title,
      }
    })
  }
}
