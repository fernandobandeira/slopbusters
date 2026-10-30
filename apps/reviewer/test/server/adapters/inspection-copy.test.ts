import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  copyForInspection,
  INSPECTION_EXCLUDED_PATHS,
  listInspectionFiles,
} from '../../../server/adapters/inspectionCopy'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function checkoutWithAgentConfiguration() {
  const root = mkdtempSync(join(tmpdir(), 'inspection-copy-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(join(source, 'src', '.claude'), { recursive: true })
  writeFileSync(join(source, 'README.md'), 'readme\n')
  writeFileSync(join(source, 'AGENTS.md'), 'instructions\n')
  writeFileSync(join(source, 'src', 'index.ts'), 'export {}\n')
  writeFileSync(join(source, 'src', '.claude', 'notes.md'), 'nested\n')
  symlinkSync('src/index.ts', join(source, 'entry.ts'))
  for (const path of INSPECTION_EXCLUDED_PATHS) {
    if (path.endsWith('.json')) writeFileSync(join(source, path), '{}\n')
    else {
      mkdirSync(join(source, path))
      writeFileSync(join(source, path, 'config'), 'run something\n')
    }
  }
  return { source, destination: join(root, 'copy') }
}

it('copies the directory without its agent, editor and Git configuration', async () => {
  const { source, destination } = checkoutWithAgentConfiguration()

  await copyForInspection(source, destination)

  expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('readme\n')
  expect(readFileSync(join(destination, 'AGENTS.md'), 'utf8')).toBe('instructions\n')
  expect(readFileSync(join(destination, 'src', 'index.ts'), 'utf8')).toBe('export {}\n')
  expect(readlinkSync(join(destination, 'entry.ts'))).toBe('src/index.ts')
  for (const path of INSPECTION_EXCLUDED_PATHS)
    expect(existsSync(join(destination, path))).toBe(false)
  // Only the working directory's configuration is loaded, so nested files are plain data.
  expect(existsSync(join(destination, 'src', '.claude', 'notes.md'))).toBe(true)
})

it('leaves the source untouched when the copy changes', async () => {
  const { source, destination } = checkoutWithAgentConfiguration()

  await copyForInspection(source, destination)
  writeFileSync(join(destination, 'README.md'), 'changed\n')
  rmSync(join(destination, 'src'), { recursive: true })

  expect(readFileSync(join(source, 'README.md'), 'utf8')).toBe('readme\n')
  expect(existsSync(join(source, 'src', 'index.ts'))).toBe(true)
  for (const path of INSPECTION_EXCLUDED_PATHS) expect(existsSync(join(source, path))).toBe(true)
})

it('lists the files left in the copy, relative and sorted', async () => {
  const { source, destination } = checkoutWithAgentConfiguration()
  await copyForInspection(source, destination)

  const files = await listInspectionFiles(destination)

  expect(files).toEqual({
    paths: ['AGENTS.md', 'README.md', 'entry.ts', 'src/.claude/notes.md', 'src/index.ts'],
    truncated: false,
  })
})

it('keeps Git metadata on request, still scrubs agent configuration, and never lists it', async () => {
  const { source, destination } = checkoutWithAgentConfiguration()

  await copyForInspection(source, destination, undefined, { git: true })

  expect(readFileSync(join(destination, '.git', 'config'), 'utf8')).toBe('run something\n')
  for (const path of INSPECTION_EXCLUDED_PATHS.filter((path) => path !== '.git'))
    expect(existsSync(join(destination, path))).toBe(false)
  expect((await listInspectionFiles(destination)).paths).not.toContain('.git/config')
})
