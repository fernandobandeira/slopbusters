import { beforeEach, expect, it, vi } from 'vitest'
import { fixHead, preventFixPush } from '../../../server/adapters/fixVerification'
import { hardenedGit } from '../../../server/adapters/git'

vi.mock('../../../server/adapters/git', () => ({ hardenedGit: vi.fn() }))
beforeEach(() => {
  vi.mocked(hardenedGit).mockReset()
})

it('blocks the clone origin push URL without changing the fetch URL', async () => {
  vi.mocked(hardenedGit).mockResolvedValue('')
  await preventFixPush('/app/clone')
  expect(hardenedGit).toHaveBeenCalledExactlyOnceWith('/app/clone', [
    'config',
    '--replace-all',
    'remote.origin.pushurl',
    'https://invalid.invalid/slopbusters-no-push',
  ])
})
it('refuses a dirty retry before reading or changing HEAD', async () => {
  vi.mocked(hardenedGit).mockResolvedValue('?? unsaved.ts')
  await expect(fixHead('/app/worktree', 'a'.repeat(40))).rejects.toThrow('unsaved changes')
  expect(hardenedGit).toHaveBeenCalledTimes(1)
})
it('refuses a diverged retry and allows clean descendants including the start', async () => {
  vi.mocked(hardenedGit)
    .mockResolvedValueOnce('')
    .mockResolvedValueOnce('b'.repeat(40))
    .mockRejectedValueOnce(new Error('not an ancestor'))
  await expect(fixHead('/app/worktree', 'a'.repeat(40))).rejects.toThrow('diverged')
  vi.mocked(hardenedGit)
    .mockResolvedValueOnce('')
    .mockResolvedValueOnce('a'.repeat(40))
    .mockResolvedValueOnce('')
  await expect(fixHead('/app/worktree', 'a'.repeat(40))).resolves.toBe('a'.repeat(40))
})
