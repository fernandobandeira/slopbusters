import { z } from 'zod'
import { workerReportSchema, type LayerFixSession } from '../../../shared/domain/layerFix'
import { fixRules } from '../../../shared/domain/panelBrief'

/** Full selected plans, including metadata explicitly left for the author. Never clipped. */
export function workerSeed(session: LayerFixSession, head: string): string {
  return [
    `Apply the selected plans in this app-owned worktree. Starting reviewed head: ${session.start}. Current HEAD must be ${head}. Run git rev-parse HEAD and git status --porcelain before editing; stop if HEAD differs or the tree is dirty.`,
    ...fixRules,
    'Install dependencies first if needed. Run the repository declared type-check, lint on changed files, and relevant tests. Make one commit per independent fix. Never push, open a PR, change a remote, or rewrite existing history. Metadata fixes (field title or description) are left for the author; do not apply them.',
    `Selected fixes, with full plans:\n${JSON.stringify(session.fixes, null, 2)}`,
    `After committing, rerun each check on the committed HEAD, prefixed in the same command by git rev-parse HEAD && so the app observes which commit was tested.
End with JSON matching this schema. Report exact command inputs and exit codes, and full commit SHAs. Do not claim checks you did not run:\n${JSON.stringify(z.toJSONSchema(workerReportSchema))}`,
  ].join('\n\n')
}
