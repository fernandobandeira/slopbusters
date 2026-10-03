import type { PullStatus } from './pullStatus'

/** Layers are always ordered from the stack's base branch toward its top. */
export interface StackPull {
  status?: PullStatus
  number: number
  title: string
  url: string
  repository: string
  headBranch: string
  baseBranch: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
}
export interface PullStackSummary {
  id: string
  number?: number
  source: 'github' | 'derived'
  baseBranch: string
  position: number
  size: number
}
export interface PullStack extends PullStackSummary {
  items: StackPull[]
  warnings: string[]
}
export interface PullStackResult {
  summary?: PullStackSummary
  stack: PullStack | null
  warnings: string[]
}
export interface BranchPull extends StackPull {
  headRepositoryId: string | null
  baseRepositoryId: string | null
}

/** Qualified branch targets, never issue titles or series labels, establish dependencies. */
export function derivePullStack(pulls: BranchPull[], currentNumber: number): PullStackResult {
  const current = pulls.find((pull) => pull.number === currentNumber)
  if (!current) return { stack: null, warnings: [] }
  const warnings: string[] = []
  const parentOf = (pull: BranchPull, reportAmbiguity = true): BranchPull | undefined => {
    if (!pull.baseRepositoryId) return undefined
    const matches = pulls.filter(
      (candidate) =>
        candidate.number !== pull.number &&
        candidate.headRepositoryId != null &&
        candidate.headRepositoryId === pull.baseRepositoryId &&
        candidate.headBranch === pull.baseBranch,
    )
    if (matches.length > 1 && reportAmbiguity)
      warnings.push(
        `The parent of #${pull.number} is ambiguous; its branch matches multiple pull requests.`,
      )
    return matches.length === 1 ? matches[0] : undefined
  }
  const ancestors: BranchPull[] = [current]
  const seen = new Set([current.number])
  let cursor = current
  while (true) {
    const parent = parentOf(cursor)
    if (!parent) break
    if (seen.has(parent.number))
      return {
        stack: null,
        warnings: [
          'The branch dependencies contain a cycle; no stack order can be inferred safely.',
        ],
      }
    seen.add(parent.number)
    ancestors.unshift(parent)
    cursor = parent
  }
  const items = [...ancestors]
  cursor = current
  while (true) {
    const children = pulls.filter(
      (candidate) => parentOf(candidate, false)?.number === cursor.number,
    )
    if (children.length > 1) {
      warnings.push(
        `The branch above #${cursor.number} has multiple child pull requests; only the unambiguous part of the chain is shown.`,
      )
      break
    }
    const child = children[0]
    if (!child) break
    if (seen.has(child.number))
      return {
        stack: null,
        warnings: [
          'The branch dependencies contain a cycle; no stack order can be inferred safely.',
        ],
      }
    seen.add(child.number)
    items.push(child)
    cursor = child
  }
  if (items.length < 2) return { stack: null, warnings: [...new Set(warnings)] }
  const uniqueWarnings = [...new Set(warnings)]
  return {
    stack: {
      id: `derived:${current.repository.toLowerCase()}:${items.map((pull) => pull.number).join('-')}`,
      source: 'derived',
      baseBranch: items[0]!.baseBranch,
      position: items.findIndex((pull) => pull.number === currentNumber) + 1,
      size: items.length,
      items: items.map(({ headRepositoryId: _head, baseRepositoryId: _base, ...pull }) => pull),
      warnings: uniqueWarnings,
    },
    warnings: uniqueWarnings,
  }
}
export function stackSummary(stack: PullStack): PullStackSummary {
  const { items: _items, warnings: _warnings, ...summary } = stack
  return summary
}
