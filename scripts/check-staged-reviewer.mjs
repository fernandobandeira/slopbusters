import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const changed = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRD'], { encoding: 'utf8' })
if (!/^(apps\/reviewer\/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|scripts\/.*|\.githooks\/)/m.test(changed)) process.exit(0)
// Check exactly what will be committed; concurrent unstaged work remains untouched.
const directory = mkdtempSync(join(tmpdir(), 'reviewer-staged-'))
try {
  const tree = execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim()
  const archive = execFileSync('git', ['archive', tree], { maxBuffer: 128 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', directory], { input: archive })
  for (const relative of ['node_modules', 'apps/reviewer/node_modules', 'apps/desktop/node_modules']) {
    mkdirSync(join(directory, relative, '..'), { recursive: true })
    symlinkSync(join(root, relative), join(directory, relative), 'junction')
  }
  const result = spawnSync('pnpm', ['--dir', join(directory, 'apps/reviewer'), 'lint'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
