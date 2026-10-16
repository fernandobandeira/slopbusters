import type { BuiltInReviewer } from '../../../shared/domain/panel'
import { loadReviewSkill } from '../../adapters/reviewSkill'
import { loadBobSkill } from '../bob/bobReview'

export const rulesSkillFiles = ['SKILL.md', 'references/checklist.md']

/** The instructions of a reviewer Slopbusters ships: bundled in the app, or read from the repo in development. */
export function loadBuiltInSkill(
  reviewer: BuiltInReviewer,
  options: { staticDirectory: string; bobSkillDirectory?: string; rulesSkillDirectory?: string },
): Promise<string> {
  if (reviewer === 'unclebob')
    return loadBobSkill(options.staticDirectory, options.bobSkillDirectory)
  return loadReviewSkill({
    staticDirectory: options.staticDirectory,
    skillDirectory: options.rulesSkillDirectory,
    filename: 'rules-skill.md',
    files: rulesSkillFiles,
  })
}
