import type { GroundingCandidate } from '../../../shared/domain/grounding'
import { fixRules, fixSection } from '../../../shared/domain/panelBrief'
import type { GateItem } from '../../../shared/domain/panelGate'
import { pullName } from '../../../shared/domain/pullUrl'
import type { PullRequest } from '../../../shared/domain/types'
import type { FixWorktree } from '../../adapters/fixWorktrees'

/**
 * The first message of a fix thread: the reviewed revision it must start from, the author's
 * chosen fixes in full, and the rules for verifying and committing them. It is never clipped.
 */
export function fixSeed(input: {
  pull: PullRequest
  worktree: FixWorktree
  items: readonly GateItem[]
  candidates: readonly GroundingCandidate[]
}): string {
  const { pull, worktree, items } = input
  return [
    `You are fixing ${pullName(pull)}, "${pull.title}" (${pull.url}). A review panel raised findings, two models grounded them against the code, and the author chose the ${items.length === 1 ? 'fix' : `${String(items.length)} fixes`} below.`,
    `## Where you work\n\nThis thread runs in its own worktree, ${worktree.path}, on the new branch \`${worktree.branch}\`, created at the reviewed head \`${pull.headSha}\` (base \`${pull.baseSha}\`).\n\nBefore you change anything, run \`git rev-parse HEAD\` and \`git status --porcelain\`. HEAD must be \`${pull.headSha}\` and the tree must be clean. If either is not true, stop and report what you found without editing.`,
    `## Rules\n\n${rules}`,
    `## The fixes\n\n${items.map((item, index) => fixSection(item, index, input.candidates)).join('\n\n')}`,
    `## When you finish\n\nReport each fix as committed (with its commit), skipped (and why), or failing verification (with the output). List the verification commands you ran and their results, and anything left for the author.`,
  ].join('\n\n')
}

const rules = [
  ...fixRules,
  '- Commit the fixes that pass verification on this branch, one commit per independent fix. Never push, never open or update a pull request, and never rewrite history that was there before you.',
].join('\n')
