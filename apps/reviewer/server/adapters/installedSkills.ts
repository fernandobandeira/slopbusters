import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { skillNameSchema, type InstalledSkill } from '../../shared/domain/teammates'
import { Provider } from '../../shared/domain/types'
import { logError, UserError } from '../errors'

/** The largest `SKILL.md` a teammate may have; bigger skills belong in its `references/`. */
const MAX_SKILL_FILE_BYTES = 256 * 1024
/** How much of a skill folder its version digest reads, and how many of its files it counts. */
const MAX_SKILL_DIGEST_BYTES = 32 * 1024 * 1024
const MAX_SKILL_DIGEST_FILES = 2000

/** Where each agent looks for the user's own skills. */
export interface SkillRoots {
  claude: string
  codex: string
}

export function defaultSkillRoots(home = homedir()): SkillRoots {
  return { claude: join(home, '.claude', 'skills'), codex: join(home, '.codex', 'skills') }
}

/** Folders the scan skips: Claude keeps skills synced from claude.ai under `synced/`. */
const SKIPPED_FOLDERS = new Set(['synced'])

interface ScannedSkill {
  name: string
  description: string
  directory: string
  problem?: string
}

/**
 * The Agent Skills installed for Claude Code and Codex. Nothing here writes to those folders or
 * runs anything in them; a skill is read only to show it and to hand its text to a reviewer.
 */
export class InstalledSkills {
  constructor(private readonly roots: SkillRoots) {}

  async list(): Promise<InstalledSkill[]> {
    const [claude, codex] = await Promise.all([
      scanRoot(this.roots.claude),
      scanRoot(this.roots.codex),
    ])
    const names = [...new Set([...claude.keys(), ...codex.keys()])].sort((a, b) =>
      a.localeCompare(b),
    )
    return names.map((name) => merge(name, claude.get(name), codex.get(name)))
  }

  /** The skill's folder, resolved through symlinks, for an agent to read its references. */
  async directory(name: string, provider: Provider): Promise<string> {
    const folder = join(this.root(provider), skillNameSchema.parse(name))
    try {
      const resolved = await realpath(folder)
      if (!(await stat(resolved)).isDirectory()) throw new Error('Not a directory.')
      return resolved
    } catch {
      throw new UserError(
        `The ${name} skill is not installed for ${providerName(provider)}. Install it in ${folder} and try again.`,
      )
    }
  }

  async text(name: string, provider: Provider): Promise<string> {
    return readSkillFile(await this.directory(name, provider))
  }

  /**
   * A digest of everything in the skill's folder, so a saved review records which version of the
   * skill wrote it. Past the size bounds, files count by path and size only.
   */
  async digest(name: string, provider: Provider): Promise<string> {
    const directory = await this.directory(name, provider)
    const hash = createHash('sha256')
    let budget = MAX_SKILL_DIGEST_BYTES
    for (const path of await skillFiles(directory)) {
      const { size } = await stat(path)
      hash.update(`${relative(directory, path)}\0${String(size)}\0`)
      if (size <= budget) hash.update(await readFile(path))
      budget = Math.max(0, budget - size)
    }
    return `sha256:${hash.digest('hex')}`
  }

  private root(provider: Provider) {
    return provider === Provider.claude ? this.roots.claude : this.roots.codex
  }
}

/** The skill folder's files in a stable order, leaving out hidden entries and symlinks. */
async function skillFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (path) =>
        !relative(directory, path)
          .split('/')
          .some((part) => part.startsWith('.')),
    )
    .sort()
    .slice(0, MAX_SKILL_DIGEST_FILES)
}

async function scanRoot(root: string): Promise<Map<string, ScannedSkill>> {
  const skills = new Map<string, ScannedSkill>()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logError(`Could not read the skills in ${root}`, error)
    return skills
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIPPED_FOLDERS.has(entry)) continue
    if (!skillNameSchema.safeParse(entry).success) continue
    const skill = await scanSkill(join(root, entry), entry)
    if (skill) skills.set(entry, skill)
  }
  return skills
}

/** A folder with a readable `SKILL.md`, or undefined for anything else in the skills folder. */
async function scanSkill(directory: string, folder: string): Promise<ScannedSkill | undefined> {
  let text: string
  try {
    if (!(await stat(directory)).isDirectory()) return undefined
    text = await readSkillFile(directory)
  } catch {
    return undefined
  }
  const frontmatter = parseFrontmatter(text)
  const problem = !frontmatter.name
    ? 'Its SKILL.md has no name in its frontmatter.'
    : frontmatter.name !== folder
      ? `Its SKILL.md is named ${frontmatter.name}, but the folder is ${folder}; agents invoke it by one name, so they must match.`
      : undefined
  return {
    name: folder,
    description: frontmatter.description ?? '',
    directory,
    ...(problem ? { problem } : {}),
  }
}

async function readSkillFile(directory: string): Promise<string> {
  const path = join(directory, 'SKILL.md')
  if ((await stat(path)).size > MAX_SKILL_FILE_BYTES)
    throw new UserError(
      `${path} is larger than the ${String(MAX_SKILL_FILE_BYTES / 1024)} KB limit.`,
    )
  return readFile(path, 'utf8')
}

function merge(name: string, claude?: ScannedSkill, codex?: ScannedSkill): InstalledSkill {
  const problem = claude?.problem ?? codex?.problem
  return {
    name,
    description: claude?.description || codex?.description || '',
    locations: {
      ...(claude ? { claude: claude.directory } : {}),
      ...(codex ? { codex: codex.directory } : {}),
    },
    ...(problem ? { problem } : {}),
  }
}

/**
 * The `name` and `description` of a skill's YAML frontmatter. Skills keep both on one line or as a
 * folded block, so this reads plain, quoted and `>`/`|` scalars and ignores everything else.
 */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(withoutByteOrderMark(text))
  if (!match?.[1]) return {}
  const lines = match[1].split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let index = 0; index < lines.length; index++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[index] ?? '')
    if (!field?.[1]) continue
    const value = field[2]?.trim() ?? ''
    if (!BLOCK_SCALARS.has(value)) {
      fields[field[1]] = unquote(value)
      continue
    }
    const block = indentedLines(lines, index + 1)
    index += block.length
    fields[field[1]] = block.join(value.startsWith('>') ? ' ' : '\n')
  }
  return { name: fields.name, description: fields.description }
}

function withoutByteOrderMark(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

const BLOCK_SCALARS = new Set(['>', '|', '>-', '|-'])

/** The indented lines of a block scalar starting at `start`, trimmed. */
function indentedLines(lines: string[], start: number): string[] {
  const block: string[] = []
  for (let index = start; /^\s+\S/.test(lines[index] ?? ''); index++)
    block.push((lines[index] ?? '').trim())
  return block
}

function unquote(value: string) {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

function providerName(provider: Provider) {
  return provider === Provider.claude ? 'Claude' : 'Codex'
}
