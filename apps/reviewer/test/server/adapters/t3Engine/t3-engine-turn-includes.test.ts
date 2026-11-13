import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { z } from 'zod'
import { Provider } from '../../../../shared/domain/types'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { fakeEngine } from './fixtures/fakeEngine'

const filesSchema = z.object({ files: z.array(z.string()) })

/** A review checkout with agent configuration and Git metadata that copies must leave out. */
const checkout = mkdtempSync(join(tmpdir(), 'turns-checkout-'))
mkdirSync(join(checkout, '.claude'))
mkdirSync(join(checkout, '.git'))
writeFileSync(join(checkout, 'README.md'), 'readme\n')
afterAll(() => {
  rmSync(checkout, { recursive: true, force: true })
})

function request(
  overrides: Partial<StructuredTurnRequest<z.infer<typeof filesSchema>>> = {},
): StructuredTurnRequest<z.infer<typeof filesSchema>> {
  return {
    model: { provider: Provider.claude, model: 'claude-haiku-5-5' },
    prompt: 'List the top-level files.',
    schema: filesSchema,
    signal: new AbortController().signal,
    directory: checkout,
    purpose: 'files',
    ...overrides,
  }
}

it('copies included folders, such as a skill, into the copy, scrubbed, and never outside it', async () => {
  const skill = mkdtempSync(join(tmpdir(), 'turns-skill-'))
  mkdirSync(join(skill, '.claude'))
  writeFileSync(join(skill, 'patterns.md'), 'patterns\n')
  const paths = ['README.md', 'skill/patterns.md', 'skill/.claude']
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    copied = paths.filter((path) => existsSync(join(fake.workspaceRoots()[0] ?? '', path)))
    thread.reply(command, '{"files":[]}')
  })
  await fake.turns.run(request({ include: [{ directory: skill, as: 'skill' }] }))
  const escape = fake.turns.run(request({ include: [{ directory: skill, as: '../escape' }] }))

  await expect(escape).rejects.toThrow(/must stay inside the working directory/)
  expect(copied).toEqual(['README.md', 'skill/patterns.md'])
  rmSync(skill, { recursive: true, force: true })
})

it('never follows a symlink in the PR to put an included folder outside the copy', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'turns-symlink-'))
  const outside = mkdtempSync(join(tmpdir(), 'turns-outside-'))
  const skill = mkdtempSync(join(tmpdir(), 'turns-skill-'))
  writeFileSync(join(repository, 'README.md'), 'readme\n')
  symlinkSync(outside, join(repository, '.slopbusters'))
  writeFileSync(join(skill, 'patterns.md'), 'patterns\n')
  let copied = false
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    copied = existsSync(join(fake.workspaceRoots()[0] ?? '', '.slopbusters/skill/patterns.md'))
    thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(
    request({ directory: repository, include: [{ directory: skill, as: '.slopbusters/skill' }] }),
  )

  expect(copied).toBe(true)
  expect(readdirSync(outside)).toEqual([])
  for (const path of [repository, outside, skill]) rmSync(path, { recursive: true, force: true })
})

it('copies included folders into the scratch directory when there is no repository, a checkout inside another', async () => {
  const layers = mkdtempSync(join(tmpdir(), 'turns-layers-'))
  writeFileSync(join(layers, '131.json'), '{}\n')
  const paths = ['stack/131.json', 'stack/top/README.md', 'stack/top/.claude', 'stack/top/.git']
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    copied = paths.filter((path) => existsSync(join(fake.workspaceRoots()[0] ?? '', path)))
    thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(
    request({
      directory: undefined,
      include: [
        { directory: layers, as: 'stack' },
        { directory: checkout, as: 'stack/top' },
      ],
    }),
  )

  expect(copied).toEqual(['stack/131.json', 'stack/top/README.md'])
  rmSync(layers, { recursive: true, force: true })
})
