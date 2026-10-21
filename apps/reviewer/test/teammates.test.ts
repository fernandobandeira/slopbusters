import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InstalledSkills } from '../server/adapters/installedSkills'
import { TeammateStore } from '../server/adapters/teammateStore'
import { Teammates } from '../server/features/teammates/teammates'
import { Provider } from '../shared/domain/types'
import { installSkill, pngHeader, temporarySkillRoots } from './fixtures/skills'

let roots: ReturnType<typeof temporarySkillRoots>
let data: string
let teammates: Teammates
const avery = {
  name: 'Avery Quinn-Lee',
  title: 'Backend lead',
  skill: 'AveryReview',
  maxFindings: 16,
}

beforeEach(() => {
  roots = temporarySkillRoots()
  data = mkdtempSync(join(tmpdir(), 'teammates-'))
  teammates = new Teammates(new TeammateStore(data), new InstalledSkills(roots))
})
afterEach(() => {
  rmSync(roots.home, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

describe('creating teammates from installed skills', () => {
  it('saves the record under a slug of the name, with where the skill is installed', async () => {
    installSkill(roots.claude, 'AveryReview')

    const teammate = await teammates.create(avery)

    expect(teammate).toMatchObject({ id: 'avery-quinn-lee', name: 'Avery Quinn-Lee', avatars: [] })
    expect(Object.keys(teammate.locations)).toEqual(['claude'])
    expect(existsSync(join(data, 'teammates', 'avery-quinn-lee', 'teammate.json'))).toBe(true)
  })

  it('refuses a skill that is not installed, has a problem, or belongs to another teammate', async () => {
    await expect(teammates.create(avery)).rejects.toThrow(/No skill called AveryReview/)
    installSkill(roots.claude, 'Broken', { frontmatterName: 'other' })
    await expect(teammates.create({ ...avery, skill: 'Broken' })).rejects.toThrow(/cannot be used/)
    installSkill(roots.claude, 'AveryReview')
    await teammates.create(avery)

    await expect(teammates.create({ ...avery, name: 'Avery two' })).rejects.toThrow(
      /already belongs to another teammate/,
    )
    expect(
      (await teammates.installedSkills()).find((skill) => skill.name === 'AveryReview')?.takenBy,
    ).toBe('avery-quinn-lee')
  })

  it('keeps a teammate whose skill was uninstalled, showing it as installed nowhere', async () => {
    const folder = installSkill(roots.claude, 'AveryReview')
    await teammates.create(avery)
    rmSync(folder, { recursive: true })

    const [teammate] = await teammates.list()

    expect(teammate?.locations).toEqual({})
    await expect(teammates.skill('avery-quinn-lee', Provider.claude)).rejects.toThrow(
      /not installed for Claude/,
    )
  })

  it('hands a reviewer the skill text and its folder only for a provider that has it', async () => {
    installSkill(roots.codex, 'AveryReview', {
      references: { 'patterns.md': 'Prefer guard clauses.' },
    })
    await teammates.create(avery)

    const skill = await teammates.skill('avery-quinn-lee', Provider.codex)

    expect(skill.text).toContain('Review carefully.')
    expect(skill.directory).toMatch(/\.codex\/skills\/AveryReview$/)
    await expect(teammates.skill('avery-quinn-lee', Provider.claude)).rejects.toThrow(/Claude/)
  })

  it('removes the record and its faces, never the skill', async () => {
    const folder = installSkill(roots.claude, 'AveryReview')
    await teammates.create(avery)

    await teammates.remove('avery-quinn-lee')

    expect(await teammates.list()).toEqual([])
    expect(existsSync(join(folder, 'SKILL.md'))).toBe(true)
  })
})

describe('a teammate skill’s version', () => {
  it('changes when any file in the skill folder changes, and only then', async () => {
    const folder = installSkill(roots.claude, 'AveryReview', { references: { 'facts.md': 'One.' } })
    await teammates.create(avery)
    const first = (await teammates.skill('avery-quinn-lee', Provider.claude)).digest

    const again = (await teammates.skill('avery-quinn-lee', Provider.claude)).digest
    writeFileSync(join(folder, 'references', 'facts.md'), 'Two.')
    const changed = (await teammates.skill('avery-quinn-lee', Provider.claude)).digest

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(again).toBe(first)
    expect(changed).not.toBe(first)
  })
})

describe('teammate faces', () => {
  beforeEach(async () => {
    installSkill(roots.claude, 'AveryReview')
    await teammates.create(avery)
  })

  it('serves the closest face: the mood, then neutral, then the first face added', async () => {
    const happy = pngHeader(64)
    const neutral = pngHeader(128)
    await teammates.saveAvatar('avery-quinn-lee', 'happy', happy.toString('base64'))
    expect(await teammates.avatar('avery-quinn-lee', 'angry')).toEqual(happy)

    const teammate = await teammates.saveAvatar(
      'avery-quinn-lee',
      'neutral',
      neutral.toString('base64'),
    )

    expect(teammate.avatars).toEqual(['happy', 'neutral'])
    expect(await teammates.avatar('avery-quinn-lee', 'angry')).toEqual(neutral)
    expect(await teammates.avatar('avery-quinn-lee', 'happy')).toEqual(happy)
  })

  it('changes the version faces load with whenever a face changes', async () => {
    const before = (await teammates.get('avery-quinn-lee')).updatedAt
    await new Promise((resolve) => setTimeout(resolve, 5))

    const after = await teammates.saveAvatar(
      'avery-quinn-lee',
      'happy',
      pngHeader().toString('base64'),
    )

    expect(after.updatedAt).not.toBe(before)
  })

  it('accepts only bounded PNG images', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(40).fill(0)])
    await expect(
      teammates.saveAvatar('avery-quinn-lee', 'happy', jpeg.toString('base64')),
    ).rejects.toThrow(/PNG/)
    await expect(
      teammates.saveAvatar('avery-quinn-lee', 'happy', pngHeader(4096).toString('base64')),
    ).rejects.toThrow(/at most 1024 pixels/)
    expect(await teammates.avatar('avery-quinn-lee', 'happy')).toBeUndefined()
  })
})
