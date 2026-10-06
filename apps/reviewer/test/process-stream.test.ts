import { expect, it } from 'vitest'
import { CommandTimeoutError, runCommand } from '../server/adapters/process'

it('streams output before completion and preserves UTF-8 across byte boundaries', async () => {
  const chunks: string[] = []
  const output = await runCommand({
    command: process.execPath,
    args: [
      '-e',
      "const bytes = Buffer.from('Reviewing café'); process.stdout.write(bytes.subarray(0, 14)); setTimeout(() => process.stdout.write(bytes.subarray(14)), 40)",
    ],
    onStdout: (text) => {
      chunks.push(text)
    },
  })
  expect(chunks.length).toBeGreaterThan(1)
  expect(output).toBe('Reviewing café')
  expect(chunks.join('')).toBe(output)
})
it('terminates a provider when its output cannot be recorded', async () => {
  await expect(
    runCommand({
      command: process.execPath,
      args: ['-e', "process.stdout.write('Starting'); setInterval(() => {}, 1000)"],
      onStdout: () => {
        throw new Error('Recording failed')
      },
    }),
  ).rejects.toThrow('Recording failed')
})
it('distinguishes timeouts from process failures for bounded automatic retry', async () => {
  await expect(
    runCommand({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 30,
    }),
  ).rejects.toBeInstanceOf(CommandTimeoutError)
})
