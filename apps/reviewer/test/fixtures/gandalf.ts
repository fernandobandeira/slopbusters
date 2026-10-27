import type { GandalfTurn } from '../../shared/domain/gandalf'
import type { ConflictWorkspace } from '../../server/adapters/conflictWorkspace'
import type { GandalfMove } from '../../server/features/gandalf/gandalfResolution'

/** A turn that approves the resolution and changes nothing. */
export const approvalTurn: GandalfTurn = {
  summary: 'No issues found.',
  approved: true,
  issues: [],
  edits: [],
  selections: [],
}

/** A model's turn as Gandalf records it; by default an approval that changed nothing. */
export function gandalfMove(
  turn: Partial<GandalfTurn> = {},
  changes: Partial<Omit<GandalfMove, 'turn'>> = {},
): GandalfMove {
  return { turn: { ...approvalTurn, ...turn }, changedPaths: [], problems: [], ...changes }
}

/** The parts of a conflict workspace that a fake model turn never reaches. */
export const idleWorkspaceParts: Pick<ConflictWorkspace, 'merge' | 'apply' | 'absorb'> = {
  merge: { commits: { pull: [], base: [] } },
  apply: () => Promise.resolve({ changedPaths: [], problems: [] }),
  absorb: () => Promise.resolve({ changedPaths: [], problems: [] }),
}
