// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodingAgentSettings } from '../../../../src/features/settings/CodingAgentSettings'
import { call } from '../../../../src/lib/api'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('coding agent settings', () => {
  it('shows the command that adds Slopbusters to each agent and copies it', async () => {
    vi.mocked(call).mockResolvedValue({ url: 'http://127.0.0.1:47812/mcp' })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<CodingAgentSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Copy for Codex' }))

    expect(
      screen.getByText(
        'claude mcp add --transport http --scope user slopbusters http://127.0.0.1:47812/mcp',
      ),
    ).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(
      'codex mcp add slopbusters --url http://127.0.0.1:47812/mcp',
    )
    expect(await screen.findByRole('button', { name: 'Copy for Codex' })).toHaveProperty(
      'textContent',
      'Copied',
    )
  })

  it('says why agents cannot connect instead of offering commands that would fail', async () => {
    vi.mocked(call).mockResolvedValue({ problem: 'Another program is using port 47812.' })
    render(<CodingAgentSettings />)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Another program is using port 47812.',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
