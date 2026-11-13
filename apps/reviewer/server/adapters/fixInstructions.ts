import { writeFile } from 'node:fs/promises'
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from '@t3tools/contracts'
import { T3_ENGINE_TURN_INPUT_MARGIN_CHARS } from './t3Engine/limits'

/** Long plans live beside the worktree, preserving the whole seed without dirtying the tree. */
export async function fixInstructions(worktree: string, seed: string): Promise<string> {
  if (seed.length < PROVIDER_SEND_TURN_MAX_INPUT_CHARS - T3_ENGINE_TURN_INPUT_MARGIN_CHARS)
    return seed
  const path = `${worktree}.instructions.md`
  await writeFile(path, seed, { mode: 0o600 })
  return `Read the full fix instructions in ${JSON.stringify(path)} before doing anything. Read the entire file in chunks until its end. Follow its plans and finish with the JSON report it specifies.`
}
