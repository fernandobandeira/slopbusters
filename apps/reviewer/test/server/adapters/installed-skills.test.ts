import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InstalledSkills, parseFrontmatter } from '../../../server/adapters/installedSkills'
import { Provider } from '../../../shared/domain/types'
import { installSkill, temporarySkillRoots } from '../../fixtures/skills'

let roots = temporarySkillRoots()
afterEach(() => {
  rmSync(roots.home, { recursive: true, force: true })
  roots = temporarySkillRoots()
})

describe('installed skills', () => {
  it('lists each skill once with the agents that have it installed', async () => {
    installSkill(roots.claude, 'AveryReview', { description: 'Review as Avery.' })
    installSkill(roots.codex, 'AveryReview')
    installSkill(roots.claude, 'RileyReview')
    installSkill(roots.codex, 'MorganReview')

    const skills = await new InstalledSkills(roots).list()

    expect(skills.map((skill) => [skill.name, Object.keys(skill.locations)])).toEqual([
      ['AveryReview', ['claude', 'codex']],
      ['MorganReview', ['codex']],
      ['RileyReview', ['claude']],
    ])
    expect(skills[0]?.description).toBe('Review as Avery.')
  })

  it('skips synced claude.ai skills, hidden folders, stray files and folders without SKILL.md', async () => {
    installSkill(join(roots.claude, 'synced'), 'abc')
    installSkill(roots.claude, '.hidden')
    mkdirSync(join(roots.claude, 'empty'), { recursive: true })
    writeFileSync(join(roots.claude, 'notes.md'), 'not a skill')

    expect(await new InstalledSkills(roots).list()).toEqual([])
  })

  it('marks a skill whose frontmatter names another skill, since agents invoke it by one name', async () => {
    installSkill(roots.claude, 'AveryReview', { frontmatterName: 'avery' })

    const [skill] = await new InstalledSkills(roots).list()

    expect(skill?.problem).toMatch(/named avery, but the folder is AveryReview/)
  })

  it('follows a symlinked skill folder to read its instructions', async () => {
    const shared = installSkill(join(roots.home, 'team-skills'), 'AveryReview')
    mkdirSync(roots.codex, { recursive: true })
    symlinkSync(shared, join(roots.codex, 'AveryReview'))
    const skills = new InstalledSkills(roots)

    expect((await skills.list())[0]?.locations.codex).toBe(join(roots.codex, 'AveryReview'))
    expect(await skills.text('AveryReview', Provider.codex)).toContain('Review carefully.')
    expect(await skills.directory('AveryReview', Provider.codex)).toMatch(
      /team-skills\/AveryReview$/,
    )
  })

  it('names the folder to install a skill in when the provider does not have it', async () => {
    installSkill(roots.claude, 'AveryReview')

    await expect(new InstalledSkills(roots).text('AveryReview', Provider.codex)).rejects.toThrow(
      /not installed for Codex.*\.codex\/skills\/AveryReview/,
    )
  })
})

describe('skill frontmatter', () => {
  it('reads quoted and folded descriptions', () => {
    expect(parseFrontmatter('---\nname: "avery"\ndescription: \'Review it.\'\n---\n')).toEqual({
      name: 'avery',
      description: 'Review it.',
    })
    expect(
      parseFrontmatter(
        '---\nname: avery\ndescription: >\n  Review the way\n  Avery does.\nmetadata: x\n---',
      ),
    ).toEqual({ name: 'avery', description: 'Review the way Avery does.' })
  })

  it('reads nothing from a file without frontmatter', () => {
    expect(parseFrontmatter('# Avery\n\nname: not frontmatter')).toEqual({})
  })
})
