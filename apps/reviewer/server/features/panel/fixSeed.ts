import { anchorLabel } from '../../../shared/domain/anchors'
import { groundingOriginLabels, type GroundingCandidate } from '../../../shared/domain/grounding'
import type { GateItem } from '../../../shared/domain/panelGate'
import type { PullRequest } from '../../../shared/domain/types'
import type { FixWorktree } from '../../adapters/fixWorktrees'
import { pullName } from '../reviewPrompts'

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
  '- Apply only the plans below. Do not change unrelated code, the PR title or description, or other PRs in the stack.',
  '- A plan is a proposal checked against the code, not a fact. Confirm it in the code first; if it is wrong or incomplete, skip it and say why rather than improvising a different fix.',
  "- Follow the repository's instructions (AGENTS.md, CLAUDE.md and the like) and the conventions each plan names.",
  "- After the changes, run the repository's declared lint, build and the tests relevant to what you changed. Install dependencies first if this worktree needs them.",
  '- Commit the fixes that pass verification on this branch, one commit per independent fix. Never push, never open or update a pull request, and never rewrite history that was there before you.',
].join('\n')

function fixSection(
  item: GateItem,
  index: number,
  candidates: readonly GroundingCandidate[],
): string {
  const { entry, action } = item
  const sources = candidates.filter((candidate) => entry.sources.includes(candidate.key))
  const title = sources[0]?.finding.title ?? entry.id
  const lines = [`### ${String(index + 1)}. ${title}`, '', `Plan: ${item.plan ?? ''}`]
  if (entry.question && action.answer)
    lines.push('', `The author's answer to "${entry.question}": ${action.answer}`)
  lines.push('', `Why: ${entry.reason}`)
  if (entry.evidence.length) lines.push(`Evidence: ${entry.evidence.join(', ')}`)
  if (entry.origin) lines.push(`Origin: ${groundingOriginLabels[entry.origin]}`)
  lines.push('', 'What the reviewers wrote:')
  for (const { seat, finding } of sources)
    lines.push(
      '',
      `> **${finding.title}** (${seat}, ${anchorLabel(finding.anchor)})`,
      ...finding.body.split('\n').map((line) => `> ${line}`),
    )
  return lines.join('\n')
}
