import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { organizePull } from '../server/features/organization/organize'
import { runCommand } from '../server/adapters/process'
import { Provider } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/adapters/process', () => ({ runCommand: vi.fn() }))
describe('organization model selection', () => {
  it.each([Provider.codex, Provider.claude])(
    'passes the selected model to %s',
    async (provider) => {
      const pull = fixturePull()
      const output = {
        groups: pull.groups.map(({ title, priority, reason, hunkIds }) => ({
          title,
          priority,
          reason,
          hunkIds,
        })),
      }
      vi.mocked(runCommand).mockImplementation(async (options) => {
        if (options.command === 'codex') {
          const index = options.args.indexOf('--output-last-message')
          await writeFile(options.args[index + 1]!, JSON.stringify(output))
          return ''
        }
        return JSON.stringify({ structured_output: output })
      })
      const signal = new AbortController().signal
      const groups = await organizePull(pull, { provider, model: 'custom-model-version' }, signal)
      expect(groups).toHaveLength(pull.groups.length)
      expect(runCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({
          command: provider,
          signal,
          args: expect.arrayContaining(['--model', 'custom-model-version']),
        }),
      )
    },
  )
})
