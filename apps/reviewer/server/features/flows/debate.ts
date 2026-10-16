/** What one turn of a debate did to the shared state, and whether its author is satisfied. */
export interface DebateMove {
  changed: boolean
  approved: boolean
}

/** Decides from each move whether the participants have agreed. */
export interface Consensus<Role> {
  record: (role: Role, move: DebateMove) => boolean
}

/** Agreement once every role has approved with nothing changed since; any change starts over. */
export function unanimousApproval<Role>(roles: readonly Role[]): Consensus<Role> {
  const approvals = new Set<Role>()
  const needed = new Set(roles).size
  return {
    record(role, move) {
      if (move.changed) approvals.clear()
      if (move.approved) approvals.add(role)
      else approvals.delete(role)
      return approvals.size === needed
    },
  }
}

/**
 * A debate: participants take turns in order on shared state until `consensus` says they agree.
 * Each turn persists what it needs before it returns. Resolves with the number of turns taken,
 * and rejects with `stalled()` when `maxTurns` pass without agreement.
 */
export async function debate<Role>(options: {
  roles: readonly Role[]
  maxTurns: number
  signal: AbortSignal
  consensus: Consensus<Role>
  turn: (role: Role, index: number) => Promise<DebateMove>
  stalled: () => Error
}): Promise<number> {
  const { roles, signal, consensus } = options
  for (let index = 0; index < options.maxTurns; index++) {
    signal.throwIfAborted()
    const role = roles[index % roles.length]
    if (role === undefined) break
    const move = await options.turn(role, index)
    if (consensus.record(role, move)) return index + 1
  }
  throw options.stalled()
}
