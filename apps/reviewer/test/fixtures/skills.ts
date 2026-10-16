import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillRoots } from '../../server/adapters/installedSkills'

/** Empty Claude and Codex skill folders in a temporary home. */
export function temporarySkillRoots(): SkillRoots & { home: string } {
  const home = mkdtempSync(join(tmpdir(), 'skills-'))
  return { home, claude: join(home, '.claude', 'skills'), codex: join(home, '.codex', 'skills') }
}

/** Install a skill folder with a SKILL.md, and optionally its references. */
export function installSkill(
  root: string,
  name: string,
  options: {
    frontmatterName?: string
    description?: string
    references?: Record<string, string>
  } = {},
): string {
  const folder = join(root, name)
  mkdirSync(join(folder, 'references'), { recursive: true })
  writeFileSync(
    join(folder, 'SKILL.md'),
    `---\nname: ${options.frontmatterName ?? name}\ndescription: ${options.description ?? `Review the way ${name} does.`}\n---\n\n# ${name}\n\nReview carefully.\n`,
  )
  for (const [file, text] of Object.entries(options.references ?? {}))
    writeFileSync(join(folder, 'references', file), text)
  return folder
}

/** The smallest valid PNG header for a square image of `size` pixels, enough for validation. */
export function pngHeader(size = 64): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(size, 16)
  bytes.writeUInt32BE(size, 20)
  return bytes
}
