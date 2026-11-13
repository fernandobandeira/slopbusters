import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixInstructions } from '../../../server/adapters/fixInstructions'

it('preserves long plans outside the worktree without clipping them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worker-instructions-'))
  try {
    const path = join(directory, 'worktree')
    const seed = `Full plan ${'x'.repeat(200_000)} end of plan`
    expect(await fixInstructions(path, seed)).toContain(`${path}.instructions.md`)
    expect(await readFile(`${path}.instructions.md`, 'utf8')).toBe(seed)
    expect(await fixInstructions(path, 'Short plan')).toBe('Short plan')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
