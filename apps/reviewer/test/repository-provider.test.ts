import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runCommand } from '../server/process'
import { runStructured } from '../server/provider'
import { Provider } from '../shared/types'
import type { RepositoryContext } from '../server/repositoryTools'

vi.mock('../server/process', () => ({ runCommand: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const repository: RepositoryContext = {
  directory: '/review/repository',
  sha: 'a'.repeat(40),
  url: 'http://127.0.0.1:1234/mcp',
  token: 'fixture-token',
  close: async () => {},
}
const schema = z.object({ answer: z.string() })

describe('repository-aware provider execution', () => {
  it('runs Codex in the review checkout with the shared MCP server and a read-only sandbox', async () => {
    vi.mocked(runCommand).mockImplementation(async ({ args }) => {
      await writeFile(
        args[args.indexOf('--output-last-message') + 1],
        JSON.stringify({ answer: 'Inspected' }),
      )
      return ''
    })
    expect(
      await runStructured(
        { provider: Provider.codex, model: 'gpt-6.1-sol' },
        'Inspect this PR',
        schema,
        new AbortController().signal,
        repository,
      ),
    ).toEqual({ answer: 'Inspected' })
    const command = vi.mocked(runCommand).mock.calls[0][0]
    expect(command.cwd).toBe(repository.directory)
    expect(command.args).toContain('read-only')
    expect(command.args).toContain(`mcp_servers.slopbusters.url=${JSON.stringify(repository.url)}`)
    expect(command.args).toContain('mcp_servers.slopbusters.required=true')
    expect(command.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })
  it('gives Claude read/search and MCP tools without shell or edit tools', async () => {
    vi.mocked(runCommand).mockResolvedValue(
      JSON.stringify({ structured_output: { answer: 'Inspected' } }),
    )
    await runStructured(
      { provider: Provider.claude, model: 'claude-opus-5-5' },
      'Inspect this PR',
      schema,
      new AbortController().signal,
      repository,
    )
    const command = vi.mocked(runCommand).mock.calls[0][0]
    expect(command.cwd).toBe(repository.directory)
    expect(command.args[command.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep')
    expect(command.args).toContain('mcp__slopbusters__*')
    expect(command.args).toContain('dontAsk')
    expect(command.args).toContain('--strict-mcp-config')
    expect(command.args).not.toContain('--safe-mode')
    const config = JSON.parse(command.args[command.args.indexOf('--mcp-config') + 1])
    expect(config.mcpServers.slopbusters).toEqual({
      type: 'http',
      url: repository.url,
      headers: { Authorization: 'Bearer fixture-token' },
    })
  })
  it('keeps lightweight snapshot calls in their isolated directory with tools disabled', async () => {
    vi.mocked(runCommand).mockResolvedValue(
      JSON.stringify({ structured_output: { answer: 'Grouped' } }),
    )
    await runStructured(
      { provider: Provider.claude, model: 'claude-opus-5-5' },
      'Group changes',
      schema,
      new AbortController().signal,
    )
    const command = vi.mocked(runCommand).mock.calls[0][0]
    expect(command.cwd).not.toBe(repository.directory)
    expect(command.args).toContain('--safe-mode')
    expect(command.args[command.args.indexOf('--tools') + 1]).toBe('')
  })
})
