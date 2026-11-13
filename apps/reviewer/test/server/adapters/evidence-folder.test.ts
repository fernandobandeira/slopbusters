import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { writeEvidenceFolder } from '../../../server/adapters/evidenceFolder'

it('writes each file by its name and removes the folder', async () => {
  const folder = await writeEvidenceFolder([
    { name: '131.json', text: '{"title":"Layer 131"}' },
    { name: '140.json', text: '{"title":"Layer 140"}' },
  ])

  expect(readdirSync(folder.directory).sort()).toEqual(['131.json', '140.json'])
  expect(readFileSync(join(folder.directory, '140.json'), 'utf8')).toBe('{"title":"Layer 140"}')
  await folder.remove()
  expect(existsSync(folder.directory)).toBe(false)
})

it('refuses a name that would leave the folder', async () => {
  await expect(writeEvidenceFolder([{ name: '../escape.json', text: '{}' }])).rejects.toThrow(
    /plain name/,
  )
})
